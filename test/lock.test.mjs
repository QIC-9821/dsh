import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireLock } from '../lib/lock.mjs'

test('acquireLock is exclusive and release frees it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-sync-lock-'))
  const lockDir = join(root, 'lock')

  const first = await acquireLock(lockDir)
  assert.ok(first)

  const second = await acquireLock(lockDir)
  assert.equal(second, null)

  const owner = JSON.parse(await readFile(join(lockDir, 'sync.lock', 'owner.json'), 'utf8'))
  assert.equal(owner.pid, process.pid)

  await first.release()
  const third = await acquireLock(lockDir)
  assert.ok(third)
  await third.release()
})

test('acquireLock reclaims a stale lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-sync-lock-stale-'))
  const lockDir = join(root, 'lock')
  const old = await acquireLock(lockDir, { now: Date.now() - 3600_000 })
  assert.ok(old)

  const fresh = await acquireLock(lockDir)
  assert.ok(fresh)
  await fresh.release()
})
