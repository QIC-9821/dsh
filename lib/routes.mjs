import fs from 'node:fs/promises'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function send(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': body.length, 'cache-control': 'no-store' })
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

async function readJson(req, limit = 2 * 1024 * 1024) {
  const body = await readBody(req, limit)
  if (!body.length) return {}
  return JSON.parse(body.toString('utf8'))
}

export function isLocalCall(req, origin) {
  const requestOrigin = req.headers.origin
  if (!requestOrigin) return true
  if (origin && requestOrigin === origin) return true
  try {
    const host = req.headers.host
    return new URL(requestOrigin).host === host
  } catch {
    return false
  }
}

export function createRoutes({ runtime, store, version = '', origin = '' }) {
  async function state() {
    return {
      ok: true,
      version,
      config: store.redacted(),
      settings: store.info(),
      status: await runtime.status(),
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname
    if (!path.startsWith('/memory-sync/api/')) {
      return send(res, 404, { ok: false, error: 'not found' })
    }
    if (!isLocalCall(req, origin)) {
      return send(res, 403, { ok: false, error: 'forbidden' })
    }
    const action = path.slice('/memory-sync/api/'.length)
    try {
      if (action === 'state' && req.method === 'GET') {
        return send(res, 200, await state())
      }
      if (action === 'config' && req.method === 'POST') {
        const body = await readJson(req)
        const patch = body?.patch && typeof body.patch === 'object' ? { ...body.patch } : {}
        if (patch.memSecret === '') delete patch.memSecret
        store.save(patch, { clearSecret: body?.clearSecret === true })
        await runtime.reconfigure()
        return send(res, 200, await state())
      }
      if (action === 'reset' && req.method === 'POST') {
        store.reset()
        await runtime.reconfigure()
        return send(res, 200, await state())
      }
      if (action === 'sync' && req.method === 'POST') {
        const body = await readJson(req)
        const direction = ['both', 'push', 'pull'].includes(body?.direction) ? body.direction : 'both'
        const result = await runtime.run('manual', { direction })
        return send(res, 200, { ok: true, result, status: await runtime.status() })
      }
      if (action === 'test' && req.method === 'POST') {
        return send(res, 200, { ok: true, result: await runtime.test() })
      }
      if (action === 'logs' && req.method === 'GET') {
        const lines = Number(url.searchParams.get('lines')) || 80
        return send(res, 200, { ok: true, lines: await runtime.logs(lines) })
      }
      if (action === 'snapshots' && req.method === 'GET') {
        return send(res, 200, { ok: true, ...(await runtime.list()) })
      }
      if (action === 'restore' && req.method === 'POST') {
        const body = await readJson(req)
        const id = String(body?.id || '')
        return send(res, 200, { ok: true, result: await runtime.restore(id) })
      }
      if (action === 'export' && req.method === 'GET') {
        const result = await runtime.exportTo('')
        const body = await fs.readFile(result.path)
        res.writeHead(200, {
          'content-type': 'application/gzip',
          'content-length': body.length,
          'content-disposition': `attachment; filename="${result.path.split(/[\\\\/]/).pop()}"`,
          'cache-control': 'no-store',
          'x-snapshot-files': String(result.files ?? ''),
        })
        res.end(body)
        return
      }
      if (action === 'import' && req.method === 'POST') {
        const dryRun = url.searchParams.get('dryRun') === '1'
        const maxBytes = Math.min(256 * 1024 * 1024, Math.max(1, Number(store.current().maxSnapshotMB) || 100) * 1024 * 1024)
        const body = await readBody(req, maxBytes)
        const result = await runtime.importFrom(body, { dryRun })
        return send(res, 200, { ok: true, result })
      }
      return send(res, 404, { ok: false, error: `unknown api: ${action}` })
    } catch (error) {
      return send(res, 500, { ok: false, error: String(error?.message || error) })
    }
  }

  return { handle, state }
}
