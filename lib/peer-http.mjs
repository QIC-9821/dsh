import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import { join } from 'node:path'

import { applySnapshot, buildSnapshot, ensureSnapshotDir, parseSnapshot, pruneSnapshots, snapshotFileName } from './archive.mjs'

const MAX_BODY = 256 * 1024 * 1024

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error(`body over ${limit} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function authed(req, secret) {
  if (!secret) return false
  const header = String(req.headers['x-mem-secret'] || '')
  return header.length === secret.length && header === secret
}

/**
 * Snapshot exchange server. Only /mem/* routes exist; everything requires the
 * shared secret except /mem/ping, which reveals nothing sensitive.
 */
export function createSnapshotServer({
  dir,
  secret,
  machine,
  repoRoot = '',
  autoApply = false,
  conflict = 'peer',
  rules = {},
  keep = 5,
  maxTotalBytes = 100 * 1024 * 1024,
  listenHost = '0.0.0.0',
  listenPort = 18792,
  onApplied = null,
  logger,
}) {
  const log = (level, message) => logger?.[level]?.(message)
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const route = url.pathname
    try {
      if (route === '/mem/ping') {
        json(res, 200, {
          ok: true,
          machine,
          time: new Date().toISOString(),
          service: 'dsh-memory-sync',
          version: 3,
          rules,
        })
        return
      }
      if (!route.startsWith('/mem/')) {
        json(res, 404, { ok: false, error: 'not found' })
        return
      }
      if (!authed(req, secret)) {
        json(res, 401, { ok: false, error: 'bad secret' })
        return
      }
      await ensureSnapshotDir(dir)
      if (route === '/mem/snapshot' && req.method === 'POST') {
        const body = await readBody(req, MAX_BODY)
        const incoming = parseSnapshot(body) // validate before storing/applying
        const id = snapshotFileName(machine, url.searchParams.get('tag') || '')
        await fs.writeFile(join(dir, id), body)
        const pruned = await pruneSnapshots(dir, { keep, maxTotalBytes })
        const applyMode = String(req.headers['x-mem-apply'] || '')
        const noReply = String(req.headers['x-mem-no-reply'] || '') === '1'
        const explicitApply = applyMode === 'manual' || applyMode === 'reply'
        let applied = null
        if ((autoApply || explicitApply) && repoRoot && incoming.machine !== machine) {
          applied = await applySnapshot(repoRoot, incoming, {
            backup: true,
            preferRemote: conflict === 'peer',
          }).catch((error) => ({ error: String(error?.message || error) }))
          log('info', `applied snapshot from ${incoming.machine}: ${applied?.written?.length ?? 0} files`)
        }
        if (applied && onApplied) {
          try {
            await onApplied({ applied, incoming, applyMode, noReply })
          } catch (error) {
            log('warn', `onApplied failed: ${error?.message || error}`)
          }
        }
        log('info', `stored snapshot ${id} (${body.length} bytes); pruned ${pruned.removed.length}`)
        json(res, 200, {
          ok: true,
          id,
          bytes: body.length,
          removed: pruned.removed,
          applied,
          applyMode: explicitApply ? applyMode : autoApply ? 'auto' : 'store',
          noReply,
        })
        return
      }
      if (route === '/mem/list' && req.method === 'GET') {
        const names = await fs.readdir(dir).catch(() => [])
        const items = []
        for (const name of names) {
          if (!name.endsWith('.json.gz') || name.startsWith('live-')) continue
          const stat = await fs.stat(join(dir, name)).catch(() => null)
          if (!stat) continue
          items.push({ id: name, bytes: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) })
        }
        items.sort((a, b) => b.mtimeMs - a.mtimeMs)
        json(res, 200, { ok: true, machine, items })
        return
      }
      if (route === '/mem/latest' && req.method === 'GET') {
        // Build from the live tree first: the hub must answer with its current
        // memories, not only with whatever was pushed to it last.
        let live = null
        if (repoRoot) {
          live = await buildSnapshot(repoRoot, { machine, maxBytes: maxTotalBytes }).catch(() => null)
          if (live && live.meta.fileCount > 0) {
            await fs.writeFile(join(dir, `live-${snapshotFileName(machine)}`), live.body).catch(() => {})
          }
        }
        if (live && live.meta.fileCount > 0) {
          res.writeHead(200, {
            'content-type': 'application/gzip',
            'content-length': live.body.length,
            'x-snapshot-id': `live-${machine}.json.gz`,
            'cache-control': 'no-store',
          })
          res.end(live.body)
          return
        }
        const wanted = url.searchParams.get('machine') || ''
        const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json.gz') && !n.startsWith('live-'))
        const candidates = []
        for (const name of names) {
          if (wanted && !name.startsWith(`${wanted}-`)) continue
          const stat = await fs.stat(join(dir, name)).catch(() => null)
          if (stat) candidates.push({ name, mtimeMs: stat.mtimeMs })
        }
        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
        if (candidates.length === 0) {
          json(res, 404, { ok: false, error: 'no snapshot' })
          return
        }
        const body = await fs.readFile(join(dir, candidates[0].name))
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'content-length': body.length,
          'x-snapshot-id': candidates[0].name,
          'cache-control': 'no-store',
        })
        res.end(body)
        return
      }
      if (route.startsWith('/mem/snapshot/') && req.method === 'GET') {
        const id = decodeURIComponent(route.slice('/mem/snapshot/'.length))
        if (!/^[a-z0-9_.-]+\.json\.gz$/i.test(id)) {
          json(res, 400, { ok: false, error: 'bad id' })
          return
        }
        const body = await fs.readFile(join(dir, id)).catch(() => null)
        if (!body) {
          json(res, 404, { ok: false, error: 'not found' })
          return
        }
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'content-length': body.length,
          'x-snapshot-id': id,
        })
        res.end(body)
        return
      }
      json(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      log('warn', `snapshot server error: ${error?.message || error}`)
      json(res, 400, { ok: false, error: String(error?.message || error) })
    }
  })
  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(listenPort, listenHost, () => {
          server.off('error', reject)
          const addr = server.address()
          log('info', `snapshot server listening on ${listenHost}:${addr?.port || listenPort}`)
          resolve(addr)
        })
      })
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

/** Small JSON/gzip HTTP client with a hard timeout. */
export async function callPeer(peerUrl, path, { method = 'GET', secret = '', body = null, timeoutMs = 15000, headers = {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(new URL(path, peerUrl), {
      method,
      headers: {
        'x-mem-secret': secret,
        ...headers,
      },
      body: body || undefined,
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`peer ${method} ${path} -> ${response.status} ${text.slice(0, 200)}`)
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

