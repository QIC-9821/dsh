import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

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
