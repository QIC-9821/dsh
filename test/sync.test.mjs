import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { inspectRepo, syncLocal } from '../lib/git.mjs'

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initAt(path, bare = false) {
  const args = bare ? ['init', '--bare', '-b', 'main', path] : ['init', '-b', 'main', path]
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-sync-'))
  const bare = join(root, 'bare.git')
  initAt(bare, true)

  const seed = join(root, 'seed')
  initAt(seed)
  git(seed, 'config', 'user.name', 'Test')
  git(seed, 'config', 'user.email', 'test@example.com')
  await writeFile(join(seed, 'MEMORY.md'), '# memory\n', 'utf8')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-m', 'init')
  git(seed, 'remote', 'add', 'origin', bare.replace(/\\/g, '/'))
  git(seed, 'push', '-u', 'origin', 'main')

  const clone = join(root, 'clone')
  execFileSync('git', ['clone', bare, clone], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(clone, 'config', 'user.name', 'Test')
  git(clone, 'config', 'user.email', 'test@example.com')

  const clone2 = join(root, 'clone2')
  execFileSync('git', ['clone', bare, clone2], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(clone2, 'config', 'user.name', 'Test')
  git(clone2, 'config', 'user.email', 'test@example.com')

  const cfg = {
    repoPath: clone,
    stateDir: root,
    remote: 'origin',
    branch: 'main',
    gitPath: 'git',
    commitPrefix: 'sync',
    localTimeoutMs: 30000,
    peerTimeoutMs: 8000,
    mode: 'local',
  }
  return { root, bare, seed, clone, clone2, cfg }
}

test('syncLocal commits dirty files and pushes them', async () => {
  const { bare, clone, cfg } = await makeFixture()
  await writeFile(join(clone, 'daily-01.md'), 'note\n', 'utf8')

  const result = await syncLocal(cfg)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.committed, true)
  assert.equal(result.dirty, false)

  const subject = git(bare, 'log', '-1', '--pretty=%s').trim()
  assert.match(subject, /^sync: /)
  assert.equal(git(bare, 'show', '--name-only', '--pretty=format:', 'HEAD').trim(), 'daily-01.md')
  assert.equal(git(clone, 'status', '--porcelain').trim(), '')
})

test('syncLocal rebases over a peer commit that landed first', async () => {
  const { bare, clone, clone2, cfg } = await makeFixture()

  await writeFile(join(clone2, 'peer.md'), 'from peer\n', 'utf8')
  const peerPush = await syncLocal({ ...cfg, repoPath: clone2 })
  assert.equal(peerPush.ok, true, JSON.stringify(peerPush))

  // Make this clone dirty WITHOUT fetching: pull --rebase --autostash must cope.
  await writeFile(join(clone, 'local.md'), 'local work\n', 'utf8')
  const result = await syncLocal(cfg)
  assert.equal(result.ok, true, JSON.stringify(result))

  assert.equal(git(bare, 'show', 'main:peer.md').trim(), 'from peer')
  assert.equal(git(clone, 'show', 'main:local.md').trim(), 'local work')
  assert.equal(git(clone, 'status', '--porcelain').trim(), '')
})

test('syncLocal reports a useful failure outside a git repo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-sync-bad-'))
  const result = await syncLocal({ ...(await makeFixture()).cfg, repoPath: root })
  assert.equal(result.ok, false)
  assert.match(String(result.detail), /not a git repo|rev-parse/i)
})

test('inspectRepo exposes head, dirty and remote', async () => {
  const { clone, cfg } = await makeFixture()
  await writeFile(join(clone, 'x.md'), 'x\n', 'utf8')
  const info = await inspectRepo(cfg)
  assert.equal(info.ok, true)
  assert.equal(info.dirty, true)
  assert.equal(info.remote, 'origin')
  assert.match(info.head, /^[0-9a-f]{7,}$/)
})
