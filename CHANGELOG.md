# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-11-08

### Added

- Desktop settings page in the system settings sidebar: test peer, manual
  both/push/pull, transport switch, custom rules, offline export/import, logs,
  snapshot restore.
- Android `Config` schema form (schemastery bundled into the tablet zip) under
  Settings → Extensions → Installed plugins.
- Custom rules: `intervalSendMinutes` (scheduled send), `conflict`
  (`local`/`peer`), `replyOnReceive` (one reply snapshot after applying),
  plus the existing `runOnStartup` / `autoApply`.
- Offline transport: export/import portable `.json.gz` snapshots with dry-run
  preview and backups; new `memory_sync` actions `export` / `import`.
- `/memory-sync/api/*` settings API, local/same-origin only; secrets are never
  echoed. `/mem/ping` reports protocol version 3 and a read-only rules summary.
- Manual pushes send `x-mem-apply: manual` so they merge even when the peer
  keeps `autoApply` off; reply pushes add `x-mem-no-reply: 1` to stop loops.
- `scripts/build-tablet.mjs` + verification: esbuild bundle, root
  `package.json`, no BOM, no web client, `Config` present.

### Changed

- `runHttpSync` takes a direction (`both` / `push` / `pull`); manual pushes can
  bypass the peer's automatic-apply policy.
- Applying snapshots now uses the receiver's `conflict` preference instead of
  the old hard-coded protected list; every overwrite is backed up.
- HTTP status no longer probes git; git inspection only runs in SSH mode.
- `peerPort` is configurable for SSH.

## [0.2.0] - 2026-11-08

### Added

- HTTP snapshot transport for Android tablets: push/pull, snapshot retention,
  restore and a hub server with `x-mem-secret` auth.
- `keepSnapshots` / `maxSnapshotMB` retention limits and `.bak-snapshot`
  backups on overwrite.

## [0.1.2] - 2026-11-06

### Added

- README demo screenshots: what `memory_sync status` returns after a run, and
  what the three-phase startup log looks like.

## [0.1.1] - 2026-11-05

### Changed

- Repository renamed from `QIC-9821/dsh` to `QIC-9821/dsh-memory-sync`, so the
  GitHub repo matches the npm package name. All metadata, badges and install
  links point at the new URL (the old URL redirects).
- `package.json` description is now a single English sentence: it is what npm
  and plugin directories use as the English description, and the Chinese copy
  lives in `locale/zh.json` and the README.

## [0.1.0] - 2026-11-05

First public release.

### Added

- Three-phase startup sync: local pull/commit/push → peer commit over ssh → local
  pull again, so both machines end on the same commit.
- `peer` and `local` modes; `repoPath`, `remote`, `branch`, `peerHost`,
  `peerUser`, `peerKeyPath`, `peerCommand` and timeouts are configurable.
- Startup grace window (`startupGraceSec`, default 300 s) so hot reloads do not
  trigger a sync.
- Retry once after `retryDelaySec` (60 s), then silent self-heal every
  `healIntervalSec` (600 s) until the sync succeeds.
- Optional OS dialog on final failure (`notifyOnFailure`).
- Optional machine snapshot written before each sync and committed with it
  (`statusFile`).
- `memory_sync` tool for agents: `{"action":"run"}` and `{"action":"status"}`.
- Lock file and `last-run.json` / `sync.log` under `$DSH_HOME/memory-sync/`.
- Tests covering dirty-tree commits, rebase over a peer commit, non-repo errors,
  lock exclusivity and staleness, and config normalization.

[0.1.0]: https://github.com/QIC-9821/dsh-memory-sync/releases/tag/v0.1.0

[0.1.1]: https://github.com/QIC-9821/dsh-memory-sync/releases/tag/v0.1.1
