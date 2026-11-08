import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createConfigStore, effectiveConfig, readSettings, settingsInfo } from '../lib/settings.mjs'

function home() {
  return mkdtempSync(join(tmpdir(), 'memsync-settings-'))
}

test('settings override the loader config and keep secrets out of redacted output', () => {
  const env = { DSH_HOME: home() }
  const store = createConfigStore(
    { transport: 'http', peerUrl: 'http://peer:18792', memSecret: 'secret', machine: 'pc' },
    env,
  )
  assert.equal(store.current().transport, 'http')
  assert.equal(store.current().memSecret, 'secret')

  store.save({ conflict: 'local', intervalSendMinutes: 30, replyOnReceive: true })
  assert.equal(store.current().conflict, 'local')
  assert.equal(store.current().intervalSendMinutes, 30)
  assert.equal(store.current().replyOnReceive, true)
  assert.equal(store.redacted().memSecret, '')
  assert.equal(store.redacted().memSecretSet, true)
  assert.ok(store.info().overrides.includes('conflict'))
})

test('an empty string resets a key to its default, and reset clears every override', () => {
  const env = { DSH_HOME: home() }
  const store = createConfigStore({ peerUrl: 'http://peer:18792', conflict: 'peer' }, env)
  store.save({ conflict: 'local', peerUrl: 'http://other:18792' })
  assert.equal(store.current().conflict, 'local')
  store.save({ peerUrl: '' })
  assert.equal(store.current().peerUrl, '')
  store.reset()
  assert.equal(store.current().conflict, 'peer')
  assert.equal(store.current().peerUrl, 'http://peer:18792')
  assert.deepEqual(readSettings(env), {})
  assert.equal(settingsInfo(env).exists, false)
})

test('unknown keys and invalid enums are ignored', () => {
  const env = { DSH_HOME: home() }
  const store = createConfigStore({}, env)
  store.save({ nope: 1, transport: 'carrier-pigeon', conflict: 'maybe', intervalSendMinutes: 999999 })
  const cfg = store.current()
  assert.equal(cfg.transport, 'git')
  assert.equal(cfg.conflict, 'peer')
  assert.equal(cfg.intervalSendMinutes, 0)
})

test('new rule keys normalize with sane defaults', () => {
  const env = { DSH_HOME: home() }
  const cfg = effectiveConfig({ intervalSendMinutes: 15, conflict: 'local', replyOnReceive: true }, env)
  assert.equal(cfg.intervalSendMinutes, 15)
  assert.equal(cfg.conflict, 'local')
  assert.equal(cfg.replyOnReceive, true)
  assert.equal(cfg.peerPort, 22)
})
