import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createConfigStore, redactConfig } from './lib/settings.mjs'
import { createRoutes } from './lib/routes.mjs'
import { createLogger, ensureDir, rotateLog } from './lib/state.mjs'
import { createSyncRuntime } from './lib/sync.mjs'
import { memorySyncToolSpec } from './lib/tool.mjs'

export const name = 'dsh-memory-sync'

const VERSION = (() => {
  for (const rel of ['./package.json', '../package.json']) {
    try {
      const value = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')).version
      if (value) return value
    } catch {
      // try the next layout (dist/index.js uses ../package.json)
    }
  }
  return ''
})()

const SHORT_MANUAL = `记忆同步：PC 与平板各装一份本插件，填同一个 memSecret，一端填另一端地址即可互传。
1) 两端都开 serve、互相填 peerUrl，任意一端都能手动发起同步。
2) 启动自同步：每次启动跑一次；定时发送：每 N 分钟推一次，0=关。
3) 冲突时保留：local=保本机较新内容，peer=保对端（覆盖前自动备份）。
4) 收到后回发：适合两端都想尽快拿到合并结果，只回发一次，不会循环。
5) 手动同步不受 autoApply 限制；定时/自动推送受对端 autoApply 控制。
6) 完全离线时导出 .json.gz，拷到另一端导入；导入前会先预览。`

/**
 * Config is optional on hosts without @deepseek-ai/schemastery. The tablet zip
 * bundles schemastery into dist/index.js so this schema still materializes the
 * native plugin settings form on Android.
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
  ? z
      .object({
        repoPath: field(z.string().default('').description('记忆目录；平板默认 dsh-home/memories')),
        remote: field(z.string().default('cloud').description('git remote 名；HTTP 模式不用')),
        branch: field(z.string().default('main').description('git 分支；HTTP 模式不用')),
        enabled: field(z.boolean().default(true).description('总开关；关闭后不启动定时/启动同步')),
        runOnStartup: field(z.boolean().default(true).description('启动时自同步一次')),
        startupGraceSec: field(z.natural().default(300).description('启动后多少秒内挂载算一次启动，超过视为热重载')),
        mode: field(z.string().default('peer').description('peer=有对端；local=只同步本机')),
        peerHost: field(z.string().default('').description('SSH 模式：对端地址')),
        peerUser: field(z.string().default('').description('SSH 模式：对端用户')),
        peerPort: field(z.natural().default(22).description('SSH 模式：端口')),
        peerKeyPath: field(z.string().default('').description('SSH 模式：私钥路径')),
        peerCommand: field(z.string().default('/usr/local/bin/dsh-mem-sync').description('SSH 模式：对端执行的同步脚本')),
        peerEnvName: field(z.string().default('cloud').description('SSH 模式：对端 DSH_SYNC_NAME')),
        retryDelaySec: field(z.natural().default(60).description('启动失败后第一次重试间隔（秒），0=关')),
        healIntervalSec: field(z.natural().default(600).description('失败后自愈重试间隔（秒），0=关')),
        notifyOnFailure: field(z.boolean().default(true).description('失败时弹系统窗口')),
        commitPrefix: field(z.string().default('sync').description('自动提交信息前缀')),
        gitPath: field(z.string().default('git').description('git 可执行文件')),
        localTimeoutMs: field(z.natural().default(120000).description('本机步骤超时（毫秒）')),
        peerTimeoutMs: field(z.natural().default(120000).description('对端步骤超时（毫秒）')),
        statusFile: field(z.string().default('').description('同步前写一份机器快照到该文件；空=不写')),
        transport: field(z.string().default('git').description('http=双方插件直连；git=单方插件 SSH 三段式')),
        peerUrl: field(z.string().default('').description('对端快照地址，例如 http://192.168.137.50:18792')),
        peerMachine: field(z.string().default('').description('对端名称，用于筛选对端快照')),
        machine: field(z.string().default('').description('本机名称；留空自动取主机名')),
        memSecret: field(z.string().default('').description('两端一致的共享密钥；注意隐私，设置页会明文显示')),
        serve: field(z.boolean().default(true).description('本机是否开快照服务，让对端能连进来')),
        listenHost: field(z.string().default('0.0.0.0').description('快照服务监听地址；局域网填 0.0.0.0')),
        listenPort: field(z.natural().default(18792).description('快照服务端口，两端要能互访')),
        autoApply: field(z.boolean().default(true).description('收到自动/定时推送的快照时是否立即合并；手动推送不受此限制')),
        keepSnapshots: field(z.natural().default(5).description('本机保留几份快照')),
        maxSnapshotMB: field(z.natural().default(100).description('快照总大小上限（MB）')),
        intervalSendMinutes: field(z.natural().default(0).description('每 N 分钟发送一次快照；0=关闭。HTTP 只推送，SSH 跑三段')),
        conflict: field(z.string().default('peer').description('冲突时保留：local=保本机较新内容，peer=保对端（覆盖前备份）')),
        replyOnReceive: field(z.boolean().default(false).description('收到对端同步且真的写入后，回发一次合并快照')),
      })
      .description(SHORT_MANUAL)
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
  const store = createConfigStore(config, process.env)
  const cfg = store.current()
  await ensureDir(cfg.stateDir).catch(() => {})
  await rotateLog(join(cfg.stateDir, 'sync.log')).catch(() => {})

  const logger = pickLogger(createLogger({ dir: cfg.stateDir, tag: 'memory-sync' }))
  const runtime = createSyncRuntime({ getConfig: () => store.current(), logger })

  const disposers = []
  if (typeof ctx?.tools?.register === 'function') {
    try {
      disposers.push(ctx.tools.register(memorySyncToolSpec(runtime)))
    } catch (error) {
      logger.warn(`tool registration failed: ${error?.message || error}`)
    }
  }

  const mountRoutes = (hostCtx) => {
    const webServer = hostCtx?.webServer ?? hostCtx?.get?.('webServer')
    if (!webServer || typeof webServer.register !== 'function') return
    try {
      const origin = typeof webServer.getOrigin === 'function' ? webServer.getOrigin() : ''
      const routes = createRoutes({ runtime, store, version: VERSION, origin })
      disposers.push(webServer.register({ kind: 'prefix', path: '/memory-sync', handler: routes.handle }))
      logger.info('settings api mounted at /memory-sync/api')
    } catch (error) {
      logger.warn(`web route registration failed: ${error?.message || error}`)
    }
  }

  // On a cold boot a bundle row can be instantiated before the web server
  // exists (the server rides a later row); acquire it lazily.
  if (typeof ctx?.inject === 'function') {
    disposers.push(ctx.inject(['webServer'], (hostCtx) => mountRoutes(hostCtx)))
  } else {
    mountRoutes(ctx)
  }

  await runtime.reconfigure().catch(() => {})
  runtime.scheduleStartup()
  logger.info(
    `ready: repo=${cfg.repoPath} transport=${cfg.transport} mode=${cfg.mode} ` +
      `conflict=${cfg.conflict} interval=${cfg.intervalSendMinutes}m settings=${store.file()}`,
  )

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

export { redactConfig }
