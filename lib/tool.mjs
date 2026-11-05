/** Tool spec for the agent; plain JSON Schema so no defineTool import is needed. */
export function memorySyncToolSpec(runtime) {
  return {
    name: 'memory_sync',
    description: [
      'Inspect or trigger the startup memory sync (git repo shared between this machine and a peer).',
      'action="run" runs the three phases now: local commit+push, peer commit+push over ssh, local pull.',
      'action="status" reports the last run, HEAD, dirty state and whether the peer is configured.',
      'Use it when the user asks whether memory is synced, or asks to sync right now.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'status'],
          description: 'run = sync now; status = last run and repo state.',
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
      return { ok: false, error: `unknown action: ${action}` }
    },
  }
}
