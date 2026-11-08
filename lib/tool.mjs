/** Tool spec for the agent; plain JSON Schema so no defineTool import is needed. */
export function memorySyncToolSpec(runtime) {
  return {
    name: 'memory_sync',
    description: [
      'Inspect or trigger the memory sync between this machine and its peer.',
      'action="run": run the sync now. direction=both|push|pull (http mode); git mode always runs the three-phase chain.',
      'action="status": last run, transport, rules, schedule, hub address and peer URL.',
      'action="list": snapshots stored locally and on the peer (http mode).',
      'action="restore" with snapshot=<id>: restore that snapshot into the memories directory (http mode; current files are backed up as *.bak-snapshot).',
      'action="export" with path=<file>: write a portable .json.gz snapshot (default under $DSH_HOME/memory-sync/exports).',
      'action="import" with path=<file> and dryRun=true|false: merge that snapshot into the memories directory.',
      'Use it when the user asks whether memory is synced, asks to sync now, or asks to move memory offline.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'status', 'list', 'restore', 'export', 'import'],
          description: 'run = sync now; status = state; list = snapshots; restore = roll back; export/import = offline snapshot.',
        },
        direction: {
          type: 'string',
          enum: ['both', 'push', 'pull'],
          description: 'For action="run" in http mode. Default both.',
        },
        snapshot: {
          type: 'string',
          description: 'Snapshot id for action="restore" (from action="list").',
        },
        path: {
          type: 'string',
          description: 'Snapshot file for action="export" (destination) or action="import" (source).',
        },
        dryRun: {
          type: 'boolean',
          description: 'For action="import": preview what would be written without touching files.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    timeoutMs: 300000,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return [{
          type: 'text',
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }]
      },
    },
    async execute(args) {
      const action = String(args?.action || 'status')
      const direction = ['both', 'push', 'pull'].includes(args?.direction) ? args.direction : 'both'
      if (action === 'run') return runtime.run('manual', { direction })
      if (action === 'status') return runtime.status()
      if (action === 'list') return runtime.list()
      if (action === 'restore') return runtime.restore(String(args?.snapshot || ''))
      if (action === 'export') return runtime.exportTo(String(args?.path || ''))
      if (action === 'import') {
        const path = String(args?.path || '')
        if (!path) return { ok: false, error: 'path is required' }
        return runtime.importFrom(path, { dryRun: args?.dryRun === true, path })
      }
      return { ok: false, error: `unknown action: ${action}` }
    },
  }
}
