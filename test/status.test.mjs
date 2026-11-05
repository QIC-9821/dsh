import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeConfig } from '../lib/config.mjs'
import { renderStatus, stampLocal, writeStatusFile } from '../lib/status.mjs'

test('renderStatus carries the fields the cloud reads', () => {
  const now = new Date(2026, 10, 5, 18, 45, 6)
  const startedAt = new Date(2026, 10, 5, 18, 40, 0)
  const text = renderStatus({ now, startedAt })
  assert.match(text, /# 电脑侧状态/)
  assert.match(text, new RegExp(`- 主机名：${hostname()}`))
  assert.match(text, /- DSH 本次启动：2026-11-05 18:40:00/)
  assert.match(text, /- 状态刷新：2026-11-05 18:45:06/)
})

test('stampLocal formats local wall-clock time', () => {
  assert.equal(stampLocal(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02 03:04:05')
})

test('writeStatusFile creates directories, writes once, then overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-sync-status-'))
  const file = join(root, 'nested', 'pc-status.md')
  const first = await writeStatusFile({
    statusFile: file,
    now: new Date(2026, 10, 5, 10, 0, 0),
  })
  assert.equal(first, true)
  const text = await readFile(file, 'utf8')
  assert.match(text, /状态刷新：2026-11-05 10:00:00/)

  await writeStatusFile({ statusFile: file, now: new Date(2026, 10, 5, 11, 0, 0) })
  const second = await readFile(file, 'utf8')
  assert.match(second, /状态刷新：2026-11-05 11:00:00/)
  assert.equal(second.charCodeAt(0), 0x23, 'no BOM, starts with #')
})

test('writeStatusFile is a no-op without a path', async () => {
  assert.equal(await writeStatusFile({ statusFile: '' }), false)
})

test('normalizeConfig resolves statusFile and defaults it to empty', () => {
  const empty = normalizeConfig({}, { DSH_HOME: 'C:\\data\\dsh' })
  assert.equal(empty.statusFile, '')
  const set = normalizeConfig(
    { statusFile: '~/memories/pc-status.md' },
    { DSH_HOME: 'C:\\data\\dsh' },
  )
  assert.ok(set.statusFile.endsWith(join('memories', 'pc-status.md')))
})
