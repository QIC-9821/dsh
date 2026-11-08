import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Defaults for every config key. Empty strings mean "not set yet". */
export const DEFAULTS = Object.freeze({
  repoPath: '',
  remote: 'cloud',
  branch: 'main',
  enabled: true,
  runOnStartup: true,
  startupGraceSec: 300,
  mode: 'peer',
  peerHost: '',
  peerUser: '',
  peerPort: 22,
  peerKeyPath: '',
  peerCommand: '/usr/local/bin/dsh-mem-sync',
  peerEnvName: 'cloud',
  retryDelaySec: 60,
  healIntervalSec: 600,
  notifyOnFailure: true,
  commitPrefix: 'sync',
  gitPath: 'git',
  localTimeoutMs: 120000,
  peerTimeoutMs: 120000,
  statusFile: '',
  stateDir: '',
  // v0.2 HTTP snapshot transport
  transport: 'git',
  peerUrl: '',
  peerMachine: '',
  machine: '',
  memSecret: '',
  serve: true,
  listenHost: '0.0.0.0',
  listenPort: 18792,
  autoApply: true,
  keepSnapshots: 5,
  maxSnapshotMB: 100,
  // v0.3 scheduling / conflict / reply rules
  intervalSendMinutes: 0,
  conflict: 'peer',
  replyOnReceive: false,
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Hosts expose config fields marked `.extra('volatile', true)` as live
 * references (`{ get() }`) instead of raw scalars. Unwrap them so both a
 * plain object and a reference map normalize to the same values.
 */
function unwrapRef(value) {
  let current = value
  for (let i = 0; i < 4; i += 1) {
    if (current === null || typeof current !== 'object') return current
    // Live config references look like `{ get() }` (method) or `{ get value() }`
    // (accessor). Support both, plus a plain `{ value }` wrapper.
    if (typeof current.get === 'function') {
      try {
        current = current.get()
      } catch {
        return undefined
      }
      continue
    }
    if ('get' in current) {
      current = current.get
      continue
    }
    if ('value' in current) {
      current = current.value
      continue
    }
    return current
  }
  return current
}

function toInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min || i > max) return fallback
  return i
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return fallback
}

export function dshHome(env) {
  const home = String(env?.DSH_HOME || '').trim()
  return home ? resolve(home) : join(homedir(), '.dsh')
}

function expandHome(value, env) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return join(homedir(), text.slice(2))
  }
  if (isAbsolute(text)) return text
  return resolve(env?.DSH_HOME ? dshHome(env) : process.cwd(), text)
}

/**
 * Normalize a Loader config object into a frozen, fully-resolved config.
 * Empty strings are treated as "not set" so a user can clear a field and
 * fall back to the default.
 */
export function normalizeConfig(raw = {}, env = process.env) {
  const input = unwrapRef(raw)
  const src = isPlainObject(input) ? input : {}
  const merged = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const value = unwrapRef(src[key])
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    merged[key] = value
  }

  const home = dshHome(env)
  const stateDir = resolve(
    expandHome(String(merged.stateDir || ''), env) || join(home, 'memory-sync'),
  )
  const repoPath = resolve(
    expandHome(String(merged.repoPath || ''), env) || join(home, 'memories'),
  )

  return Object.freeze({
    repoPath,
    stateDir,
    remote: String(merged.remote || DEFAULTS.remote),
    branch: String(merged.branch || DEFAULTS.branch),
    enabled: toBool(merged.enabled, DEFAULTS.enabled),
    runOnStartup: toBool(merged.runOnStartup, DEFAULTS.runOnStartup),
    startupGraceSec: toInt(merged.startupGraceSec, DEFAULTS.startupGraceSec, 0, 86400),
    mode: merged.mode === 'local' ? 'local' : 'peer',
    peerHost: String(merged.peerHost || '').trim(),
    peerUser: String(merged.peerUser || '').trim(),
    peerPort: toInt(merged.peerPort, DEFAULTS.peerPort, 1, 65535),
    peerKeyPath: expandHome(String(merged.peerKeyPath || ''), env),
    peerCommand: String(merged.peerCommand || DEFAULTS.peerCommand).trim(),
    peerEnvName: String(merged.peerEnvName || DEFAULTS.peerEnvName).trim(),
    retryDelaySec: toInt(merged.retryDelaySec, DEFAULTS.retryDelaySec, 0, 3600),
    healIntervalSec: toInt(merged.healIntervalSec, DEFAULTS.healIntervalSec, 0, 86400),
    notifyOnFailure: toBool(merged.notifyOnFailure, DEFAULTS.notifyOnFailure),
    commitPrefix: String(merged.commitPrefix || DEFAULTS.commitPrefix).trim() || 'sync',
    gitPath: String(merged.gitPath || DEFAULTS.gitPath).trim() || 'git',
    localTimeoutMs: toInt(merged.localTimeoutMs, DEFAULTS.localTimeoutMs, 5000, 600000),
    peerTimeoutMs: toInt(merged.peerTimeoutMs, DEFAULTS.peerTimeoutMs, 5000, 600000),
    // Optional machine snapshot committed with the sync (empty = disabled).
    statusFile: expandHome(String(merged.statusFile || ''), env),
    transport: merged.transport === 'http' ? 'http' : 'git',
    peerUrl: String(merged.peerUrl || '').trim().replace(/\/+$/, ''),
    peerMachine: String(merged.peerMachine || '').trim(),
    machine: String(merged.machine || '').trim() || hostLabel(env),
    memSecret: String(merged.memSecret || '').trim(),
    serve: toBool(merged.serve, DEFAULTS.serve),
    listenHost: String(merged.listenHost || DEFAULTS.listenHost).trim() || DEFAULTS.listenHost,
    listenPort: toInt(merged.listenPort, DEFAULTS.listenPort, 0, 65535),
    autoApply: toBool(merged.autoApply, DEFAULTS.autoApply),
    keepSnapshots: toInt(merged.keepSnapshots, DEFAULTS.keepSnapshots, 0, 50),
    maxSnapshotMB: toInt(merged.maxSnapshotMB, DEFAULTS.maxSnapshotMB, 1, 1024),
    intervalSendMinutes: toInt(merged.intervalSendMinutes, DEFAULTS.intervalSendMinutes, 0, 10080),
    conflict: merged.conflict === 'local' ? 'local' : 'peer',
    replyOnReceive: toBool(merged.replyOnReceive, DEFAULTS.replyOnReceive),
  })
}

/** Resolve the state directory without needing a full config. */
export function stateDirFor(env = process.env) {
  const explicit = String(env?.stateDir || '').trim()
  if (explicit) return resolve(explicit)
  return join(dshHome(env), 'memory-sync')
}

/** Keys the settings UI may persist (stateDir is derived, never stored). */
export const SETTINGS_KEYS = Object.freeze(
  Object.keys(DEFAULTS).filter((key) => key !== 'stateDir'),
)

export { toInt, toBool }

function hostLabel(env) {
  const explicit = String(env?.DSH_SYNC_NAME || '').trim()
  if (explicit) return explicit
  try {
    return String(env?.COMPUTERNAME || env?.HOSTNAME || 'dsh').toLowerCase()
  } catch {
    return 'dsh'
  }
}

/** The config has a usable repo path; the runtime checks whether it is a git repo. */
export function isConfigured(cfg) {
  return Boolean(cfg?.repoPath)
}
