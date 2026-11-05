# Contributing

Thanks for taking the time to improve `dsh-memory-sync`.

## Development

Requirements: Node.js ≥ 22 (or the Node.js bundled with DeepSeek Harness).

```bash
git clone https://github.com/QIC-9821/dsh.git
cd dsh-memory-sync
npm test
node --check index.js
```

The plugin has **zero runtime dependencies** and that is intentional; please do
not add any. Tests use only `node:test`, `node:assert` and temporary git
repositories.

To try the plugin locally, install the checkout as a bundle into a throwaway
profile:

```bash
dsh plugin --profile smoke add /absolute/path/to/dsh-memory-sync
```

Do not install it into a profile that already runs the old startup-sync script,
or memory sync will run twice.

## Pull requests

- Keep one logical change per PR.
- Run `npm test` before pushing; CI runs Node 22 and 24.
- Update `README.md`, `README.en.md` and `CHANGELOG.md` when behaviour or config
  changes.
- Never commit secrets, private hostnames/keys, or personal paths. Review
  `git diff` before committing.
- Describe how you tested a real two-machine setup if the change touches the
  ssh/peer path.

## Commit messages

Short imperative subject line, optional body explaining why. Examples:

```
fix: retry push once after rebase
docs: clarify peer setup
```

## Reporting bugs

Use the issue templates. Redact hostnames, usernames and keys from logs before
pasting. Security issues go through [SECURITY.md](SECURITY.md), not the public
issue tracker.
