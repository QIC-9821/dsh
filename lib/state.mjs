import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Write JSON via a temp file + rename so a crash never leaves half a file. */
export async function writeJsonAtomic(file, value) {
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${Date.now()}.${process.pid}.tmp`)
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

/** Keep the log bounded: one previous generation is enough. */
export async function rotateLog(file, maxBytes = MAX_LOG_BYTES) {
  try {
    const info = await stat(file)
    if (info.size > maxBytes) await rename(file, `${file}.1`)
  } catch {
    // no log yet
  }
}

/**
 * Tiny logger: console + best-effort file. Never throws, never blocks a turn.
 */
export function createLogger({ dir, tag = 'memory-sync' }) {
  const file = join(dir, 'sync.log')
  const write = (level, message) => {
    const line = `${new Date().toISOString()} [${tag}] ${level} ${message}\n`
    try {
      if (level === 'error') console.error(line.trimEnd())
      else if (level === 'warn') console.warn(line.trimEnd())
      else console.log(line.trimEnd())
    } catch {
      // console can be closed in a packaged app
    }
    void appendFile(file, line).catch(() => {})
  }
  return {
    file,
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  }
}
