# opencode-gh-pr

GitHub PR dashboard plugins for opencode.

## Structure

- `plugins/pr-dashboard.ts` — server plugin (tools: `pr_dashboard`, `pr_add_reviewer`, `pr_rerequest_review`)
- `plugins/pr-dashboard.tui.tsx` — TUI sidebar plugin (shows PR list in the session sidebar)
- `plugins/bun-utils.ts` — thin re-export of `bun.spawn` so tests can mock it
- `tests/` — unit and integration tests (159 tests, run with `bun test`)

## Install

Symlink the files from this repo into `~/.config/opencode/plugins/`:

```bash
cd ~/.config/opencode/plugins
ln -s ~/projects/personal/opencode-gh-pr/plugins/pr-dashboard.ts .
ln -s ~/projects/personal/opencode-gh-pr/plugins/pr-dashboard.tui.tsx .
ln -s ~/projects/personal/opencode-gh-pr/plugins/bun-utils.ts .
```

The plugins are loaded by opencode via `~/.config/opencode/opencode.json` and
`~/.config/opencode/tui.jsonc` which reference `./plugins/pr-dashboard.ts` and
`./plugins/pr-dashboard.tui.tsx`. With the symlinks in place, the live
config points to the files in this git repo, so any change you make and
commit here is immediately reflected in opencode after a restart.

## Test

```bash
bun test                # all tests
bun test tests/unit     # unit tests only
bun test tests/integration  # integration tests only
```
