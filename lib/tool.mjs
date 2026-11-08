/** Tool spec for the agent; plain JSON Schema so no defineTool import is needed. */
export function memorySyncToolSpec(runtime) {
  return {
    name: 'memory_sync',
    description: [
      'Inspect or trigger the memory sync between this machine and its peer.',
      'action="run": run the sync now. In git mode this is the three-phase chain (local commit+push, peer commit+push over ssh, local pull). In http mode it pushes a snapshot to the peer and pulls the peer snapshot back.',
      'action="status": last run, repo state, transport, hub address and peer URL.',
      'action="list": snapshots stored locally and on the peer (http mode).',
      'action="restore" with snapshot=<id>: restore that snapshot into the memories directory (http mode; current files are backed up as *.bak-snapshot).',
      'Use it when the user asks whether memory is synced, asks to sync now, or asks to roll back to an earlier snapshot.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'status', 'list', 'restore'],
          description: 'run = sync now; status = last run and state; list = snapshots; restore = roll back to one snapshot.',
        },
        snapshot: {
          type: 'string',
          description: 'Snapshot id for action="restore" (from action="list").',
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
      if (action === 'run') return runtime.run('manual')
      if (action === 'status') return runtime.status()
      if (action === 'list') return runtime.list()
      if (action === 'restore') return runtime.restore(String(args?.snapshot || ''))
      return { ok: false, error: `unknown action: ${action}` }
    },
  }
}
