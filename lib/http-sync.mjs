import fs from 'node:fs/promises'
import { join } from 'node:path'

import { applySnapshot, buildSnapshot, defaultSnapshotDir, ensureSnapshotDir, parseSnapshot, pruneSnapshots } from './archive.mjs'
import { callPeer } from './peer-http.mjs'

function phase(name, fn) {
  const started = Date.now()
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ name, ok: true, ms: Date.now() - started, ...value }))
    .catch((error) => ({ name, ok: false, ms: Date.now() - started, error: String(error?.message || error) }))
}

function requirePeer(cfg) {
  if (!cfg.peerUrl) throw new Error('peerUrl is empty')
  if (!cfg.memSecret) throw new Error('memSecret is empty')
}

/**
 * Push this machine's memories and/or pull the peer's newest snapshot.
 * direction: both | push | pull. applyMode is sent to the peer so a manual
 * sync can merge even when the peer keeps autoApply off.
 */
export async function runHttpSync(
  cfg,
  { logger, machine, direction = 'both', applyMode = null, noReply = false, onApplied = null } = {},
) {
  const snapDir = defaultSnapshotDir(cfg.stateDir)
  const maxBytes = Math.max(1, cfg.maxSnapshotMB) * 1024 * 1024
  const phases = []
  const wantPush = direction !== 'pull'
  const wantPull = direction !== 'push'

  let push = null
  if (wantPush) {
    push = await phase('push', async () => {
      requirePeer(cfg)
      const snapshot = await buildSnapshot(cfg.repoPath, { machine, maxBytes })
      const headers = { 'content-type': 'application/gzip' }
      if (applyMode) headers['x-mem-apply'] = applyMode
      if (noReply) headers['x-mem-no-reply'] = '1'
      const response = await callPeer(cfg.peerUrl, '/mem/snapshot', {
        method: 'POST',
        secret: cfg.memSecret,
        body: snapshot.body,
        headers,
        timeoutMs: cfg.peerTimeoutMs,
      })
      const stored = await response.json().catch(() => ({}))
      await ensureSnapshotDir(snapDir)
      await fs.writeFile(join(snapDir, `${machine || cfg.machine || 'local'}-${Date.now()}.json.gz`), snapshot.body).catch(() => {})
      await pruneSnapshots(snapDir, { keep: cfg.keepSnapshots, maxTotalBytes: maxBytes })
      logger?.info?.(`pushed ${snapshot.meta.fileCount} files (${snapshot.body.length} bytes) -> ${stored.id || 'peer'}`)
      return {
        files: snapshot.meta.fileCount,
        bytes: snapshot.body.length,
        id: stored.id || '',
        applied: stored.applied || null,
        applyMode: stored.applyMode || '',
      }
    })
    phases.push(push)
  }

  let pull = null
  if (wantPull) {
    pull = await phase('pull', async () => {
      requirePeer(cfg)
      const response = await callPeer(cfg.peerUrl, `/mem/latest?machine=${encodeURIComponent(cfg.peerMachine || '')}`, {
        secret: cfg.memSecret,
        timeoutMs: cfg.peerTimeoutMs,
      })
      const body = Buffer.from(await response.arrayBuffer())
      const doc = parseSnapshot(body)
      await ensureSnapshotDir(snapDir)
      const id = response.headers.get('x-snapshot-id') || `remote-${Date.now()}.json.gz`
      await fs.writeFile(join(snapDir, id), body).catch(() => {})
      await pruneSnapshots(snapDir, { keep: cfg.keepSnapshots, maxTotalBytes: maxBytes })
      const applied = await applySnapshot(cfg.repoPath, doc, {
        backup: true,
        preferRemote: cfg.conflict !== 'local',
      })
      logger?.info?.(`pulled ${doc.fileCount} files from ${doc.machine}: wrote ${applied.written.length}, skipped ${applied.skipped.length}`)
      if (applied.written.length > 0 && onApplied) {
        try {
          await onApplied({ applied, incoming: doc, direction: 'pull' })
        } catch (error) {
          logger?.warn?.(`onApplied failed: ${error?.message || error}`)
        }
      }
      return { from: doc.machine, fileCount: doc.fileCount, written: applied.written, skipped: applied.skipped }
    })
    phases.push(pull)
  }

  const ok = phases.every((item) => item.ok)
  return {
    ok,
    transport: 'http',
    phases,
    head: pull?.ok ? `${pull.written.length} files` : push?.ok ? `${push.files} files` : '',
    pushed: Boolean(push?.ok),
    pulled: Boolean(pull?.ok),
  }
}

/** Restore one stored snapshot by id (local file first, then the peer). */
export async function restoreHttpSnapshot(cfg, id, { machine } = {}) {
  const snapDir = defaultSnapshotDir(cfg.stateDir)
  let body = await fs.readFile(join(snapDir, id)).catch(() => null)
  let source = 'local'
  if (!body) {
    requirePeer(cfg)
    const response = await callPeer(cfg.peerUrl, `/mem/snapshot/${encodeURIComponent(id)}`, {
      secret: cfg.memSecret,
      timeoutMs: cfg.peerTimeoutMs,
    })
    body = Buffer.from(await response.arrayBuffer())
    source = 'peer'
  }
  const doc = parseSnapshot(body)
  const result = await applySnapshot(cfg.repoPath, doc, { backup: true, preferRemote: true })
  return { ok: true, source, id, machine: doc.machine, created: doc.createdAt, ...result }
}

/** Local inventory, merged with the peer's list when reachable. */
export async function listSnapshots(cfg) {
  const snapDir = defaultSnapshotDir(cfg.stateDir)
  const names = await fs.readdir(snapDir).catch(() => [])
  const local = []
  for (const name of names) {
    if (!name.endsWith('.json.gz')) continue
    const stat = await fs.stat(join(snapDir, name)).catch(() => null)
    if (stat) local.push({ id: name, bytes: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), source: 'local' })
  }
  local.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let remote = []
  if (cfg.peerUrl && cfg.memSecret) {
    try {
      const response = await callPeer(cfg.peerUrl, '/mem/list', { secret: cfg.memSecret, timeoutMs: Math.min(cfg.peerTimeoutMs, 5000) })
      const doc = await response.json()
      remote = Array.isArray(doc.items) ? doc.items.map((item) => ({ ...item, source: 'peer' })) : []
    } catch {
      remote = []
    }
  }
  return { ok: true, local, peer: remote }
}
