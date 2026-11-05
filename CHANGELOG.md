# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/YOUR_GITHUB_NAME/dsh-memory-sync/releases/tag/v0.1.0
