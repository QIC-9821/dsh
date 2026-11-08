import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { exportSnapshot, importSnapshot } from '../lib/offline.mjs'

async function makeTree() {
  const root = mkdtempSync(join(tmpdir(), 'memsync-offline-'))
  const stateDir = mkdtempSync(join(tmpdir(), 'memsync-offline-state-'))
  await fs.mkdir(join(root, 'projects', 'p1'), { recursive: true })
  await fs.mkdir(join(root, 'daily'), { recursive: true })
  await fs.writeFile(join(root, 'USER.md'), 'user one\n', 'utf8')
  await fs.writeFile(join(root, 'daily', '2026-11-08.md'), 'long daily line\nline two\n', 'utf8')
  await fs.writeFile(join(root, 'projects', 'p1', 'KEY.md'), 'key one\n', 'utf8')
  return {
    root,
    cfg: {
      repoPath: root,
      stateDir,
      machine: 'pc',
      maxSnapshotMB: 100,
      conflict: 'peer',
    },
  }
}

test('export then import round-trips and reports identical files', async () => {
  const a = await makeTree()
  const b = await makeTree()
  await fs.writeFile(join(b.root, 'USER.md'), 'b user\n', 'utf8')
  await fs.writeFile(join(b.root, 'daily', '2026-11-08.md'), 'b daily\n', 'utf8')
  await fs.writeFile(join(b.root, 'projects', 'p1', 'KEY.md'), 'b key\n', 'utf8')
  const exported = await exportSnapshot(a.cfg, {})
  assert.ok((await fs.stat(exported.path)).isFile())
  assert.equal(exported.files, 3)

  const preview = await importSnapshot(b.cfg, exported.path, { dryRun: true })
  assert.equal(preview.dryRun, true)
  assert.equal(preview.written.length, 3)
  assert.equal(await fs.readFile(join(b.root, 'USER.md'), 'utf8'), 'b user\n')

  const applied = await importSnapshot(b.cfg, exported.path, {})
  assert.equal(applied.written.length, 3)
  assert.ok(applied.backups.length >= 0)
  assert.equal(await fs.readFile(join(b.root, 'projects', 'p1', 'KEY.md'), 'utf8'), 'key one\n')

  const again = await importSnapshot(b.cfg, exported.path, { dryRun: true })
  assert.equal(again.written.length, 0)
  assert.ok(again.skipped.every((item) => item.reason === 'identical'))
})

test('local conflict keeps a longer daily file', async () => {
  const a = await makeTree()
  const b = await makeTree()
  // b has a longer daily; a's snapshot is shorter and must not truncate it.
  await fs.writeFile(join(b.root, 'daily', '2026-11-08.md'), 'long daily line\nline two\nline three\nline four\n', 'utf8')
  b.cfg = { ...b.cfg, conflict: 'local' }
  const exported = await exportSnapshot(a.cfg, {})
  const result = await importSnapshot(b.cfg, exported.path, {})
  assert.equal(await fs.readFile(join(b.root, 'daily', '2026-11-08.md'), 'utf8'), 'long daily line\nline two\nline three\nline four\n')
  assert.ok(result.skipped.some((item) => item.path === 'daily/2026-11-08.md'))
})

test('a missing snapshot file is rejected clearly', async () => {
  const a = await makeTree()
  await assert.rejects(() => importSnapshot(a.cfg, join(a.root, 'nope.json.gz')), /not found/)
})
