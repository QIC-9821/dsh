import { mkdir, rename, writeFile } from 'node:fs/promises'
import { hostname, platform, release, userInfo } from 'node:os'
import { dirname, join } from 'node:path'

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Local wall-clock stamp: `YYYY-MM-DD HH:mm:ss`. */
export function stampLocal(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return '-'
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

/** The process start time, derived from Node's uptime (no extra state needed). */
export function processStartedAt(now = Date.now()) {
  return new Date(now - process.uptime() * 1000)
}

function currentUser() {
  try {
    return userInfo().username || process.env.USERNAME || process.env.USER || 'unknown'
  } catch {
    return process.env.USERNAME || process.env.USER || 'unknown'
  }
}

/**
 * Render the human-readable PC snapshot. Kept to the same shape the old
 * watcher wrote, so the cloud-side AGENTS.md can keep reading `状态刷新`.
 */
export function renderStatus({ now = new Date(), startedAt } = {}) {
  const started = startedAt instanceof Date ? startedAt : processStartedAt(now.getTime())
  return [
    '# 电脑侧状态（自动生成，勿手改）',
    '',
    `- 主机名：${hostname()}`,
    `- 用户：${currentUser()}`,
    `- 系统：${platform()} ${release()}`,
    `- DSH 本次启动：${stampLocal(started)}`,
    `- 状态刷新：${stampLocal(now)}`,
    '',
  ].join('\n')
}

/**
 * Write the snapshot atomically. Never throws: a failed snapshot must not
 * block the memory sync itself.
 */
export async function writeStatusFile({ statusFile, logger, now = new Date(), startedAt } = {}) {
  const file = String(statusFile || '').trim()
  if (!file) return false
  try {
    const dir = dirname(file)
    await mkdir(dir, { recursive: true })
    const text = renderStatus({ now, startedAt })
    const tmp = join(dir, `.${Date.now()}.${process.pid}.status.tmp`)
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, file)
    logger?.info?.(`status snapshot written: ${file}`)
    return true
  } catch (error) {
    logger?.warn?.(`status snapshot failed: ${error?.message || error}`)
    return false
  }
}
