import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

const SKIP_DIRS = new Set(['.git', 'node_modules', 'memory-sync'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db'])

/** Recursively list memory markdown files, relative to root, POSIX-style. */
async function walk(root, base, out) {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.keep') continue
    const abs = join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(abs, base, out)
      continue
    }
    if (!entry.isFile()) continue
    if (SKIP_FILES.has(entry.name)) continue
    if (!entry.name.endsWith('.md') && !entry.name.endsWith('.json')) continue
    const rel = relative(base, abs).split(sep).join('/')
    try {
      const stat = await fs.stat(abs)
      out.push({ path: rel, mtimeMs: Math.trunc(stat.mtimeMs), size: stat.size, abs })
    } catch {
      // raced with a delete; ignore
    }
  }
}

/**
 * Build a portable snapshot: plain JSON (utf8 text) gzipped, no tar binary,
 * no native modules. Small enough for a LAN POST and readable on Android.
 */
export async function buildSnapshot(root, { machine = '', maxBytes = 0 } = {}) {
  const listed = []
  await walk(root, root, listed)
  listed.sort((a, b) => a.path.localeCompare(b.path))
  const files = []
  let total = 0
  for (const item of listed) {
    if (item.size > 4 * 1024 * 1024) {
      files.push({ path: item.path, mtimeMs: item.mtimeMs, skipped: 'too-large' })
      continue
    }
    const content = await fs.readFile(item.abs, 'utf8')
    total += Buffer.byteLength(content, 'utf8')
    files.push({ path: item.path, mtimeMs: item.mtimeMs, content })
  }
  const snapshot = {
    version: 1,
    machine,
    createdAt: new Date().toISOString(),
    fileCount: files.length,
    bytes: total,
  }
  const payload = JSON.stringify({ ...snapshot, files })
  const body = gzipSync(Buffer.from(payload, 'utf8'), { level: 9 })
  if (maxBytes > 0 && body.length > maxBytes) {
    throw new Error(`snapshot is ${body.length} bytes, over the ${maxBytes} byte limit`)
  }
  return {
    meta: { ...snapshot, compressedBytes: body.length },
    body,
    digest: createHash('sha256').update(body).digest('hex').slice(0, 16),
  }
}

/** Parse and validate a snapshot body (gzip JSON). */
export function parseSnapshot(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  let doc
  try {
    doc = JSON.parse(gunzipSync(buf).toString('utf8'))
  } catch (error) {
    throw new Error(`not a snapshot body: ${error?.message || error}`)
  }
  if (!doc || doc.version !== 1 || !Array.isArray(doc.files)) {
    throw new Error('unsupported snapshot format')
  }
  for (const file of doc.files) {
    if (typeof file?.path !== 'string' || file.path.includes('..')) {
      throw new Error('snapshot contains an unsafe path')
    }
  }
  return doc
}

/**
 * Merge a remote snapshot into the local tree.
 * Rules: create missing files; overwrite only when the remote copy is newer
 * (mtimeMs) or the local copy is byte-identical-safe to replace; never delete.
 * Daily files are append-merge: a shorter remote copy never replaces a longer local one.
 */
export async function applySnapshot(root, doc, { dryRun = false, backup = true, preferRemote = false, protect = [] } = {}) {
  const result = { written: [], skipped: [], backups: [] }
  const isProtected = (rel) =>
    protect.some((pattern) => (pattern.endsWith('/') ? rel.startsWith(pattern) : rel === pattern))
  for (const file of doc.files) {
    if (typeof file.content !== 'string') {
      result.skipped.push({ path: file.path, reason: 'no-content' })
      continue
    }
    if (isProtected(file.path)) {
      result.skipped.push({ path: file.path, reason: 'protected' })
      continue
    }
    const abs = join(root, ...file.path.split('/'))
    let localStat = null
    try {
      localStat = await fs.stat(abs)
    } catch {
      localStat = null
    }
    const localContent = localStat ? await fs.readFile(abs, 'utf8').catch(() => null) : null
    if (localContent === file.content) {
      result.skipped.push({ path: file.path, reason: 'identical' })
      continue
    }
    if (file.path.startsWith('daily/') && localContent && localContent.length > file.content.length) {
      result.skipped.push({ path: file.path, reason: 'local-daily-longer' })
      continue
    }
    if (!preferRemote && localStat && localStat.mtimeMs > (file.mtimeMs || 0) && !file.path.startsWith('daily/')) {
      result.skipped.push({ path: file.path, reason: 'local-newer' })
      continue
    }
    result.written.push(file.path)
    if (dryRun) continue
    await fs.mkdir(dirname(abs), { recursive: true })
    if (backup && localContent !== null) {
      const bak = `${abs}.bak-snapshot`
      await fs.writeFile(bak, localContent, 'utf8').catch(() => {})
      result.backups.push(relative(root, bak).split(sep).join('/'))
    }
    await fs.writeFile(abs, file.content, 'utf8')
    const stamp = new Date(file.mtimeMs || Date.now())
    await fs.utimes(abs, stamp, stamp).catch(() => {})
  }
  return result
}

/** Keep the newest `keep` snapshots and enforce the total-size budget. */
export async function pruneSnapshots(dir, { keep = 5, maxTotalBytes = 100 * 1024 * 1024 } = {}) {
  let entries
  try {
    entries = await fs.readdir(dir)
  } catch {
    return { removed: [] }
  }
  const files = []
  for (const name of entries) {
    if (!name.endsWith('.json.gz')) continue
    const abs = join(dir, name)
    try {
      const stat = await fs.stat(abs)
      files.push({ abs, name, size: stat.size, mtimeMs: stat.mtimeMs })
    } catch {
      // ignore
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const removed = []
  let total = 0
  for (let i = 0; i < files.length; i += 1) {
    total += files[i].size
    const overCount = i >= Math.max(1, keep)
    const overSize = total > maxTotalBytes
    if (overCount || overSize) {
      await fs.rm(files[i].abs, { force: true })
      removed.push(files[i].name)
    }
  }
  return { removed }
}

export function snapshotFileName(machine, tag = '') {
  const safeMachine = String(machine || 'unknown').replace(/[^a-z0-9_-]+/gi, '-')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${safeMachine}${tag ? `-${tag}` : ''}-${stamp}.json.gz`
}

export function defaultSnapshotDir(stateDir) {
  return join(stateDir, 'snapshots')
}

export function ensureSnapshotDir(dir) {
  if (!existsSync(dir)) return fs.mkdir(dir, { recursive: true })
  return Promise.resolve()
}

export { basename }
