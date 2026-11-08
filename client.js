window.__ModuleLoader__.load({
  id: 'dsh-memory-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const API = '/memory-sync/api/'

    const CARD = {
      border: '1px solid var(--dsh-border, rgba(127,127,127,.28))',
      borderRadius: 12,
      padding: '14px 16px',
      marginBottom: 14,
      background: 'var(--dsh-surface, transparent)',
    }
    const LABEL = { fontSize: 12.5, opacity: 0.7, marginBottom: 4 }
    const INPUT = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 9px',
      borderRadius: 8,
      border: '1px solid var(--dsh-border, rgba(127,127,127,.35))',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
    }
    const BUTTON = {
      padding: '7px 14px',
      borderRadius: 8,
      border: '1px solid var(--dsh-border, rgba(127,127,127,.35))',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit',
    }
    const PRIMARY = { ...BUTTON, background: 'var(--dsh-accent, #3b82f6)', borderColor: 'var(--dsh-accent, #3b82f6)', color: '#fff' }
    const MUTED = { fontSize: 12.5, opacity: 0.65 }
    const ROW = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 13 }
    const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }

    async function api(path, options) {
      const response = await fetch(API + path, options)
      const text = await response.text()
      let value
      try {
        value = JSON.parse(text)
      } catch {
        value = { error: text || `HTTP ${response.status}` }
      }
      if (!response.ok || value?.ok === false) {
        throw new Error(value?.error || value?.result?.error || `HTTP ${response.status}`)
      }
      return value
    }

    function post(path, body) {
      return api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
    }

    function Card(props) {
      return h('div', { style: CARD }, [
        h('div', { key: 'title', style: { fontSize: 13.5, fontWeight: 600, marginBottom: 10 } }, props.title),
        ...(Array.isArray(props.children) ? props.children : [props.children]),
      ])
    }

    function Field(props) {
      return h('div', { style: { marginTop: props.first ? 0 : 10 } }, [
        props.label ? h('div', { key: 'label', style: LABEL }, props.label) : null,
        props.children,
        props.help ? h('div', { key: 'help', style: MUTED }, props.help) : null,
      ])
    }

    function Text(props) {
      return h('input', {
        style: INPUT,
        value: props.value === undefined || props.value === null ? '' : String(props.value),
        placeholder: props.placeholder || '',
        type: props.type || 'text',
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    function Select(props) {
      return h(
        'select',
        {
          style: INPUT,
          value: props.value === undefined || props.value === null ? '' : String(props.value),
          onChange: (event) => props.onChange(event.target.value),
        },
        props.options.map(([value, label]) => h('option', { key: value, value }, label)),
      )
    }

    function Toggle(props) {
      return h(
        'label',
        {
          style: {
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '6px 0',
            borderBottom: '1px dashed var(--dsh-border, rgba(127,127,127,.25))',
            cursor: 'pointer',
          },
        },
        [
          h('input', {
            key: 'box',
            type: 'checkbox',
            checked: Boolean(props.checked),
            onChange: (event) => props.onChange(event.target.checked),
            style: { marginTop: 2 },
          }),
          h('span', { key: 'text' }, [
            h('b', { key: 'name' }, props.label),
            props.dirty ? h('span', { key: 'dirty', style: { marginLeft: 6, fontSize: 11, color: 'var(--dsh-accent, #3b82f6)' } }, '未保存') : null,
            props.desc ? h('div', { key: 'desc', style: MUTED }, props.desc) : null,
          ]),
        ],
      )
    }

    function bytes(value) {
      const n = Number(value) || 0
      if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
      if (n > 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${n} B`
    }

    function clock(value) {
      if (!value) return '—'
      try {
        return new Date(value).toLocaleString()
      } catch {
        return String(value)
      }
    }

    function phaseLine(phase) {
      const bits = [phase.name, phase.ok ? 'ok' : 'FAILED']
      if (phase.ms !== undefined) bits.push(`${phase.ms}ms`)
      if (phase.files !== undefined) bits.push(`${phase.files} files`)
      if (phase.bytes !== undefined) bits.push(bytes(phase.bytes))
      if (phase.from) bits.push(`from ${phase.from}`)
      if (phase.written) bits.push(`wrote ${Array.isArray(phase.written) ? phase.written.length : phase.written}`)
      if (phase.applied && phase.applied.written) bits.push(`peer applied ${phase.applied.written.length}`)
      if (phase.error) bits.push(phase.error)
      return bits.join(' · ')
    }

    function SettingsPage() {
      const [data, setData] = useState(null)
      const [draft, setDraft] = useState({})
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [note, setNote] = useState('')
      const [result, setResult] = useState(null)
      const [test, setTest] = useState(null)
      const [logs, setLogs] = useState([])
      const [snapshots, setSnapshots] = useState(null)
      const [preview, setPreview] = useState(null)
      const [pendingImport, setPendingImport] = useState(null)
      const [clearSecret, setClearSecret] = useState(false)

      const load = useCallback(async () => {
        try {
          const next = await api('state')
          setData(next)
          setError('')
        } catch (err) {
          setError(String(err?.message || err))
        }
      }, [])

      useEffect(() => {
        void load()
        const timer = setInterval(() => void load(), 8000)
        return () => clearInterval(timer)
      }, [load])

      const config = data?.config || {}
      const status = data?.status || {}
      const rules = status.rules || {}
      const dirty = Object.keys(draft)
      const value = (key) => (draft[key] !== undefined ? draft[key] : config[key])
      const set = (key, next) => setDraft((current) => ({ ...current, [key]: next }))
      const dirtyOf = (key) => draft[key] !== undefined

      async function run(label, fn) {
        setBusy(label)
        setError('')
        setNote('')
        try {
          await fn()
        } catch (err) {
          setError(String(err?.message || err))
        } finally {
          setBusy('')
        }
      }

      async function save() {
        const patch = { ...draft }
        if (patch.memSecret === '') delete patch.memSecret
        await run('save', async () => {
          const next = await post('config', { patch, clearSecret })
          setData(next)
          setDraft({})
          setClearSecret(false)
          setNote('已保存到 settings.json，并立即生效。')
        })
      }

      async function reset() {
        if (!window.confirm('删除本页保存的覆盖项，回到 profile 里的配置？')) return
        await run('reset', async () => {
          const next = await post('reset')
          setData(next)
          setDraft({})
          setClearSecret(false)
          setNote('已恢复 profile 配置。')
        })
      }

      async function sync(direction) {
        await run(`sync-${direction}`, async () => {
          const next = await post('sync', { direction })
          setResult(next.result)
          setData((current) => ({ ...current, status: next.status }))
        })
      }

      async function testPeer() {
        await run('test', async () => {
          const next = await post('test')
          setTest(next.result)
        })
      }

      async function loadLogs() {
        await run('logs', async () => {
          const next = await api('logs?lines=80')
          setLogs(next.lines || [])
        })
      }

      async function loadSnapshots() {
        await run('snapshots', async () => {
          setSnapshots(await api('snapshots'))
        })
      }

      async function restore(id) {
        if (!window.confirm(`恢复快照 ${id}？当前文件会先备份。`)) return
        await run('restore', async () => {
          const next = await post('restore', { id })
          setNote(`已恢复 ${id}：写入 ${next.result?.written?.length ?? 0} 个文件`)
          await load()
        })
      }

      async function exportSnapshot() {
        await run('export', async () => {
          const response = await fetch(API + 'export')
          if (!response.ok) throw new Error(`导出失败：HTTP ${response.status}`)
          const blob = await response.blob()
          const name = `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = name
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 30000)
          setNote(`已导出 ${name}（${bytes(blob.size)}）`)
        })
      }

      function pickImport(file) {
        if (!file) return
        setPendingImport(file)
        setPreview(null)
        void run('import-preview', async () => {
          const buffer = await file.arrayBuffer()
          const response = await fetch(API + 'import?dryRun=1', {
            method: 'POST',
            headers: { 'content-type': 'application/gzip' },
            body: buffer,
          })
          const value = await response.json()
          if (!response.ok || value?.ok === false) throw new Error(value?.error || `HTTP ${response.status}`)
          setPreview(value.result)
        })
      }

      async function confirmImport() {
        if (!pendingImport) return
        await run('import', async () => {
          const buffer = await pendingImport.arrayBuffer()
          const response = await fetch(API + 'import', {
            method: 'POST',
            headers: { 'content-type': 'application/gzip' },
            body: buffer,
          })
          const value = await response.json()
          if (!response.ok || value?.ok === false) throw new Error(value?.error || `HTTP ${response.status}`)
          setNote(`导入完成：写入 ${value.result?.written?.length ?? 0} 个文件，备份 ${value.result?.backups?.length ?? 0} 个`)
          setPreview(null)
          setPendingImport(null)
          await load()
        })
      }

      if (!data) {
        return h('div', { style: { padding: 20 } }, error ? `读取失败：${error}` : '读取记忆同步状态…')
      }

      const role = value('transport') === 'git'
        ? 'ssh'
        : value('serve')
          ? value('peerUrl')
            ? 'both'
            : 'server'
          : 'client'

      const setRole = (next) => {
        if (next === 'client') {
          set('serve', false)
        } else if (next === 'server') {
          set('serve', true)
          set('peerUrl', '')
        } else {
          set('serve', true)
        }
      }

      const interval = Number(value('intervalSendMinutes') || 0)

      return h('div', { style: { maxWidth: 860, margin: '0 auto', padding: '4px 0 24px' } }, [
        h('div', { key: 'head', style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 } }, [
          h('h2', { key: 'title', style: { margin: 0, fontSize: 18 } }, '记忆同步'),
          h('span', { key: 'ver', style: MUTED }, `v${data.version || '?'} · ${status.machine || '?'}`),
        ]),

        error ? h('div', { key: 'err', style: { padding: '9px 12px', marginBottom: 12, borderRadius: 8, background: 'rgba(239,68,68,.12)', color: '#ef4444', fontSize: 13 } }, error) : null,
        note ? h('div', { key: 'note', style: { padding: '9px 12px', marginBottom: 12, borderRadius: 8, background: 'rgba(34,197,94,.12)', color: '#16a34a', fontSize: 13 } }, note) : null,

        h(Card, { key: 'status', title: '状态' }, [
          h('div', { key: 'rows' }, [
            h('div', { key: 'a', style: ROW }, [h('span', { key: 'k' }, '传输'), h('b', { key: 'v' }, value('transport') === 'http' ? 'HTTP 快照' : 'SSH 三段式')]),
            h('div', { key: 'b', style: ROW }, [h('span', { key: 'k' }, '角色'), h('b', { key: 'v' }, { client: '客户端', server: '服务端', both: '双向节点', ssh: 'SSH' }[role] || role)]),
            h('div', { key: 'c', style: ROW }, [h('span', { key: 'k' }, '对端'), h('span', { key: 'v' }, status.peerUrl || status.peerHost || '未配置')]),
            h('div', { key: 'd', style: ROW }, [h('span', { key: 'k' }, '快照服务'), h('span', { key: 'v' }, status.server?.error ? `错误：${status.server.error}` : status.server ? `${status.server.host}:${status.server.port}` : '未启动')]),
            h('div', { key: 'e', style: ROW }, [h('span', { key: 'k' }, '上次同步'), h('span', { key: 'v' }, status.lastRun ? `${clock(status.lastRun.at)} · ${status.lastRun.ok ? 'ok' : '失败'}` : '还没跑过')]),
            h('div', { key: 'f', style: ROW }, [h('span', { key: 'k' }, '定时发送'), h('span', { key: 'v' }, interval > 0 ? `每 ${interval} 分钟 · 下次 ${clock(status.schedule?.nextAt)}` : '关闭')]),
          ]),
          h('div', { key: 'buttons', style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 } }, [
            h('button', { key: 'test', style: BUTTON, disabled: Boolean(busy), onClick: () => void testPeer() }, busy === 'test' ? '测试中…' : '测试连接'),
            h('button', { key: 'sync', style: PRIMARY, disabled: Boolean(busy), onClick: () => void sync('both') }, busy === 'sync-both' ? '同步中…' : '立即双向同步'),
            h('button', { key: 'push', style: BUTTON, disabled: Boolean(busy), onClick: () => void sync('push') }, '仅推送'),
            h('button', { key: 'pull', style: BUTTON, disabled: Boolean(busy), onClick: () => void sync('pull') }, '仅拉取'),
            h('button', { key: 'reload', style: BUTTON, disabled: Boolean(busy), onClick: () => void load() }, '刷新'),
          ]),
          test ? h('div', { key: 'testout', style: { ...MUTED, marginTop: 8, whiteSpace: 'pre-wrap' } }, JSON.stringify(test, null, 2)) : null,
          result ? h('div', { key: 'run', style: { marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(127,127,127,.08)', fontSize: 12.5 } }, [
            h('div', { key: 'h', style: { fontWeight: 600, marginBottom: 4 } }, `本次结果 · ${result.trigger || 'manual'} · ${result.ok ? 'ok' : '失败'}`),
            ...(result.phases || []).map((phase, index) => h('div', { key: index }, phaseLine(phase))),
            result.error ? h('div', { key: 'e', style: { color: '#ef4444' } }, result.error) : null,
          ]) : null,
        ]),

        h(Card, { key: 'transport', title: '传输方式' }, [
          h(Field, { key: 't', first: true, label: '怎么连对端' }, h(Select, {
            value: value('transport'),
            options: [
              ['http', '双方插件 · 局域网直连（推荐）'],
              ['git', '单方插件 · SSH + 对端脚本'],
            ],
            onChange: (next) => set('transport', next),
          })),
          h(Field, { key: 'role', label: '本机角色', help: '两端都开 serve 并互相填 peerUrl，就是「双向节点」，任意一端都能发起。' }, h(Select, {
            value: role === 'ssh' ? 'client' : role,
            options: [
              ['client', '客户端：连对端，不开服务'],
              ['server', '服务端：等对端来连'],
              ['both', '双向节点：既服务又连对端'],
            ],
            onChange: setRole,
          })),
        ]),

        value('transport') === 'http'
          ? h(Card, { key: 'http', title: '双方插件直连' }, [
              h('div', { key: 'grid', style: GRID }, [
                h(Field, { key: 'peerUrl', first: true, label: '对端地址' }, h(Text, { value: value('peerUrl'), placeholder: 'http://192.168.137.50:18792', onChange: (v) => set('peerUrl', v) })),
                h(Field, { key: 'secret', label: '共享密钥' }, h(Text, {
                  value: value('memSecret'),
                  type: 'password',
                  placeholder: config.memSecretSet ? '已设置（留空不改）' : '两端填同一个',
                  onChange: (v) => {
                    setClearSecret(false)
                    set('memSecret', v)
                  },
                })),
                h(Field, { key: 'machine', label: '本机名称' }, h(Text, { value: value('machine'), placeholder: 'pc / tablet', onChange: (v) => set('machine', v) })),
                h(Field, { key: 'peerMachine', label: '对端名称' }, h(Text, { value: value('peerMachine'), placeholder: 'tablet', onChange: (v) => set('peerMachine', v) })),
                h(Field, { key: 'host', label: '监听地址' }, h(Text, { value: value('listenHost'), placeholder: '0.0.0.0', onChange: (v) => set('listenHost', v) })),
                h(Field, { key: 'port', label: '监听端口' }, h(Text, { value: value('listenPort'), type: 'number', onChange: (v) => set('listenPort', v) })),
              ]),
              h('div', { key: 'flags', style: { marginTop: 8 } }, [
                h(Toggle, { key: 'serve', label: '开快照服务', desc: '关掉后本机只连别人，不能让别人连进来。', checked: Boolean(value('serve')), onChange: (v) => set('serve', v), dirty: dirtyOf('serve') }),
                h(Toggle, { key: 'auto', label: '收到自动/定时推送就合并', desc: '手动推送不受这个开关限制。', checked: Boolean(value('autoApply')), onChange: (v) => set('autoApply', v), dirty: dirtyOf('autoApply') }),
              ]),
              h('div', { key: 'tip', style: { ...MUTED, marginTop: 8 } }, 'PC 防火墙要放行这个端口；两端不在同一网络时改用下面的离线快照。'),
            ])
          : null,

        h(Card, { key: 'manual', title: '使用说明' }, [
          h('div', { key: 'list', style: { fontSize: 13, lineHeight: 1.75 } }, [
            h('div', { key: 1 }, '1. 两端都装本插件，填同一个共享密钥；一端填另一端地址，点「测试连接」。'),
            h('div', { key: 2 }, '2. 两端都开服务并互相填地址，任意一端都能手动发起；只开一端也行。'),
            h('div', { key: 3 }, '3. 启动自同步：每次 DSH 启动跑一次；定时发送：每 N 分钟推一次，0=关闭。'),
            h('div', { key: 4 }, '4. 冲突时保留：本机=不覆盖本机较新的内容；对端=用对端覆盖，覆盖前自动备份。'),
            h('div', { key: 5 }, '5. 收到后回发：两端都想尽快拿到合并结果时打开；只回发一次，不会循环。'),
            h('div', { key: 6 }, '6. 完全离线：一端导出 .json.gz，拷到另一端导入；导入前会先预览。'),
            h('div', { key: 7 }, '7. 单方插件：只有本机装插件时，用 SSH 地址/用户/密钥让对端执行同步脚本。'),
            h('div', { key: 8, style: MUTED }, '快捷键：先测连接 → 再双向同步 → 看下方日志。'),
          ]),
        ]),

        h(Card, { key: 'rules', title: '自定义同步规则' }, [
          h(Toggle, { key: 'startup', label: '启动时自同步', desc: 'DSH 启动后自动跑一次；热重载不算启动。', checked: Boolean(value('runOnStartup')), onChange: (v) => set('runOnStartup', v), dirty: dirtyOf('runOnStartup') }),
          h(Toggle, {
            key: 'interval',
            label: '定时发送快照',
            desc: 'HTTP 模式只推送；SSH 模式跑一次三段。0=关闭。',
            checked: interval > 0,
            onChange: (v) => set('intervalSendMinutes', v ? (interval > 0 ? interval : 30) : 0),
            dirty: dirtyOf('intervalSendMinutes'),
          }),
          interval > 0 ? h(Field, { key: 'intervalv', label: '间隔（分钟）' }, h(Text, { value: value('intervalSendMinutes'), type: 'number', onChange: (v) => set('intervalSendMinutes', v) })) : null,
          h(Field, { key: 'conflict', label: '冲突时保留' }, h(Select, {
            value: value('conflict'),
            options: [
              ['local', '本机为准（不覆盖本机较新内容）'],
              ['peer', '对端为准（用对端覆盖，先备份）'],
            ],
            onChange: (v) => set('conflict', v),
          })),
          h(Toggle, { key: 'reply', label: '收到对端同步后回发快照', desc: '只在本次真的写入文件时回发一次，并带 no-reply 防循环。', checked: Boolean(value('replyOnReceive')), onChange: (v) => set('replyOnReceive', v), dirty: dirtyOf('replyOnReceive') }),
          h('div', { key: 'rulesnow', style: { ...MUTED, marginTop: 6 } }, `当前生效：启动=${rules.runOnStartup ? '开' : '关'} · 定时=${rules.intervalSendMinutes || 0} 分钟 · 冲突=${rules.conflict || 'peer'} · 回发=${rules.replyOnReceive ? '开' : '关'}`),
        ]),

        h(Card, { key: 'offline', title: '离线快照（完全不用网络）' }, [
          h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
            h('button', { key: 'export', style: BUTTON, disabled: Boolean(busy), onClick: () => void exportSnapshot() }, busy === 'export' ? '导出中…' : '导出快照'),
            h('label', { key: 'import', style: { ...BUTTON, display: 'inline-block' } }, [
              '导入快照…',
              h('input', {
                key: 'file',
                type: 'file',
                accept: '.gz,.json.gz,application/gzip',
                style: { display: 'none' },
                onChange: (event) => pickImport(event.target.files?.[0]),
              }),
            ]),
          ]),
          preview ? h('div', { key: 'preview', style: { marginTop: 10, fontSize: 12.5 } }, [
            h('div', { key: 'h', style: { fontWeight: 600 } }, `预览：${preview.machine || '?'} · ${preview.fileCount ?? '?'} 个文件`),
            h('div', { key: 'w' }, `将写入 ${preview.written?.length || 0} 个，跳过 ${preview.skipped?.length || 0} 个`),
            h('div', { key: 'buttons', style: { display: 'flex', gap: 8, marginTop: 8 } }, [
              h('button', { key: 'ok', style: PRIMARY, disabled: Boolean(busy), onClick: () => void confirmImport() }, '确认导入'),
              h('button', { key: 'cancel', style: BUTTON, onClick: () => { setPreview(null); setPendingImport(null) } }, '取消'),
            ]),
          ]) : null,
          h('div', { key: 'tip', style: { ...MUTED, marginTop: 8 } }, '平板没有这个页面：把文件拷过去，对平板 agent 说「导入记忆快照 <路径>」，或 call memory_sync {"action":"import","path":"..."}。'),
        ]),

        value('transport') === 'git'
          ? h(Card, { key: 'ssh', title: '单方插件（SSH + 对端脚本）' }, [
              h('div', { key: 'grid', style: GRID }, [
                h(Field, { key: 'host', first: true, label: '对端地址' }, h(Text, { value: value('peerHost'), onChange: (v) => set('peerHost', v) })),
                h(Field, { key: 'user', label: '对端用户' }, h(Text, { value: value('peerUser'), onChange: (v) => set('peerUser', v) })),
                h(Field, { key: 'port', label: '端口' }, h(Text, { value: value('peerPort'), type: 'number', onChange: (v) => set('peerPort', v) })),
                h(Field, { key: 'key', label: '私钥路径' }, h(Text, { value: value('peerKeyPath'), placeholder: 'C:/Users/.../.ssh/id_ed25519', onChange: (v) => set('peerKeyPath', v) })),
                h(Field, { key: 'cmd', label: '对端同步脚本' }, h(Text, { value: value('peerCommand'), onChange: (v) => set('peerCommand', v) })),
                h(Field, { key: 'env', label: '对端环境名' }, h(Text, { value: value('peerEnvName'), onChange: (v) => set('peerEnvName', v) })),
              ]),
              h('div', { key: 'tip', style: { ...MUTED, marginTop: 8 } }, '对端不需要装本插件；需要可写的记忆目录、git 裸仓，以及能执行的同步脚本。'),
            ])
          : null,

        h(Card, { key: 'logs', title: '日志' }, [
          h('div', { key: 'row', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
            h('button', { key: 'l', style: BUTTON, disabled: Boolean(busy), onClick: () => void loadLogs() }, busy === 'logs' ? '读取中…' : '刷新日志'),
            h('button', { key: 's', style: BUTTON, disabled: Boolean(busy), onClick: () => void loadSnapshots() }, busy === 'snapshots' ? '读取中…' : '看快照'),
          ]),
          logs.length ? h('pre', { key: 'pre', style: { marginTop: 10, whiteSpace: 'pre-wrap', fontSize: 11.5, maxHeight: 260, overflow: 'auto', background: 'rgba(127,127,127,.08)', padding: 10, borderRadius: 8 } }, logs.join('\n')) : null,
          snapshots ? h('div', { key: 'snaps', style: { marginTop: 10, fontSize: 12.5 } }, [
            h('div', { key: 'h', style: { fontWeight: 600 } }, `快照：本地 ${snapshots.local?.length || 0} 份，对端 ${snapshots.peer?.length || 0} 份`),
            ...(snapshots.local || []).slice(0, 8).map((item) => h('div', { key: item.id, style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, [
              h('span', { key: 'id', style: { opacity: 0.8 } }, `${item.id} · ${bytes(item.bytes)}`),
              h('button', { key: 'r', style: { ...BUTTON, padding: '2px 8px', fontSize: 11.5 }, onClick: () => void restore(item.id) }, '恢复'),
            ])),
          ]) : null,
        ]),

        h(Card, { key: 'advanced', title: '高级' }, [
          h('div', { key: 'grid', style: GRID }, [
            h(Field, { key: 'repo', first: true, label: '记忆目录' }, h(Text, { value: value('repoPath'), onChange: (v) => set('repoPath', v) })),
            h(Field, { key: 'startupGrace', label: '启动宽限（秒）' }, h(Text, { value: value('startupGraceSec'), type: 'number', onChange: (v) => set('startupGraceSec', v) })),
            h(Field, { key: 'retry', label: '失败重试（秒）' }, h(Text, { value: value('retryDelaySec'), type: 'number', onChange: (v) => set('retryDelaySec', v) })),
            h(Field, { key: 'heal', label: '自愈间隔（秒）' }, h(Text, { value: value('healIntervalSec'), type: 'number', onChange: (v) => set('healIntervalSec', v) })),
            h(Field, { key: 'keep', label: '保留快照份数' }, h(Text, { value: value('keepSnapshots'), type: 'number', onChange: (v) => set('keepSnapshots', v) })),
            h(Field, { key: 'max', label: '快照上限（MB）' }, h(Text, { value: value('maxSnapshotMB'), type: 'number', onChange: (v) => set('maxSnapshotMB', v) })),
            h(Field, { key: 'status', label: '状态文件' }, h(Text, { value: value('statusFile'), onChange: (v) => set('statusFile', v) })),
            h(Field, { key: 'localTimeout', label: '本机超时（ms）' }, h(Text, { value: value('localTimeoutMs'), type: 'number', onChange: (v) => set('localTimeoutMs', v) })),
            h(Field, { key: 'peerTimeout', label: '对端超时（ms）' }, h(Text, { value: value('peerTimeoutMs'), type: 'number', onChange: (v) => set('peerTimeoutMs', v) })),
          ]),
          h('div', { key: 'flags', style: { marginTop: 8 } }, [
            h(Toggle, { key: 'enabled', label: '总开关', desc: '关掉后不启动/不跑定时；手动同步仍可用。', checked: Boolean(value('enabled')), onChange: (v) => set('enabled', v), dirty: dirtyOf('enabled') }),
            h(Toggle, { key: 'notify', label: '失败弹窗', desc: '同步失败时弹系统窗口提醒。', checked: Boolean(value('notifyOnFailure')), onChange: (v) => set('notifyOnFailure', v), dirty: dirtyOf('notifyOnFailure') }),
          ]),
        ]),

        h('div', { key: 'save', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 } }, [
          h('button', { key: 'save', style: PRIMARY, disabled: Boolean(busy) || (dirty.length === 0 && !clearSecret), onClick: () => void save() }, busy === 'save' ? '保存中…' : '保存设置'),
          h('button', { key: 'reset', style: BUTTON, disabled: Boolean(busy), onClick: () => void reset() }, '恢复 profile 配置'),
          h('span', { key: 'hint', style: MUTED }, dirty.length === 0 && !clearSecret ? `已保存 · ${clock(data.settings?.updatedAt)} · ${data.settings?.path || ''}` : `${dirty.length} 项待保存${clearSecret ? '（将清除密钥）' : ''}`),
          h('button', { key: 'clear', style: BUTTON, disabled: Boolean(busy), onClick: () => { setClearSecret(true); setNote('保存后会清除共享密钥；也可以直接填写新密钥。') } }, '清除密钥'),
        ]),
      ])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'memory-sync', order: 17, label: () => '记忆同步' },
            SettingsPage,
          ),
        )
      },
    }
  },
})
