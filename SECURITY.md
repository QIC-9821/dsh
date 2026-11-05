# Security policy

## Supported versions

The latest `0.1.x` release receives fixes. Please upgrade before reporting an
issue.

## What this plugin does (threat model)

`dsh-memory-sync` is deliberately small, but it is not sandboxed:

- It runs **your local `git`** inside the configured `repoPath`
  (`pull --rebase --autostash`, `add -A`, `commit`, `push`).
- In `peer` mode it runs **`ssh`** to `peerHost` as `peerUser`, using the
  configured key or your default ssh identity, and executes `peerCommand` on the
  peer.
- On final failure it may show a **local OS dialog**; the message contains the
  failing phase and git/ssh error output, not repository contents.
- It writes state under `$DSH_HOME/memory-sync/` (`last-run.json`, `sync.log`,
  `lock/sync.lock`) and, if `statusFile` is set, a machine snapshot that is
  committed and pushed with the memory repo.

It does **not** open network sockets itself, upload telemetry, or read files
outside the configured repo and DSH state directory. Anything it commits is
public to everyone who can read the remote — review `statusFile` content before
enabling it.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private advisory form:

https://github.com/QIC-9821/dsh/security/advisories/new

Include the version, platform, configuration (redacted), and a minimal
reproduction. You should get an initial reply within a week.

## Handling secrets

- The plugin never stores credentials; ssh keys stay where ssh expects them.
- Before pasting logs into an issue, remove hostnames, usernames and paths.
- `sync.log` records the commands and their output; treat it as sensitive.
