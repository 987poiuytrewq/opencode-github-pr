# opencode-github-pr

OpenCode V2 plugin providing GitHub pull-request tools and a TUI sidebar dashboard.

## Plugin parts

- `plugins/pr-dashboard.ts` — server part: `pr_add_reviewer` and `pr_rerequest_review` tools.
- `plugins/pr-dashboard.tui.tsx` — TUI part: PR list, CI/review status, reviewer actions, slash commands, and refresh-on-idle.
- `plugins/` — shared GitHub data loaders, domain logic, and Solid UI components.
- `tests/` — unit, integration, and TUI end-to-end tests.

The package exports both parts via `package.json`; OpenCode V2 loads them together as one plugin.

## Run a local OpenCode session

From this checkout, run:

```bash
make opencode
```

This starts the interactive TUI with a standalone server so the plugin can read the GitHub token. It uses an existing
`GH_TOKEN`, `GITHUB_TOKEN`, or `GITHUB_PERSONAL_ACCESS_TOKEN`; if none is set, it reads the token from `gh auth token`.

## Install locally

Add the repository directory to the `plugins` array in your V2 `opencode.json` or `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-github-pr/archive"
    }
  ]
}
```

For this checkout, the plugin directory is `~/projects/personal/opencode-github-pr/archive`. Because the package includes
a server part and a TUI part, it belongs in `opencode.json`; do not duplicate it in `cli.json`. The CLI loads its TUI part
from the server's active plugin list, including when connected to a remote server.

## GitHub authentication

The server and TUI parts use Octokit. Set `GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_PERSONAL_ACCESS_TOKEN` in the
environment available to OpenCode. The plugin reads the active session's repository from its GitHub `origin` remote.

## Test

```bash
bun test
bun test tests/unit
bun test tests/integration
bun run typecheck
```
