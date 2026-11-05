import { spawn } from 'node:child_process'
import { hostname } from 'node:os'

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Local ISO timestamp with a numeric offset, e.g. 2026-11-05T15:53:12+0800. */
export function localIso(date = new Date()) {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`
}

export function tail(text, limit = 500) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= limit) return clean
  return `…${clean.slice(-limit)}`
}

/** Kill the whole tree on Windows (cmd/git may spawn children). */
function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      return
    } catch {
      // fall through
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // already gone
  }
}

/**
 * Run a process without a shell, with a timeout and a bounded output buffer.
 */
export function runProcess(command, args, {
  cwd,
  env,
  timeoutMs = 60000,
  maxBytes = 4 * 1024 * 1024,
} = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let settled = false
    let timer = null

    const finish = (code, signal, errorMessage = '') => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        code: Number.isInteger(code) ? code : -1,
        signal: signal || null,
        stdout,
        stderr: errorMessage && !stderr ? errorMessage : stderr,
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      })
    }

    let child
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...(env || {}) },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish(-1, null, String(error?.message || error))
      return
    }

    const take = (chunk, which) => {
      const text = chunk.toString('utf8')
      if (which === 'out') {
        const room = maxBytes - stdout.length
        if (room <= 0) {
          truncated = true
          return
        }
        stdout += room >= text.length ? text : text.slice(0, room)
        if (room < text.length) truncated = true
        return
      }
      const room = maxBytes - stderr.length
      if (room > 0) stderr += room >= text.length ? text : text.slice(0, room)
    }

    child.stdout?.on('data', (chunk) => take(chunk, 'out'))
    child.stderr?.on('data', (chunk) => take(chunk, 'err'))
    child.on('error', (error) => finish(-1, null, String(error?.message || error)))
    child.on('close', (code, signal) => finish(code, signal))

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        killTree(child)
      }, Math.max(250, timeoutMs))
      timer.unref?.()
    }
  })
}

export async function runGit(cfg, args, { timeoutMs = cfg.localTimeoutMs, cwd = cfg.repoPath } = {}) {
  return runProcess(cfg.gitPath, ['-C', cwd, ...args], { cwd, timeoutMs })
}

export async function resolveRemote(cfg) {
  for (const name of [cfg.remote, 'origin', 'cloud']) {
    if (!name) continue
    const result = await runGit(cfg, ['remote', 'get-url', name], { timeoutMs: 15000 })
    if (result.code === 0 && result.stdout.trim()) return name
  }
  return ''
}

export async function inspectRepo(cfg) {
  const dir = await runGit(cfg, ['rev-parse', '--git-dir'], { timeoutMs: 15000 })
  if (dir.code !== 0) {
    return { ok: false, detail: tail(dir.stderr || dir.stdout) || 'not a git repo' }
  }

  const branchResult = await runGit(cfg, ['branch', '--show-current'], { timeoutMs: 15000 })
  const branch = branchResult.stdout.trim() || cfg.branch
  const headResult = await runGit(cfg, ['rev-parse', '--short', 'HEAD'], { timeoutMs: 15000 })
  const status = await runGit(cfg, ['status', '--porcelain'], { timeoutMs: 20000 })
  const remote = await resolveRemote(cfg)

  let ahead = 0
  let behind = 0
  if (remote) {
    const counts = await runGit(
      cfg,
      ['rev-list', '--left-right', '--count', `HEAD...${remote}/${cfg.branch}`],
      { timeoutMs: 20000 },
    )
    if (counts.code === 0) {
      const [a, b] = counts.stdout.trim().split(/\s+/).map(Number)
      ahead = Number.isFinite(a) ? a : 0
      behind = Number.isFinite(b) ? b : 0
    }
  }

  return {
    ok: true,
    branch,
    head: headResult.code === 0 ? headResult.stdout.trim() : '',
    dirty: status.stdout.trim().length > 0,
    ahead,
    behind,
    remote,
  }
}

function failure(phase, started, detail, extra = {}) {
  return {
    name: phase,
    ok: false,
    durationMs: Date.now() - started,
    detail: tail(detail),
    ...extra,
  }
}

/**
 * One local round trip: pull --rebase --autostash, commit dirty files, push.
 * A rejected push is retried once after fetch + rebase (the non-fast-forward case).
 */
export async function syncLocal(cfg) {
  const started = Date.now()
  const repo = await inspectRepo(cfg)
  if (!repo.ok) return failure('local', started, repo.detail)
  if (!repo.remote) return failure('local', started, `no git remote named ${cfg.remote} (or origin)`)

  const pullArgs = ['pull', '--rebase', '--autostash', repo.remote, cfg.branch]
  let pull = await runGit(cfg, pullArgs)
  if (pull.code !== 0) {
    // A conflicted rebase leaves the work tree in a rebase state; abort so the
    // user's files stay usable, then report instead of guessing a resolution.
    await runGit(cfg, ['rebase', '--abort'], { timeoutMs: 15000 })
    pull = await runGit(cfg, pullArgs)
    if (pull.code !== 0) {
      const detail = pull.stderr || pull.stdout
      return failure('local', started, detail, { phase: 'pull', conflict: /conflict/i.test(detail) })
    }
  }

  await runGit(cfg, ['add', '-A'])
  const status = await runGit(cfg, ['status', '--porcelain'])
  let committed = false
  if (status.stdout.trim()) {
    const nameResult = await runGit(cfg, ['config', 'user.name'], { timeoutMs: 10000 })
    const emailResult = await runGit(cfg, ['config', 'user.email'], { timeoutMs: 10000 })
    const commitArgs = ['commit', '-m', `${cfg.commitPrefix}: ${hostname()} ${localIso()}`]
    if (!nameResult.stdout.trim()) commitArgs.unshift('-c', 'user.name=DSH Memory Sync')
    if (!emailResult.stdout.trim()) commitArgs.unshift('-c', 'user.email=memory-sync@localhost')
    const commit = await runGit(cfg, commitArgs)
    if (commit.code !== 0) return failure('local', started, commit.stderr || commit.stdout, { phase: 'commit' })
    committed = true
  }

  let push = await runGit(cfg, ['push', repo.remote, `HEAD:${cfg.branch}`])
  let retried = false
  if (push.code !== 0) {
    retried = true
    await runGit(cfg, ['fetch', repo.remote], { timeoutMs: 30000 })
    const rebase = await runGit(cfg, ['rebase', `${repo.remote}/${cfg.branch}`], { timeoutMs: 30000 })
    if (rebase.code === 0) {
      push = await runGit(cfg, ['push', repo.remote, `HEAD:${cfg.branch}`])
    } else {
      await runGit(cfg, ['rebase', '--abort'], { timeoutMs: 15000 })
    }
  }
  if (push.code !== 0) {
    const detail = push.stderr || push.stdout
    return failure('local', started, detail, { phase: 'push', retried, conflict: /conflict/i.test(detail) })
  }

  const after = await inspectRepo(cfg)
  return {
    name: 'local',
    ok: true,
    durationMs: Date.now() - started,
    committed,
    retried,
    head: after.ok ? after.head : '',
    dirty: after.ok ? after.dirty : false,
  }
}

/** Phase two: ask the peer to commit and push its side. */
export async function syncPeer(cfg) {
  const started = Date.now()
  if (cfg.mode !== 'peer') {
    return { name: 'peer', ok: true, skipped: true, durationMs: 0, detail: 'local 模式' }
  }
  if (!cfg.peerHost || !cfg.peerUser) {
    return failure('peer', started, 'peerHost / peerUser 未配置，已跳过云端段')
  }

  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'StrictHostKeyChecking=accept-new',
  ]
  if (cfg.peerKeyPath) args.push('-i', cfg.peerKeyPath)
  args.push(`${cfg.peerUser}@${cfg.peerHost}`, `DSH_SYNC_NAME=${cfg.peerEnvName} ${cfg.peerCommand}`)

  const result = await runProcess('ssh', args, { timeoutMs: cfg.peerTimeoutMs })
  return {
    name: 'peer',
    ok: result.code === 0,
    exitCode: result.code,
    durationMs: Date.now() - started,
    timedOut: result.timedOut,
    detail: result.code === 0 ? '' : tail(result.stderr || result.stdout),
  }
}

/** The three-phase startup handshake: local push -> peer commit/push -> local pull. */
export async function runStartupChain(cfg) {
  const phases = []
  phases.push(await syncLocal(cfg))
  phases.push(await syncPeer(cfg))
  phases.push(await syncLocal(cfg))
  const checked = phases.filter((phase) => !phase.skipped)
  const ok = checked.every((phase) => phase.ok)
  return { ok, phases, head: phases[phases.length - 1]?.head || '' }
}
