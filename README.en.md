# dsh-memory-sync

Sync `~/.dsh/memories` between two machines: LAN HTTP snapshots, fully offline snapshot files, or an SSH peer chain. Desktop gets a settings page; Android gets a native plugin settings form.

## Transports

| Transport | Use when | Notes |
| --- | --- | --- |
| Both plugins · LAN | same Wi-Fi / hotspot | same `memSecret`; fill each other's `peerUrl`; no internet needed |
| Both plugins · offline | never on the same network | export `.json.gz`, copy over, preview then import |
| One plugin · SSH | only this machine has the plugin | SSH to the peer and run its sync script; peer needs a writable memory dir + bare repo/script |

## Install

```bash
dsh plugin add dsh-memory-sync
```

Local development: `"dsh-memory-sync": "link:D:/dsh-plugins/dsh-memory-sync"`.

Android: install the self-contained `dsh-memory-sync-0.3.0-tablet.zip` (root `package.json`, no BOM, schemastery bundled into `dist/index.js`).

## Settings

- Desktop: Settings → Memory Sync — test, sync both/push/pull, rules, offline snapshots, logs, restore.
- Android: Settings → Extensions → Installed plugins → dsh-memory-sync — schema form with the same fields; use the `memory_sync` tool for manual runs.

Overrides live in `~/.dsh/memory-sync/settings.json` and take precedence over the profile's `cordis.patch.yml`.

## Custom rules

| Key | Default | Meaning |
| --- | --- | --- |
| `runOnStartup` | true | sync once on startup |
| `intervalSendMinutes` | 0 | send every N minutes; 0=off (HTTP push; SSH chain) |
| `conflict` | peer | `local` keeps a newer local copy; `peer` lets the remote win (backup first) |
| `replyOnReceive` | false | after applying files, send one merged snapshot back (no-reply guard) |
| `autoApply` | true | apply automatic/scheduled pushes; manual pushes bypass it |

## Config

See the Chinese README for the full table. State lives in `$DSH_HOME/memory-sync/`.

## Tools

`memory_sync` actions: `run` (`direction=both|push|pull`), `status`, `list`, `restore`, `export`, `import` (`path`, `dryRun`).

## Security

Local/same-origin settings API; secrets are never echoed. The shared secret equals write access; snapshots are plain gzip. Overwrites are backed up as `*.bak-snapshot`; files are never deleted.

## License

MIT.
