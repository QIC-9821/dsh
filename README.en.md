# dsh-memory-sync

A DeepSeek Harness plugin that syncs a git-backed memory folder between machines **once per Harness startup**.

Typical setup: the memory folder (`~/.dsh/memories`) lives on an always-on machine; a laptop pushes its side, lets the server commit and push back, then pulls the result. No polling, no cron.

## How it runs

On mount (which is one Harness start) the plugin performs three phases:

1. **Local push** — `git pull --rebase --autostash`, `git add -A`, commit if dirty, `git push`. A rejected push is retried once after `fetch` + `rebase`.
2. **Peer commit** — over ssh, run a command on the peer (default `DSH_SYNC_NAME=cloud /usr/local/bin/dsh-mem-sync`), so the peer commits and pushes its own side into the same bare repo.
3. **Local pull** — run the local sync again to fetch the peer's fresh commit.

All three must succeed. On failure the plugin retries once after 60 s; if it still fails it writes `last-run.json`, raises an OS dialog (Windows / macOS / Linux), and then retries silently every 10 minutes until it succeeds.

The startup run only happens when the plugin mounts within 300 s of process start; a hot reload does not trigger a sync.

## Install

Install this directory as a Harness bundle (for example with the plugin manager's bundle installer and the absolute path of this folder), or add `dsh-memory-sync` to your profile dependencies. Node.js ≥ 22 is required.

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

State lives in `$DSH_HOME/memory-sync/`: `last-run.json`, `sync.log`, `lock/sync.lock`.

## Peer setup

The peer only needs a bare repo plus a command that commits and pushes:

```bash
git init --bare -b main /srv/dsh-memory.git
chown -R dsh:dsh /srv/dsh-memory.git
git --git-dir=/srv/dsh-memory.git symbolic-ref HEAD refs/heads/main
git -C /home/dsh/.dsh/memories remote add origin /srv/dsh-memory.git
chmod 755 /usr/local/bin/dsh-mem-sync
```

Add this machine's public key to the peer user's `~/.ssh/authorized_keys` and point the local remote at `ssh://dsh@host/srv/dsh-memory.git`.

## Tool

`memory_sync`:

- `{"action":"run"}` — sync now; returns per-phase exit/duration/head.
- `{"action":"status"}` — last run, HEAD, dirty, ahead/behind, peer configured.

## Development

```bash
npm test
node --check index.js
```

Tests use a temporary bare repo and two clones: dirty-file push, rebase over a peer commit, non-repo error, lock exclusivity/staleness, config normalization.

## License

MIT
