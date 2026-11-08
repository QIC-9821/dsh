import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRoutes } from '../lib/routes.mjs'
import { createConfigStore } from '../lib/settings.mjs'

function makeServer() {
  const env = { DSH_HOME: mkdtempSync(join(tmpdir(), 'memsync-routes-')) }
  const store = createConfigStore({ transport: 'http', peerUrl: 'http://peer:18792', memSecret: 's3cret', machine: 'pc' }, env)
  let reconfigured = 0
  let synced = null
  const snapshotFile = join(env.DSH_HOME, 'export.json.gz')
  writeFileSync(snapshotFile, Buffer.from('fake-gzip'))
  const runtime = {
    status: async () => ({ machine: 'pc', rules: { conflict: store.current().conflict } }),
    reconfigure: async () => {
      reconfigured += 1
    },
    run: async (trigger, options) => {
      synced = { trigger, options }
      return { ok: true, phases: [] }
    },
    test: async () => ({ ok: true }),
    logs: async () => ['line'],
    list: async () => ({ local: [], peer: [] }),
    restore: async () => ({ written: [] }),
    exportTo: async () => ({ path: snapshotFile, files: 1, bytes: 10 }),
    importFrom: async (body, options) => ({ dryRun: Boolean(options?.dryRun), written: [] }),
  }
  const routes = createRoutes({ runtime, store, version: '0.3.0', origin: 'http://127.0.0.1:1' })
  const server = createServer((req, res) => void routes.handle(req, res))
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        server,
        store,
        get reconfigured() {
          return reconfigured
        },
        get synced() {
          return synced
        },
      })
    })
  })
}

test('state hides the secret and exposes rules', async () => {
  const ctx = await makeServer()
  try {
    const response = await fetch(`${ctx.url}/memory-sync/api/state`)
    const doc = await response.json()
    assert.equal(doc.ok, true)
    assert.equal(doc.version, '0.3.0')
    assert.equal(doc.config.memSecret, '')
    assert.equal(doc.config.memSecretSet, true)
    assert.equal(doc.status.machine, 'pc')
  } finally {
    await new Promise((resolvePromise) => ctx.server.close(resolvePromise))
  }
})

test('config saves and triggers reconfigure', async () => {
  const ctx = await makeServer()
  try {
    const response = await fetch(`${ctx.url}/memory-sync/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { conflict: 'local', intervalSendMinutes: 30 } }),
    })
    const doc = await response.json()
    assert.equal(doc.config.conflict, 'local')
    assert.equal(doc.config.intervalSendMinutes, 30)
    assert.equal(ctx.reconfigured, 1)
  } finally {
    await new Promise((resolvePromise) => ctx.server.close(resolvePromise))
  }
})

test('foreign origins are rejected', async () => {
  const ctx = await makeServer()
  try {
    const response = await fetch(`${ctx.url}/memory-sync/api/state`, { headers: { origin: 'http://evil.example' } })
    assert.equal(response.status, 403)
  } finally {
    await new Promise((resolvePromise) => ctx.server.close(resolvePromise))
  }
})

test('export sends gzip and import forwards dryRun', async () => {
  const ctx = await makeServer()
  try {
    const exported = await fetch(`${ctx.url}/memory-sync/api/export`)
    assert.equal(exported.headers.get('content-type'), 'application/gzip')
    assert.ok(Number(exported.headers.get('content-length')) > 0)

    const imported = await fetch(`${ctx.url}/memory-sync/api/import?dryRun=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/gzip' },
      body: Buffer.from('fake'),
    })
    const doc = await imported.json()
    assert.equal(doc.result.dryRun, true)
  } finally {
    await new Promise((resolvePromise) => ctx.server.close(resolvePromise))
  }
})

test('sync forwards direction', async () => {
  const ctx = await makeServer()
  try {
    const response = await fetch(`${ctx.url}/memory-sync/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'pull' }),
    })
    const doc = await response.json()
    assert.equal(doc.result.ok, true)
    assert.equal(ctx.synced.options.direction, 'pull')
  } finally {
    await new Promise((resolvePromise) => ctx.server.close(resolvePromise))
  }
})
