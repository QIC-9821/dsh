import { join } from 'node:path'

import { acquireLock } from './lock.mjs'
import { inspectRepo, runStartupChain } from './git.mjs'
import { notifyFailure } from './notify.mjs'
import { readJson, writeJsonAtomic } from './state.mjs'

/**
 * Owns the startup timer, the one-at-a-time lock, retry/self-heal timers and
 * the last-run record. Pure Node; no host services besides the injected logger.
 */
export function createSyncRuntime({ cfg, logger }) {
  const lastRunFile = join(cfg.stateDir, 'last-run.json')
  const lockDir = join(cfg.stateDir, 'lock')

  let startupTimer = null
  let retryTimer = null
  let healTimer = null
  let running = null
  let lastRun = null
  let notified = false
  let disposed = false

  const log = (level, message) => logger?.[level]?.(message)

  function clearTimers() {
    for (const timer of [startupTimer, retryTimer, healTimer]) {
      if (timer) clearTimeout(timer)
    }
    startupTimer = null
    retryTimer = null
    healTimer = null
  }

  async function execute(trigger) {
    if (disposed) return { ok: false, skipped: true, trigger, reason: 'disposed' }
    if (running) return running

    running = (async () => {
      const lock = await acquireLock(lockDir)
      if (!lock) return { ok: false, locked: true, trigger, at: new Date().toISOString() }
      try {
        log('info', `sync start (${trigger}) mode=${cfg.mode}`)
        const result = await runStartupChain(cfg)
        const run = { ...result, trigger, at: new Date().toISOString() }
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
          at: new Date().toISOString(),
          error: String(error?.message || error),
        }
        lastRun = run
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
        message: `三段同步没有完成（${detail}）。详见 ${logger?.file || cfg.stateDir}。`,
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
    finalFailure(run)
  }

  function scheduleStartup() {
    if (!cfg.enabled || !cfg.runOnStartup) {
      log('info', 'startup sync disabled by config')
      return
    }
    if (process.uptime() > cfg.startupGraceSec) {
      log('info', `plugin mounted after ${Math.round(process.uptime())}s; treating as a reload, not a boot`)
      return
    }
    // Let the app finish booting before touching git or ssh.
    startupTimer = setTimeout(() => {
      startupTimer = null
      void execute('startup').then((run) => afterRun(run, 'startup'))
    }, 2500)
    startupTimer.unref?.()
  }

  async function run(trigger = 'manual') {
    return execute(trigger)
  }

  async function status() {
    const stored = lastRun || (await readJson(lastRunFile, null))
    const repo = await inspectRepo(cfg)
    return {
      ok: Boolean(repo.ok),
      repo: repo.ok
        ? {
            path: cfg.repoPath,
            branch: repo.branch,
            head: repo.head,
            dirty: repo.dirty,
            ahead: repo.ahead,
            behind: repo.behind,
            remote: repo.remote,
          }
        : { path: cfg.repoPath, error: repo.detail || 'not a git repo' },
      lastRun: stored,
      running: Boolean(running),
      enabled: cfg.enabled,
      mode: cfg.mode,
      peerConfigured: Boolean(cfg.peerHost && cfg.peerUser),
      logFile: logger?.file || '',
    }
  }

  function dispose() {
    disposed = true
    clearTimers()
  }

  return { scheduleStartup, run, status, dispose }
}
