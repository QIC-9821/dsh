import { spawn } from 'node:child_process'

function runDetached(command, args) {
  try {
    const child = spawn(command, args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    })
    child.unref?.()
    return true
  } catch {
    return false
  }
}

/**
 * Best-effort failure popup. There is no host notification service, so this
 * talks to the OS directly. Never throws: a missing notifier must not turn a
 * sync failure into a crash.
 */
export async function notifyFailure({ title, message, logger } = {}) {
  const safeTitle = String(title || 'DSH memory sync failed')
  const safeMessage = String(message || 'The startup memory sync did not complete.')
  try {
    if (process.platform === 'win32') {
      const script = [
        '$w = New-Object -ComObject WScript.Shell;',
        `$null = $w.Popup('${escapePowerShell(safeMessage)}', 300, '${escapePowerShell(safeTitle)}', 48)`,
      ].join(' ')
      runDetached('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-Command', script,
      ])
      return
    }
    if (process.platform === 'darwin') {
      const escaped = safeMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const escapedTitle = safeTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      runDetached('osascript', ['-e', `display dialog "${escaped}" with title "${escapedTitle}" buttons {"OK"} default button 1 with icon caution`])
      return
    }
    runDetached('notify-send', ['--urgency=critical', safeTitle, safeMessage])
  } catch (error) {
    logger?.warn?.(`notify failed: ${error?.message || error}`)
  }
}

function escapePowerShell(text) {
  return String(text).replace(/\r?\n/g, ' ').replace(/'/g, "''")
}
