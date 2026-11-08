import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'

import { applySnapshot, buildSnapshot, parseSnapshot, pruneSnapshots } from '../lib/archive.mjs'

async function tempTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'memsync-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'))
    await fs.mkdir(join(abs, '..'), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  }
  return root
}

test('snapshot roundtrip keeps markdown and skips .git', async () => {
  const root = await tempTree({
    'USER.md': 'user',
    'daily/2026-11-07.md': 'today',
    '.git/config': 'ignored',
    'notes.txt': 'not markdown',
  })
  const snapshot = await buildSnapshot(root, { machine: 'pc' })
  assert.ok(snapshot.body.length > 0)
  const doc = parseSnapshot(snapshot.body)
  assert.equal(doc.machine, 'pc')
  assert.deepEqual(doc.files.map((f) => f.path).sort(), ['USER.md', 'daily/2026-11-07.md'])
})

test('apply creates missing files, backs up and skips newer local', async () => {
  const source = await tempTree({ 'USER.md': 'remote user', 'KEY.md': 'remote key' })
  const doc = parseSnapshot((await buildSnapshot(source, { machine: 'pc' })).body)
  const target = await tempTree({ 'KEY.md': 'local key' })
  // Make the local copy appear newer so it must win.
  const future = new Date(Date.now() + 60_000)
  await fs.utimes(join(target, 'KEY.md'), future, future)

  const result = await applySnapshot(target, doc)
  assert.deepEqual(result.written, ['USER.md'])
  assert.ok(result.skipped.some((s) => s.path === 'KEY.md' && s.reason === 'local-newer'))
  assert.equal(await fs.readFile(join(target, 'USER.md'), 'utf8'), 'remote user')
  assert.equal(await fs.readFile(join(target, 'KEY.md'), 'utf8'), 'local key')
})

test('daily files never shrink', async () => {
  const source = await tempTree({ 'daily/2026-11-07.md': 'short' })
  const doc = parseSnapshot((await buildSnapshot(source, { machine: 'pc' })).body)
  const target = await tempTree({ 'daily/2026-11-07.md': 'a much longer local day log' })
  const result = await applySnapshot(target, doc)
  assert.ok(result.skipped.some((s) => s.reason === 'local-daily-longer'))
  assert.equal(await fs.readFile(join(target, 'daily/2026-11-07.md'), 'utf8'), 'a much longer local day log')
})

test('unsafe paths are rejected', () => {
  const body = Buffer.from(
    JSON.stringify({ version: 1, machine: 'x', files: [{ path: '../evil.md', content: 'x' }] }),
  )
  assert.throws(() => parseSnapshot(gzipSync(body)), /unsafe path/)
})

test('prune keeps the newest N and respects the size budget', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memsync-snap-'))
  for (let i = 0; i < 5; i += 1) {
    const name = `pc-${i}.json.gz`
    await fs.writeFile(join(dir, name), Buffer.alloc(10))
    const stamp = new Date(Date.now() - (5 - i) * 1000)
    await fs.utimes(join(dir, name), stamp, stamp)
  }
  const result = await pruneSnapshots(dir, { keep: 2 })
  assert.equal(result.removed.length, 3)
  const left = (await fs.readdir(dir)).sort()
  assert.deepEqual(left, ['pc-3.json.gz', 'pc-4.json.gz'])
})
