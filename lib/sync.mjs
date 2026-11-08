import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { acquireLock } from './lock.mjs'
import { inspectRepo, runProcess, runStartupChain } from './git.mjs'
import { runHttpSync, listSnapshots, restoreHttpSnapshot } from './http-sync.mjs'
import { callPeer, createSnapshotServer } from './peer-http.mjs'
import { defaultSnapshotDir, pruneSnapshots } from './archive.mjs'
import { exportSnapshot, importSnapshot } from './offline.mjs'
import { notifyFailure } from './notify.mjs'
import { readJson, writeJsonAtomic } from './state.mjs'
import { writeStatusFile } from './status.mjs'

const REPLY_COOLDOWN_MS = 5000
const REPLY_DELAY_MS = 500

function nowIso() {
  return new Date().toISOString()
}

/**
 * Owns the startup/manual/scheduled sync, the one-at-a-time lock, retry and
 * self-heal timers, the snapshot server and the last-run record.
 * The config is supplied through getConfig() so UI saves take effect without a
 * plugin restart.
 */
export function createSyncRuntime({ getConfig, logger }) {
  let cfg = getConfig()
  const lastRunFile = join(cfg.stateDir, 'last-run.json')
  const lockDir = join(cfg.stateDir, 'lock')

  let startupTimer = null
  let retryTimer = null
  let healTimer = null
  let scheduleTimer = null
  let replyTimer = null
  let running = null
  let lastRun = null
  let notified = false
  let disposed = false
  let server = null
  let serverInfo = null
  let serverSignature = ''
  let scheduleLastAt = ''
  let scheduleNextAt = ''
  let lastReplyAt = 0

  const log = (level, message) => logger?.[level]?.(message)

  function refresh() {
    cfg = getConfig()
    return cfg
  }

  function clearTimers() {
    for (const timer of [startupTimer, retryTimer, healTimer, scheduleTimer, replyTimer]) {
      if (timer) {
        clearTimeout(timer)
        clearInterval(timer)
      }
    }
    startupTimer = null
    retryTimer = null
    healTimer = null
    scheduleTimer = null
    replyTimer = null
    scheduleNextAt = ''
  }

  function rulesOf(current = cfg) {
    return {
      runOnStartup: current.runOnStartup,
      intervalSendMinutes: current.intervalSendMinutes,
      conflict: current.conflict,
      replyOnReceive: current.replyOnReceive,
      autoApply: current.autoApply,
    }
  }

  function serverKey(current = cfg) {
    if (current.transport !== 'http' || !current.serve || current.listenPort === 0) return ''
    return JSON.stringify({
      host: current.listenHost,
      port: current.listenPort,
      secret: current.memSecret,
      machine: current.machine,
      repoPath: current.repoPath,
      autoApply: current.autoApply,
      conflict: current.conflict,
      keep: current.keepSnapshots,
      max: current.maxSnapshotMB,
    })
  }

  async function execute(trigger, options = {}) {
    refresh()
    if (disposed) return { ok: false, skipped: true, trigger, reason: 'disposed' }
    if (running) return running

    const direction = options.direction || 'both'
    const applyMode = options.applyMode !== undefined
      ? options.applyMode
      : trigger === 'manual'
        ? 'manual'
        : null
    const noReply = Boolean(options.noReply)

    running = (async () => {
      const lock = await acquireLock(lockDir)
      if (!lock) return { ok: false, locked: true, trigger, at: nowIso() }
      try {
        log('info', `sync start (${trigger}) mode=${cfg.mode} direction=${direction}`)
        if (cfg.statusFile) {
          await writeStatusFile({ statusFile: cfg.statusFile, logger })
        }
        let result
        if (cfg.transport === 'http') {
          if (!cfg.peerUrl) {
            result = {
              ok: false,
              transport: 'http',
              phases: [],
              error: '这个端没有配置对端地址（peerUrl）。它是服务端角色，只能等对端发起，或先填写对端地址。',
            }
          } else {
            result = await runHttpSync(cfg, {
              logger,
              machine: cfg.machine,
              direction,
              applyMode,
              noReply,
              onApplied: ({ applied, incoming }) => maybeReply({ applied, incoming, noReply }),
            })
          }
        } else {
          result = await runStartupChain(cfg)
        }
        const run = { ...result, trigger, at: nowIso() }
        lastRun = run
        await writeJsonAtomic(lastRunFile, run).catch(() => {})
        log(
          result.ok ? 'info' : 'warn',
          `sync ${result.ok ? 'ok' : 'FAILED'} (${trigger}) head=${result.head || '-'}`,
        )
        return run
      } catch (error) {
        const run = {
          ok: false,
          phases: [],
          trigger,
          at: nowIso(),
          error: String(error?.message || error),
        }
        lastRun = run
        await writeJsonAtomic(lastRunFile, run).catch(() => {})
        log('error', `sync crashed (${trigger}): ${run.error}`)
        return run
      } finally {
        await lock.release().catch(() => {})
        running = null
      }
    })()

    return running
  }

  function finalFailure(run) {
    if (cfg.notifyOnFailure && !notified) {
      notified = true
      const failed = (run.phases || [])
        .filter((phase) => !phase.ok && !phase.skipped)
        .map((phase) => phase.name)
        .join('/')
      const detail = failed || run.error || 'unknown'
      void notifyFailure({
        title: 'DSH 记忆同步失败',
        message: `同步没有完成（${detail}）。详见 ${logger?.file || cfg.stateDir}。`,
        logger,
      })
    }
    armHeal()
  }

  function armRetry(run) {
    if (disposed || cfg.retryDelaySec <= 0) {
      finalFailure(run)
      return
    }
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = null
      void execute('retry').then((next) => afterRun(next, 'retry'))
    }, cfg.retryDelaySec * 1000)
    retryTimer.unref?.()
  }

  function armHeal() {
    if (disposed || cfg.healIntervalSec <= 0) return
    if (healTimer) clearTimeout(healTimer)
    healTimer = setTimeout(() => {
      healTimer = null
      void execute('heal').then((next) => {
        if (next.ok) {
          notified = false
          return
        }
        armHeal()
      })
    }, cfg.healIntervalSec * 1000)
    healTimer.unref?.()
  }

  function afterRun(run, trigger) {
    if (!run || run.skipped) return
    if (run.locked) {
      log('info', 'another sync holds the lock; will retry later')
      armHeal()
      return
    }
    if (run.ok) {
      notified = false
      return
    }
    if (trigger === 'startup') {
      armRetry(run)
      return
    }
    if (trigger === 'schedule' || trigger === 'reply') {
      log('warn', `${trigger} sync failed: ${run.error || (run.phases || []).map((p) => p.name).join('/')}`)
      return
    }
    finalFailure(run)
  }

  function armSchedule() {
    if (scheduleTimer) {
      clearInterval(scheduleTimer)
      scheduleTimer = null
    }
    scheduleNextAt = ''
    if (disposed) return
    if (!cfg.enabled || cfg.intervalSendMinutes <= 0) return
    const ms = cfg.intervalSendMinutes * 60 * 1000
    scheduleNextAt = new Date(Date.now() + ms).toISOString()
    scheduleTimer = setInterval(() => {
      scheduleLastAt = nowIso()
      scheduleNextAt = new Date(Date.now() + ms).toISOString()
      if (disposed || running) {
        log('info', 'scheduled send skipped (another sync is running)')
        return
      }
      void execute('schedule', { direction: 'push', applyMode: null }).then((run) => afterRun(run, 'schedule'))
    }, ms)
    scheduleTimer.unref?.()
    log('info', `scheduled send armed: every ${cfg.intervalSendMinutes} minute(s)`)
  }

  function maybeReply({ applied, incoming, noReply = false } = {}) {
    refresh()
    if (!cfg.replyOnReceive || noReply || cfg.transport !== 'http') return
    if (!applied || !Array.isArray(applied.written) || applied.written.length === 0) return
    if (incoming && incoming.machine === cfg.machine) return
    if (!cfg.peerUrl) {
      log('warn', '收到对端快照并合并了，但没有 peerUrl，无法回发')
      return
    }
    if (replyTimer) return
    if (Date.now() - lastReplyAt < REPLY_COOLDOWN_MS) return
    lastReplyAt = Date.now()
    log('info', `回发快照（合并了 ${applied.written.length} 个文件）`)
    replyTimer = setTimeout(() => {
      replyTimer = null
      void execute('reply', { direction: 'push', applyMode: 'reply', noReply: true }).then((run) =>
        afterRun(run, 'reply'),
      )
    }, REPLY_DELAY_MS)
    replyTimer.unref?.()
  }

  async function stopServer() {
    const current = server
    server = null
    serverInfo = null
    serverSignature = ''
    if (current) {
      try {
        await current.close?.()
      } catch {
        // already closed
      }
    }
  }

  async function startServer() {
    refresh()
    if (disposed || cfg.transport !== 'http' || !cfg.serve || cfg.listenPort === 0) return null
    if (!cfg.memSecret) {
      log('warn', 'memSecret is empty; snapshot server not started')
      serverInfo = { error: 'memSecret is empty' }
      return serverInfo
    }
    if (server) return serverInfo
    const dir = defaultSnapshotDir(cfg.stateDir)
    server = createSnapshotServer({
      dir,
      secret: cfg.memSecret,
      machine: cfg.machine,
      repoRoot: cfg.repoPath,
      autoApply: cfg.autoApply,
      conflict: cfg.conflict,
      rules: {
        get runOnStartup() {
          return cfg.runOnStartup
        },
        get intervalSendMinutes() {
          return cfg.intervalSendMinutes
        },
        get conflict() {
          return cfg.conflict
        },
        get replyOnReceive() {
          return cfg.replyOnReceive
        },
        get autoApply() {
          return cfg.autoApply
        },
      },
      keep: cfg.keepSnapshots,
      maxTotalBytes: cfg.maxSnapshotMB * 1024 * 1024,
      listenHost: cfg.listenHost,
      listenPort: cfg.listenPort,
      onApplied: ({ applied, incoming, noReply }) => {
        maybeReply({ applied, incoming, noReply })
      },
      logger,
    })
    try {
      const addr = await server.listen()
      serverSignature = serverKey(cfg)
      serverInfo = { host: cfg.listenHost, port: addr?.port || cfg.listenPort, since: nowIso() }
      await pruneSnapshots(dir, { keep: cfg.keepSnapshots, maxTotalBytes: cfg.maxSnapshotMB * 1024 * 1024 })
      log('info', `snapshot hub ready on ${serverInfo.host}:${serverInfo.port}`)
    } catch (error) {
      server = null
      serverSignature = ''
      serverInfo = { error: String(error?.message || error) }
      log('error', `snapshot server failed: ${serverInfo.error}`)
    }
    return serverInfo
  }

  async function reconfigure() {
    refresh()
    const nextKey = serverKey(cfg)
    if (server && serverSignature !== nextKey) {
      await stopServer()
    }
    if (nextKey) {
      await startServer()
    } else if (server) {
      await stopServer()
    }
    armSchedule()
    return { cfg, server: serverInfo }
  }

  function scheduleStartup() {
    refresh()
    if (!cfg.enabled || !cfg.runOnStartup) {
      log('info', 'startup sync disabled by config')
      return
    }
    if (process.uptime() > cfg.startupGraceSec) {
      log('info', `plugin mounted after ${Math.round(process.uptime())}s; treating as a reload, not a boot`)
      return
    }
    if (startupTimer) return
    startupTimer = setTimeout(() => {
      startupTimer = null
      void execute('startup').then((run) => afterRun(run, 'startup'))
    }, 2500)
    startupTimer.unref?.()
  }

  async function test() {
    refresh()
    const started = Date.now()
    if (cfg.transport === 'http') {
      if (!cfg.peerUrl) return { ok: false, transport: 'http', error: 'peerUrl is empty' }
      let peer = null
      let pingError = ''
      try {
        const response = await callPeer(cfg.peerUrl, '/mem/ping', { timeoutMs: 5000 })
        peer = await response.json()
      } catch (error) {
        pingError = String(error?.message || error)
      }
      let auth = null
      if (peer?.ok) {
        if (!cfg.memSecret) {
          auth = { ok: false, error: 'memSecret is empty' }
        } else {
          try {
            const response = await callPeer(cfg.peerUrl, '/mem/list', {
              secret: cfg.memSecret,
              timeoutMs: 5000,
            })
            const doc = await response.json()
            auth = { ok: true, snapshots: Array.isArray(doc.items) ? doc.items.length : 0 }
          } catch (error) {
            auth = { ok: false, error: String(error?.message || error) }
          }
        }
      }
      return {
        ok: Boolean(peer?.ok) && Boolean(auth?.ok),
        transport: 'http',
        latencyMs: Date.now() - started,
        peer,
        auth,
        error: pingError,
      }
    }
    if (!cfg.peerHost || !cfg.peerUser) {
      return { ok: false, transport: 'git', error: 'peerHost / peerUser is empty' }
    }
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=6',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-p', String(cfg.peerPort),
    ]
    if (cfg.peerKeyPath) args.push('-i', cfg.peerKeyPath)
    args.push(`${cfg.peerUser}@${cfg.peerHost}`, 'echo ok')
    const result = await runProcess('ssh', args, { timeoutMs: Math.min(cfg.peerTimeoutMs, 15000) })
    return {
      ok: result.code === 0,
      transport: 'git',
      exitCode: result.code,
      timedOut: result.timedOut,
      detail: result.code === 0 ? '' : String(result.stderr || result.stdout || '').slice(-500),
      latencyMs: Date.now() - started,
    }
  }

  async function run(trigger = 'manual', options = {}) {
    return execute(trigger, options)
  }

  async function list() {
    refresh()
    return listSnapshots(cfg)
  }

  async function restore(id) {
    refresh()
    if (!id) throw new Error('snapshot id is required')
    return restoreHttpSnapshot(cfg, id, { machine: cfg.machine })
  }

  async function status() {
    refresh()
    const stored = lastRun || (await readJson(lastRunFile, null))
    const isHttp = cfg.transport === 'http'
    const repo = isHttp
      ? { path: cfg.repoPath, mode: 'snapshot' }
      : await inspectRepo(cfg).then((value) =>
          value.ok
            ? {
                path: cfg.repoPath,
                branch: value.branch,
                head: value.head,
                dirty: value.dirty,
                ahead: value.ahead,
                behind: value.behind,
                remote: value.remote,
              }
            : { path: cfg.repoPath, error: value.detail || 'not a git repo' },
        )
    const role = isHttp
      ? cfg.serve
        ? cfg.peerUrl
          ? 'both'
          : 'server'
        : 'client'
      : 'ssh'
    return {
      ok: isHttp || Boolean(repo.branch),
      transport: cfg.transport,
      role,
      machine: cfg.machine,
      server: serverInfo,
      peerUrl: cfg.peerUrl,
      peerHost: cfg.peerHost,
      peerUser: cfg.peerUser,
      peerPort: cfg.peerPort,
      repo,
      lastRun: stored,
      running: Boolean(running),
      enabled: cfg.enabled,
      mode: cfg.mode,
      peerConfigured: isHttp ? Boolean(cfg.peerUrl) : Boolean(cfg.peerHost && cfg.peerUser),
      rules: rulesOf(cfg),
      schedule: {
        intervalSendMinutes: cfg.intervalSendMinutes,
        lastAt: scheduleLastAt,
        nextAt: scheduleNextAt,
      },
      logFile: logger?.file || '',
      settingsPath: join(cfg.stateDir, 'settings.json'),
    }
  }

  async function logs(lines = 80) {
    refresh()
    const count = Math.max(1, Math.min(1000, Number(lines) || 80))
    const text = await readFile(logger?.file || join(cfg.stateDir, 'sync.log'), 'utf8').catch(() => '')
    const all = text.split(/\r?\n/).filter(Boolean)
    return all.slice(-count)
  }

  async function exportTo(path = '') {
    refresh()
    return exportSnapshot(cfg, { path, machine: cfg.machine })
  }

  async function importFrom(source, options = {}) {
    refresh()
    return importSnapshot(cfg, source, options)
  }

  function dispose() {
    disposed = true
    clearTimers()
    void server?.close?.()
    server = null
    serverInfo = null
  }

  return {
    scheduleStartup,
    startServer,
    reconfigure,
    run,
    test,
    logs,
    list,
    restore,
    exportTo,
    importFrom,
    status,
    dispose,
  }
}
