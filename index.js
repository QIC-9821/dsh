import { join } from 'node:path'

import { normalizeConfig } from './lib/config.mjs'
import { ensureDir, createLogger, rotateLog } from './lib/state.mjs'
import { createSyncRuntime } from './lib/sync.mjs'
import { memorySyncToolSpec } from './lib/tool.mjs'

export const name = 'dsh-memory-sync'

/**
 * Config is optional: hosts without @deepseek-ai/schemastery must still load
 * the plugin (they just lose the generated settings form).
 */
let z = null
try {
  const mod = await import('@deepseek-ai/schemastery')
  z = mod?.default ?? mod ?? null
} catch {
  z = null
}

const field = (schema) => (typeof schema?.extra === 'function' ? schema.extra('volatile', true) : schema)

export const Config = z
  ? z.object({
      repoPath: field(z.string().default('')),
      remote: field(z.string().default('cloud')),
      branch: field(z.string().default('main')),
      enabled: field(z.boolean().default(true)),
      runOnStartup: field(z.boolean().default(true)),
      startupGraceSec: field(z.natural().default(300)),
      mode: field(z.string().default('peer')),
      peerHost: field(z.string().default('')),
      peerUser: field(z.string().default('')),
      peerKeyPath: field(z.string().default('')),
      peerCommand: field(z.string().default('/usr/local/bin/dsh-mem-sync')),
      peerEnvName: field(z.string().default('cloud')),
      retryDelaySec: field(z.natural().default(60)),
      healIntervalSec: field(z.natural().default(600)),
      notifyOnFailure: field(z.boolean().default(true)),
      commitPrefix: field(z.string().default('sync')),
      gitPath: field(z.string().default('git')),
      localTimeoutMs: field(z.natural().default(120000)),
      peerTimeoutMs: field(z.natural().default(120000)),
    })
  : undefined

export const inject = ['tools']

function pickLogger(logger) {
  if (typeof logger?.info === 'function') return logger
  return {
    info: (...args) => console.log('[memory-sync]', ...args),
    warn: (...args) => console.warn('[memory-sync]', ...args),
    error: (...args) => console.error('[memory-sync]', ...args),
  }
}

export async function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config, process.env)
  await ensureDir(cfg.stateDir).catch(() => {})
  await rotateLog(join(cfg.stateDir, 'sync.log')).catch(() => {})

  const logger = pickLogger(createLogger({ dir: cfg.stateDir, tag: 'memory-sync' }))
  const runtime = createSyncRuntime({ cfg, logger })

  const disposers = []
  if (typeof ctx?.tools?.register === 'function') {
    try {
      disposers.push(ctx.tools.register(memorySyncToolSpec(runtime)))
    } catch (error) {
      logger.warn(`tool registration failed: ${error?.message || error}`)
    }
  }

  runtime.scheduleStartup()
  logger.info(`ready: repo=${cfg.repoPath} mode=${cfg.mode} remote=${cfg.remote}/${cfg.branch}`)

  const dispose = async () => {
    runtime.dispose()
    for (const disposer of disposers.reverse()) {
      try {
        disposer?.()
      } catch {
        // ignore teardown errors
      }
    }
  }

  ctx.effect?.(() => () => dispose(), 'dsh-memory-sync: teardown')
  return dispose
}
