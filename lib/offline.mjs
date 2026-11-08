import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { applySnapshot, buildSnapshot, parseSnapshot, snapshotFileName, defaultSnapshotDir, ensureSnapshotDir } from './archive.mjs'

function expandPath(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return isAbsolute(text) ? text : resolve(text)
}

export function defaultExportDir(stateDir) {
  return join(stateDir, 'exports')
}

/** Build a portable snapshot and write it to disk. */
export async function exportSnapshot(cfg, { path = '', machine = cfg.machine } = {}) {
  const maxBytes = Math.max(1, cfg.maxSnapshotMB) * 1024 * 1024
  const snapshot = await buildSnapshot(cfg.repoPath, { machine, maxBytes })
  const file =
    expandPath(path) ||
    join(defaultExportDir(cfg.stateDir), snapshotFileName(machine, 'export'))
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, snapshot.body)
  return {
    ok: true,
    path: file,
    bytes: snapshot.body.length,
    files: snapshot.meta.fileCount,
    machine: snapshot.meta.machine,
    createdAt: snapshot.meta.createdAt,
    digest: snapshot.digest,
  }
}

/** Read and merge a snapshot file (or an already-read body). */
export async function importSnapshot(cfg, source, { dryRun = false, path = '' } = {}) {
  const maxBytes = Math.max(1, cfg.maxSnapshotMB) * 1024 * 1024
  let body = Buffer.isBuffer(source) ? source : null
  const file = body ? expandPath(path) : expandPath(source)
  if (!body) {
    const stat = await fs.stat(file).catch(() => null)
    if (!stat) throw new Error(`snapshot not found: ${file}`)
    if (stat.size > maxBytes) throw new Error(`snapshot is ${stat.size} bytes, over the ${maxBytes} byte limit`)
    body = await fs.readFile(file)
  }
  if (body.length > maxBytes) {
    throw new Error(`snapshot is ${body.length} bytes, over the ${maxBytes} byte limit`)
  }
  const doc = parseSnapshot(body)
  const applied = await applySnapshot(cfg.repoPath, doc, {
    dryRun,
    backup: true,
    preferRemote: cfg.conflict === 'peer',
  })
  if (!dryRun) {
    const dir = defaultSnapshotDir(cfg.stateDir)
    await ensureSnapshotDir(dir)
    const id = snapshotFileName(doc.machine || cfg.machine, 'import')
    await fs.writeFile(join(dir, id), body).catch(() => {})
  }
  return {
    ok: true,
    dryRun,
    path: file || '',
    machine: doc.machine,
    createdAt: doc.createdAt,
    fileCount: doc.fileCount,
    written: applied.written,
    skipped: applied.skipped,
    backups: applied.backups,
  }
}
