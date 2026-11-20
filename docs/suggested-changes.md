# Suggested changes

These findings come from a review of v0.2.0, based on commit `fb9e93d`. That commit includes
`opencode-github-pr#66` to `#71`, which addressed the nine items from the previous version of this doc.

When the review was done, typecheck passed, and so did all integration tests. 97 of 98 unit tests passed. The one
failure is explained in item 3. The end-to-end tests weren't run because the review environment had no tmux or
OpenCode binary.

## Fixed since the previous review

- **The `gh auth token` lookup no longer blocks the TUI.** It's now asynchronous.
- **A 401 now clears the cached client,** so a rotated or refreshed token is picked up. The token is no longer
  reused across hosts.
- **The OpenCode, OpenTUI and Solid packages are now `peerDependencies`.**
- **The outer `timeoutRace` is gone.** Octokit's per-request timeout is the only timeout now.
- **`insteadOf` rewrites and SSH host aliases are resolved.**
- **Check and review-thread counts use `totalCount`.**
- **The demo GIF is no longer published, and `@types/bun` and `bun-types` are pinned.**
- **Integration test renderers are disposed after each test.**

The open items are below, most important first.

## 1. Branch scope now hides PRs opened from a fork

**Where:** `plugins/infra/loader.ts`, the `scope === "branch"` filter after the pagination loop

**Problem:** To keep other people's fork PRs out of branch scope, the loader now keeps only PRs whose
`headRepositoryOwner` matches the owner of the detected repository. That repository comes from `origin`, which is
often the upstream repository. In a common contributor setup, `origin` points at `org/project` and the branch is
pushed to a personal fork such as `me/project`. The PR's head owner is `me`, not `org`, so **branch scope no longer
shows your own PR**. Before this change it did. This regression came from the previous version of this doc's
suggestion, and the fix was implemented as suggested.

`totalCount` still counts the PRs that were filtered out, so the page counter can also overstate the number of
pages.

**Suggested fix:** Compare the head owner with the remote the branch actually pushes to, not with the detected
repository's owner. Read `branch.<name>.pushRemote`, then `remote.pushDefault`, then `branch.<name>.remote`, and take
the owner from that remote's URL using the existing rewrite and alias resolution. If none of these resolves, keep
every PR that matches the branch name, which is the old behaviour. When PRs are filtered out on the client, take
them off `totalCount` too.

## 2. The keymap guard never takes effect

**Where:** `plugins/pr-dashboard.tui.tsx`, the `app` slot's `render`

**Problem:** `api.keymap.layer()` is typed to return `void`
(`node_modules/@opencode/plugin/dist/tui/context.d.ts:377`). So `typeof keymapLayer === "function"` is never true,
`unregisterKeymap` is never set, and the `if (!unregisterKeymap)` guard registers the layer on every render, just
as before. The `unregisterKeymap?.()` in cleanup also does nothing. Because `layer()` returns nothing, it's probably
scoped to the Solid owner it's called in and disposed along with the slot. If so, the original code was already
correct and this change adds no protection.

**Suggested fix:** Check how OpenCode disposes keymap layers. If they're scoped to the owner, remove the guard and
the disposer variable and add a comment saying why. If they aren't, use a plain `let registered = false` flag so the
layer registers only once.

## 3. The SSH alias test needs an `ssh` binary

**Where:** `tests/unit/git.test.ts`, "resolves SSH host aliases to GitHub using ssh configuration"

**Problem:** The test relies on `ssh -G` actually running. Where `ssh` isn't installed, as in minimal containers or
some CI images, `sshHostName` returns `null` and the test fails. The plugin itself handles this correctly by falling
back to "not recognised". Only the test assumes `ssh` is installed.

**Suggested fix:** Skip the test when `ssh` isn't installed, for example with
`test.skipIf(!Bun.which("ssh"))`. Or make the `ssh -G` runner injectable and test the parsing with a stub.

## 4. `ssh -G` still runs synchronously on the TUI thread

**Where:** `plugins/infra/git.ts`, `sshHostName`

**Problem:** The `gh` lookup is now asynchronous, but SSH alias resolution added a new `spawnSync("ssh", ...)`. It
has a 500 ms timeout and its result is cached for each host, including failures, so the cost is at most once per
host per process. That's acceptable, but:

- It also runs for SCP-style remotes on other hosts (for example `git@gitlab.com:...`), because any remote that
  doesn't parse as GitHub is tried as an alias.
- `ssh -G` evaluates `Match exec` blocks in the user's SSH config, which can run arbitrary commands, and those may be
  slow.

**Suggested fix:** Make `detectRepo` asynchronous and use `execFile`. Also skip alias resolution for hosts that are
clearly not aliases, for example names that contain a dot and are already a public hostname.

## 5. Check how OpenCode installs peer dependencies

**Where:** `package.json` and the README's install sections

**Problem:** Moving the host packages to `peerDependencies` is right, but the result depends on how OpenCode
installs npm plugins. Package managers that install peer dependencies automatically (npm 7 and later, and Bun)
could still put a second copy of `solid-js` or `@opentui/*` next to the plugin, if the host's copy isn't where they
look. CI only tests source installs, where `bun install` installs the dev dependencies.

**Suggested fix:** Add an end-to-end job that installs the packed tarball (`npm pack`) through OpenCode's own
`plugins: ["opencode-github-pr"]` path and checks that the panel renders and updates. Then the published install is
tested, not only the source install.

## Next: release 0.3.0

`package.json` is still at `0.2.0` and the repository has no tags. Fix item 1 first, since it's a regression in
everyday use. Then release `0.3.0`, and run the full end-to-end CI matrix on the release commit.
