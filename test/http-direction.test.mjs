import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildSnapshot } from '../lib/archive.mjs'
import { runHttpSync } from '../lib/http-sync.mjs'
import { callPeer, createSnapshotServer } from '../lib/peer-http.mjs'

async function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }
}

async function startHub(root, { autoApply = false, conflict = 'peer' } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'memsync-hub-'))
  const snapDir = join(stateDir, 'snapshots')
  const applied = []
  const hub = createSnapshotServer({
    dir: snapDir,
    secret: 's3cret',
    machine: 'pc',
    repoRoot: root,
    autoApply,
    conflict,
    rules: { runOnStartup: true, intervalSendMinutes: 0, conflict, replyOnReceive: false, autoApply },
    keep: 3,
    listenHost: '127.0.0.1',
    listenPort: 0,
    onApplied: (payload) => applied.push(payload),
    logger: null,
  })
  const addr = await hub.listen()
  return { hub, url: `http://127.0.0.1:${addr.port}`, snapDir, applied }
}

function cfgFor(root, url, overrides = {}) {
  return {
    repoPath: root,
    stateDir: mkdtempSync(join(tmpdir(), 'memsync-state-')),
    peerUrl: url,
    memSecret: 's3cret',
    machine: 'tablet',
    peerMachine: 'pc',
    peerTimeoutMs: 5000,
    keepSnapshots: 3,
    maxSnapshotMB: 100,
    conflict: 'peer',
    ...overrides,
  }
}

test('ping reports protocol v3 and the read-only rules', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memsync-pc-'))
  const { hub, url } = await startHub(root)
  try {
    const response = await callPeer(url, '/mem/ping')
    const doc = await response.json()
    assert.equal(doc.version, 3)
    assert.equal(doc.rules.conflict, 'peer')
  } finally {
    await hub.close()
  }
})

test('manual push applies on a hub that keeps autoApply off', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memsync-pc-'))
  await writeTree(root, { 'MEMORY.md': 'pc memory\n' })
  const { hub, url, applied } = await startHub(root, { autoApply: false })
  try {
    const tablet = mkdtempSync(join(tmpdir(), 'memsync-tablet-'))
    await writeTree(tablet, { 'KEY.md': 'tablet key\n' })
    const result = await runHttpSync(cfgFor(tablet, url), {
      direction: 'push',
      applyMode: 'manual',
      machine: 'tablet',
    })
    assert.equal(result.ok, true)
    assert.equal(await fs.readFile(join(root, 'KEY.md'), 'utf8'), 'tablet key\n')
    assert.equal(applied.length, 1)
    assert.equal(applied[0].applyMode, 'manual')
  } finally {
    await hub.close()
  }
})

test('push without manual still respects autoApply off', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memsync-pc-'))
  const { hub, url } = await startHub(root, { autoApply: false })
  try {
    const tablet = mkdtempSync(join(tmpdir(), 'memsync-tablet-'))
    await writeTree(tablet, { 'KEY.md': 'tablet key\n' })
    const result = await runHttpSync(cfgFor(tablet, url), { direction: 'push', machine: 'tablet' })
    assert.equal(result.ok, true)
    await assert.rejects(() => fs.stat(join(root, 'KEY.md')))
  } finally {
    await hub.close()
  }
})

test('direction=pull does not send a snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memsync-pc-'))
  await writeTree(root, { 'USER.md': 'pc user\n' })
  const { hub, url, snapDir } = await startHub(root, { autoApply: true })
  try {
    const nonLive = async () => (await fs.readdir(snapDir).catch(() => [])).filter((name) => !name.startsWith('live-')).length
    const before = await nonLive()
    const tablet = mkdtempSync(join(tmpdir(), 'memsync-tablet-'))
    const result = await runHttpSync(cfgFor(tablet, url), { direction: 'pull', machine: 'tablet' })
    assert.equal(result.ok, true)
    assert.equal(result.pushed, false)
    assert.equal(await fs.readFile(join(tablet, 'USER.md'), 'utf8'), 'pc user\n')
    assert.equal(await nonLive(), before)
  } finally {
    await hub.close()
  }
})

test('hub conflict=local keeps a newer local file when a snapshot is applied', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memsync-pc-'))
  await writeTree(root, { 'MEMORY.md': 'pc newer\n' })
  const future = new Date(Date.now() + 60_000)
  await fs.utimes(join(root, 'MEMORY.md'), future, future)
  const { hub, url } = await startHub(root, { autoApply: false, conflict: 'local' })
  try {
    const tablet = mkdtempSync(join(tmpdir(), 'memsync-tablet-'))
    await writeTree(tablet, { 'MEMORY.md': 'tablet older\n' })
    const snapshot = await buildSnapshot(tablet, { machine: 'tablet' })
    await callPeer(url, '/mem/snapshot', {
      method: 'POST',
      secret: 's3cret',
      body: snapshot.body,
      headers: { 'content-type': 'application/gzip', 'x-mem-apply': 'manual' },
    })
    assert.equal(await fs.readFile(join(root, 'MEMORY.md'), 'utf8'), 'pc newer\n')
  } finally {
    await hub.close()
  }
})
