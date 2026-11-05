import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

const STALE_MS = 15 * 60 * 1000

/**
 * Cross-process lock built from a directory (atomic on Windows and POSIX).
 * Returns null when another process holds a fresh lock.
 */
export async function acquireLock(lockDir, { staleMs = STALE_MS, now = Date.now() } = {}) {
  await mkdir(lockDir, { recursive: true }).catch(() => {})
  const lockPath = join(lockDir, 'sync.lock')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath)
      await writeFile(
        join(lockPath, 'owner.json'),
        JSON.stringify({ pid: process.pid, host: hostname(), at: now }),
        'utf8',
      ).catch(() => {})
      return {
        path: lockPath,
        release: async () => {
          await rm(lockPath, { recursive: true, force: true }).catch(() => {})
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let stale = false
      try {
        const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'))
        stale = !Number.isFinite(Number(owner?.at)) || now - Number(owner.at) > staleMs
      } catch {
        stale = true
      }
      if (!stale) return null
      await rm(lockPath, { recursive: true, force: true }).catch(() => {})
    }
  }
  return null
}
