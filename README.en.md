# dsh-memory-sync

[![npm version](https://img.shields.io/npm/v/dsh-memory-sync.svg)](https://www.npmjs.com/package/dsh-memory-sync)
[![CI](https://github.com/YOUR_GITHUB_NAME/dsh-memory-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_GITHUB_NAME/dsh-memory-sync/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)

> Sync your git-backed memory folder with a peer machine every time DeepSeek Harness starts — latest memories at boot, no daemon, no cron, no manual pull.

中文: [README.md](README.md)

Typical setup: the memory folder (`~/.dsh/memories`) lives on an always-on machine; a laptop syncs its side at startup, lets the server commit and push back, then pulls the result. Nothing runs between startups.

## Install

```bash
dsh plugin add dsh-memory-sync
```

Pin a tag, or install from a checkout:

```bash
dsh plugin add github:YOUR_GITHUB_NAME/dsh-memory-sync#v0.1.0
dsh plugin add /absolute/path/to/dsh-memory-sync
```

Node.js ≥ 22 is required (the runtime bundled with Harness works too).

Then configure it in Harness settings ("Memory sync on startup"), or directly in the profile patch:

```yaml
- id: dsh-memory-sync
  name: 'dsh-memory-sync'
  config:
    repoPath: ''            # empty = $DSH_HOME/memories
    remote: cloud
    branch: main
    mode: peer
    peerHost: 203.0.113.10
    peerUser: dsh
    peerKeyPath: C:/Users/me/.ssh/id_ed25519
```

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `repoPath` | `$DSH_HOME/memories` | git working tree to sync |
| `remote` | `cloud` | git remote; falls back to `origin` / `cloud` |
| `branch` | `main` | branch name |
| `enabled` | `true` | master switch |
| `runOnStartup` | `true` | run on mount |
| `startupGraceSec` | `300` | mount counts as a boot only within this many seconds |
| `mode` | `peer` | `peer` = three phases; `local` = local pull/commit/push only |
| `peerHost` / `peerUser` | empty | ssh target |
| `peerKeyPath` | empty | private key; empty = ssh default |
| `peerCommand` | `/usr/local/bin/dsh-mem-sync` | command run on the peer |
| `peerEnvName` | `cloud` | `DSH_SYNC_NAME` for that command |
| `retryDelaySec` | `60` | first retry delay; 0 disables |
| `healIntervalSec` | `600` | silent self-heal interval; 0 disables |
| `notifyOnFailure` | `true` | show an OS dialog on final failure |
| `commitPrefix` | `sync` | auto-commit prefix |
| `gitPath` | `git` | git executable |
| `localTimeoutMs` / `peerTimeoutMs` | `120000` | per-phase timeout |
| `statusFile` | empty | write a machine snapshot there before each sync and commit it (e.g. `~/.dsh/memories/pc-status.md`); empty = off |

State lives in `$DSH_HOME/memory-sync/`: `last-run.json`, `sync.log`, `lock/sync.lock`.

## How it runs

On mount (which is one Harness start) the plugin performs three phases:

1. **Local push** — `git pull --rebase --autostash`, `git add -A`, commit if dirty, `git push`. A rejected push is retried once after `fetch` + `rebase`.
2. **Peer commit** — over ssh, run a command on the peer (default `DSH_SYNC_NAME=cloud /usr/local/bin/dsh-mem-sync`), so the peer commits and pushes its own side into the same bare repo.
3. **Local pull** — run the local sync again to fetch the peer's fresh commit.

All three must succeed. On failure the plugin retries once after 60 s; if it still fails it writes `last-run.json`, raises an OS dialog (Windows / macOS / Linux), and then retries silently every 10 minutes until it succeeds.

The startup run only happens when the plugin mounts within 300 s of process start; a hot reload does not trigger a sync.

## Peer setup

The peer only needs a bare repo plus a command that commits and pushes:

```bash
git init --bare -b main /srv/dsh-memory.git
chown -R dsh:dsh /srv/dsh-memory.git
git --git-dir=/srv/dsh-memory.git symbolic-ref HEAD refs/heads/main
git -C /home/dsh/.dsh/memories remote add origin /srv/dsh-memory.git
chmod 755 /usr/local/bin/dsh-mem-sync
```

Add this machine's public key to the peer user's `~/.ssh/authorized_keys` and point the local remote at `ssh://dsh@host/srv/dsh-memory.git`. The plugin only runs the phases in order; it does not care how the repo is laid out.

## Tool

`memory_sync`:

- `{"action":"run"}` — sync now; returns per-phase exit/duration/head.
- `{"action":"status"}` — last run, HEAD, dirty, ahead/behind, peer configured.

## Security and privacy

- The plugin only runs local `git` and `ssh`; it opens no other network connections and sends no telemetry.
- It commits and pushes whatever is in `repoPath`; the `statusFile` snapshot is committed too. Check the content before syncing to a public remote.
- The failure dialog contains the failing phase and git/ssh errors, not repository contents; the log is at `$DSH_HOME/memory-sync/sync.log`.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md); please do not open a public issue.

## Development

```bash
npm test
node --check index.js
```

Tests use a temporary bare repo and two clones: dirty-file push, rebase over a peer commit, non-repo error, lock exclusivity/staleness, config normalization.

## License and contributing

MIT. Issues and PRs are welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first; changes are tracked in [CHANGELOG.md](CHANGELOG.md).
