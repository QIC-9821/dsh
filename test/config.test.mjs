import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'

import { normalizeConfig } from '../lib/config.mjs'

test('defaults resolve under DSH_HOME', () => {
  const cfg = normalizeConfig({}, { DSH_HOME: 'C:\\data\\dsh' })
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.runOnStartup, true)
  assert.equal(cfg.mode, 'peer')
  assert.equal(cfg.remote, 'cloud')
  assert.equal(cfg.branch, 'main')
  assert.equal(cfg.repoPath, join('C:\\data\\dsh', 'memories'))
  assert.equal(cfg.stateDir, join('C:\\data\\dsh', 'memory-sync'))
})

test('empty strings fall back to defaults and nested values are normalized', () => {
  const cfg = normalizeConfig(
    {
      repoPath: '',
      remote: '',
      mode: 'local',
      enabled: 'false',
      retryDelaySec: '300',
      peerHost: 'example.com',
      peerUser: 'dsh',
    },
    { DSH_HOME: '/tmp/dsh-home' },
  )
  assert.equal(cfg.mode, 'local')
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.retryDelaySec, 300)
  assert.equal(cfg.peerHost, 'example.com')
  assert.equal(cfg.peerUser, 'dsh')
  assert.equal(cfg.remote, 'cloud')
})

test('unknown mode degrades to peer and out-of-range numbers clamp', () => {
  const cfg = normalizeConfig({ mode: 'nonsense', localTimeoutMs: 10, healIntervalSec: -1 }, {})
  assert.equal(cfg.mode, 'peer')
  assert.equal(cfg.localTimeoutMs, 120000)
  assert.equal(cfg.healIntervalSec, 600)
})

test('volatile config references are unwrapped', () => {
  const ref = (value) => ({ get: () => value })
  const cfg = normalizeConfig(
    {
      repoPath: ref('/srv/mem'),
      mode: ref('local'),
      enabled: ref(false),
      peerHost: ref('example.com'),
      startupGraceSec: ref(30),
      statusFile: ref('/srv/mem/pc-status.md'),
    },
    { DSH_HOME: '/tmp/dsh-home' },
  )
  assert.equal(cfg.repoPath, resolve('/srv/mem'))
  assert.equal(cfg.mode, 'local')
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.peerHost, 'example.com')
  assert.equal(cfg.startupGraceSec, 30)
  assert.equal(cfg.statusFile, '/srv/mem/pc-status.md')
})

test('a root volatile reference map is unwrapped', () => {
  const cfg = normalizeConfig({ get: () => ({ remote: 'origin', branch: 'dev' }) }, {})
  assert.equal(cfg.remote, 'origin')
  assert.equal(cfg.branch, 'dev')
})

test('accessor-style references ({ get value() }) are unwrapped', () => {
  // Harness exposes volatile fields as `{ get <value> }` accessors, not
  // `{ get() }` methods; both shapes must normalize the same way.
  const ref = (value) => ({
    get get() {
      return value
    },
  })
  const cfg = normalizeConfig(
    {
      repoPath: ref('/srv/mem'),
      remote: ref('upstream'),
      branch: ref('stable'),
      mode: ref('local'),
      peerUser: ref('dsh'),
      statusFile: ref('/srv/mem/status.md'),
    },
    { DSH_HOME: '/tmp/dsh-home' },
  )
  assert.equal(cfg.repoPath, resolve('/srv/mem'))
  assert.equal(cfg.remote, 'upstream')
  assert.equal(cfg.branch, 'stable')
  assert.equal(cfg.mode, 'local')
  assert.equal(cfg.peerUser, 'dsh')
  assert.equal(cfg.statusFile, '/srv/mem/status.md')
})
