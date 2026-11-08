import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  DEFAULTS,
  SETTINGS_KEYS,
  normalizeConfig,
  stateDirFor,
  toBool,
  toInt,
} from './config.mjs'

const NUMBER_RANGES = Object.freeze({
  startupGraceSec: [0, 86400],
  retryDelaySec: [0, 3600],
  healIntervalSec: [0, 86400],
  localTimeoutMs: [5000, 600000],
  peerTimeoutMs: [5000, 600000],
  listenPort: [0, 65535],
  keepSnapshots: [0, 50],
  maxSnapshotMB: [1, 1024],
  peerPort: [1, 65535],
  intervalSendMinutes: [0, 10080],
})

const BOOLEAN_KEYS = new Set(
  Object.keys(DEFAULTS).filter((key) => typeof DEFAULTS[key] === 'boolean'),
)

const ENUMS = Object.freeze({
  mode: ['peer', 'local'],
  transport: ['http', 'git'],
  conflict: ['local', 'peer'],
})

const ALLOWED = new Set(SETTINGS_KEYS)

export function settingsPath(env = process.env) {
  return join(stateDirFor(env), 'settings.json')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Read the persisted UI overrides. Never throws. */
export function readSettings(env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(env), 'utf8'))
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Keep only known keys and coerce them to the same shapes normalizeConfig
 * produces. Invalid values are dropped so a bad form post cannot corrupt the
 * effective config.
 */
export function sanitizeSettings(patch = {}) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  for (const [key, raw] of Object.entries(patch)) {
    if (!ALLOWED.has(key)) continue
    if (raw === undefined) continue
    if (raw === null) {
      out[key] = null
      continue
    }
    if (NUMBER_RANGES[key]) {
      const [min, max] = NUMBER_RANGES[key]
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      out[key] = toInt(n, DEFAULTS[key], min, max)
      continue
    }
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof raw === 'boolean') out[key] = raw
      else if (raw === 'true' || raw === 'false') out[key] = raw === 'true'
      continue
    }
    if (ENUMS[key]) {
      if (ENUMS[key].includes(raw)) out[key] = raw
      continue
    }
    if (typeof raw === 'string') {
      out[key] = raw.trim()
    }
  }
  return out
}

/** Merge a patch into settings.json atomically. Returns the stored object. */
export function writeSettings(patch = {}, env = process.env) {
  const current = readSettings(env)
  const next = { ...current, ...sanitizeSettings(patch) }
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined) delete next[key]
  }
  const file = settingsPath(env)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return next
}

export function clearSettings(env = process.env) {
  const file = settingsPath(env)
  try {
    rmSync(file, { force: true })
  } catch {
    // already gone
  }
}

export function settingsInfo(env = process.env) {
  const file = settingsPath(env)
  const exists = existsSync(file)
  let updatedAt = ''
  try {
    if (exists) updatedAt = statSync(file).mtime.toISOString()
  } catch {
    updatedAt = ''
  }
  const stored = exists ? readSettings(env) : {}
  return {
    path: file,
    exists,
    updatedAt,
    overrides: Object.keys(stored).filter((key) => ALLOWED.has(key)),
  }
}

/**
 * Effective config = profile loader config, then settings.json overrides.
 * An empty string in settings means "clear back to the key's default", which
 * lets the UI reset a single field without deleting the whole file.
 */
export function effectiveConfig(rawConfig = {}, env = process.env) {
  const base = normalizeConfig(rawConfig, env)
  const stored = readSettings(env)
  const overrides = {}
  for (const [key, value] of Object.entries(stored)) {
    if (!ALLOWED.has(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value === '' && typeof DEFAULTS[key] === 'string') {
      overrides[key] = DEFAULTS[key]
      continue
    }
    overrides[key] = value
  }
  return normalizeConfig({ ...base, ...overrides }, env)
}

/** Config safe to return over HTTP: the shared secret is never echoed. */
export function redactConfig(cfg = {}) {
  const { memSecret, ...rest } = cfg
  return { ...rest, memSecret: '', memSecretSet: Boolean(memSecret) }
}

/**
 * Small mutable view over the loader config plus settings.json. The runtime
 * and the HTTP routes share one instance so a saved setting is visible
 * immediately, without restarting the plugin.
 */
export function createConfigStore(rawConfig = {}, env = process.env) {
  let current = effectiveConfig(rawConfig, env)
  return {
    current: () => current,
    reload() {
      current = effectiveConfig(rawConfig, env)
      return current
    },
    save(patch = {}, options = {}) {
      const next = { ...(patch || {}) }
      if (options.clearSecret === true) next.memSecret = ''
      writeSettings(next, env)
      current = effectiveConfig(rawConfig, env)
      return current
    },
    reset() {
      clearSettings(env)
      current = effectiveConfig(rawConfig, env)
      return current
    },
    info: () => settingsInfo(env),
    redacted: () => redactConfig(current),
    file: () => settingsPath(env),
  }
}
