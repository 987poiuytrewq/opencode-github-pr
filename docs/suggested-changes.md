# Suggested changes

These findings come from a review of v0.2.0, based on commit `c06aece`. They are listed with the most important
first. None of them blocks using the plugin. Items 1–3 are worth fixing before relying on it long-term, and the
rest are polish.

When the review was done, typecheck passed, along with 109 unit tests and 84 integration tests. The end-to-end tests
weren't run because the review environment had no tmux or OpenCode binary.

## 1. Don't block the TUI while reading the `gh` token

**Where:** `plugins/infra/octokit.ts`, `readGhAuthToken`

**Problem:** When no token is set in the environment, the plugin runs `gh auth token` with `execFileSync`. This runs
in the TUI process with a 5-second timeout. If `gh` is slow or hangs (for example on a keychain prompt or a slow
network), the whole TUI freezes until it returns.

**Suggested fix:** Use `execFile` from `node:child_process/promises`, or `Bun.spawn`, and make `getAuthToken` and
`getOctokit` async. The callers in `infra/loader.ts` already await, so the change stays small.

## 2. Re-read the token after an authentication failure

**Where:** `plugins/infra/octokit.ts`, `getOctokit` and the `cached` client

**Problem:** The plugin reads the token once and keeps it for the life of the process. `cached?.token` is reused
even when the client is rebuilt. After `gh auth refresh`, a token rotation or an expiry, every request fails with
401 and the panel shows "GitHub sign-in failed" until OpenCode restarts.

**Suggested fix:** Clear `cached` (token included) when a request fails with 401, and on the next refresh try
`getAuthToken()` again. Also consider not reusing the old token when `baseUrl` changes, because a github.com token is
the wrong token for an Enterprise host.

## 3. Declare host-provided libraries as peer dependencies

**Where:** `package.json`

**Problem:** `@opencode/plugin`, `@opencode/theme`, `@opentui/core`, `@opentui/solid` and `solid-js` are pinned as
regular `dependencies` to the 2.0.20 / 0.6.6 line. If the plugin gets its own copy of Solid or OpenTUI alongside the
host's copy, Solid reactivity can break without any error. The comment at the top of `plugins/app/usePRData.ts`
shows how fragile Solid loading already is. CI passes on 2.0–2.3 today, but this is the most likely thing to break
when OpenCode updates.

**Suggested fix:** Move the host-provided packages to `peerDependencies` with a range such as `>=2.0.20 <3`, and
keep them in `devDependencies` for tests. Keep `@octokit/*` and `open` as regular dependencies.

## 4. Apply the timeout to each request, not the whole batch

**Where:** `plugins/app/usePRData.ts`, `timeoutRace`

**Problem:** `requestTimeoutMs` is already passed to Octokit for each request. `timeoutRace` applies the same
value again, this time to the whole `repositoryPRs` call, which can be several GraphQL pages plus retries. When it
fires, the underlying requests keep running in the background because nothing cancels them. With a large
`pageSize` or a slow network, this gives spurious "Request timed out" errors.

**Suggested fix:** Drop the outer race and rely on the Octokit timeout. Or pass an `AbortSignal` through
`repositoryPRs` and give the batch its own, more generous deadline.

## 5. Recognise SSH host aliases and `insteadOf` rewrites

**Where:** `plugins/infra/git.ts`, `parseGitHubRemote` and `remoteUrls`

**Problem:** Remotes such as `git@github-work:org/repo.git`, which use a `Host` alias from `~/.ssh/config`, aren't
recognised. Neither are remotes that rely on `url.<base>.insteadOf` rewrites. People with several GitHub accounts
commonly use both, and today they see "No GitHub repo".

**Suggested fix:**
- Apply `insteadOf` rules from the git config before parsing the remote.
- Optionally run `ssh -G <alias>` to resolve the real hostname, or add a `remoteHosts` option that lists extra host
  aliases to treat as GitHub.

## 6. Fill gaps in PR data

**Where:** `plugins/infra/queries.ts` and `plugins/infra/mappers.ts`

- **Team review requests:** `reviewRequests` only selects `... on User`, so pending team reviews don't show as
  "review requested". Add `... on Team { slug }`.
- **Truncated counts:** `contexts(first: 100)` and `reviewThreads(first: 100)` silently stop counting at 100.
  Either use the rollup `state` when there are more, or show a "100+" indicator using `totalCount`.
- **Branch scope matches forks:** branch scope filters on `headRefName` alone, so a PR from a fork with the same
  branch name also appears. Filter on `headRepositoryOwner` as well, or compare `headRepository` with the detected
  repository.

## 7. Remove dead code

**Where:** `plugins/app/usePRData.ts`, `plugins/infra/loader.ts`, `plugins/infra/mappers.ts` and
`plugins/domain/types.ts`

`refreshOne`, `fetchOnePR` and `mapPullFromREST` are passed through `DashboardContext` but never called. Remove
them, along with their tests, or call `refreshOne` after `openPR` if the intent was to refresh the PR you just
opened.

## 8. Tidy the published package

**Where:** `package.json`

- `files` includes `demo/demo.gif` (about 100 KB), which the plugin doesn't need at runtime. The README image can
  use the GitHub URL instead, or the GIF can be left out of the package. Keep `demo/fixtures.ts`, because demo mode
  imports it.
- `@types/bun` and `bun-types` are set to `latest`. Pin them to a version range so a fresh install without the
  lockfile still builds the same way.

## 9. Clean up registrations and test noise

**Where:** `plugins/pr-dashboard.tui.tsx` and the integration tests

- `api.keymap.layer(...)` is called inside the `app` slot's `render` function, and the plugin's cleanup function
  doesn't remove it. If the slot re-renders, or the plugin is reloaded with `/reload`, the commands could be
  registered more than once. This hasn't been confirmed. Keep the disposer the call returns and call it during
  cleanup, and make sure it registers only once.
- The integration tests print `MaxListenersExceededWarning` from `TerminalConsoleCache`. This is likely because a
  renderer isn't destroyed between tests. It's harmless but hides real warnings.
