# Suggested changes

These findings come from two reviews of v0.2.0. The first pass was based on commit `c06aece`. The second pass was
based on `3d40978`, which only added tests since the first, so every first-pass item still applies. Each pass is
listed with the most important first. None of them blocks using the plugin. Items 1–3 are worth fixing before relying on it long-term, and the
rest are polish.

When the review was done, typecheck passed, along with 109 unit tests and 84 integration tests. The end-to-end tests
weren't run because the review environment had no tmux or OpenCode binary.

# First pass

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

The second pass found more code that nothing in `plugins/` uses:

- `classifyRowState` in `plugins/domain/pr-status.ts`. See item 12.
- `formatAge` in `plugins/domain/format.ts`.
- All of `plugins/domain/login.ts`: `displayLogin`, `ellipsize` and `BOT_ALIASES`.
- `originRemoteUrl` in `plugins/infra/git.ts`.
- `errorMessages.failed` in `plugins/domain/messages.ts`.
- The `*Logins` arrays returned by `reviewSummary`.

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

# Second pass

## 10. Report errors for inaccessible repositories instead of an empty list

**Where:** `plugins/infra/loader.ts`, `graphqlPartial`

**Problem:** GitHub's GraphQL API returns HTTP 200 even when the repository can't be read. The response carries
`data.repository: null` and an error of type `NOT_FOUND` or `FORBIDDEN`, for example when an organisation enforces
SAML SSO and the token isn't authorised. `graphqlPartial` returns `e.data` whenever it's present, so this is treated
as a successful, empty page. The panel says **No matching PRs**. The README's **Repo not found** and **Permission
denied** messages never appear for these cases, because the error classification relies on HTTP status codes that
GraphQL doesn't use.

This was reproduced by mocking that response and calling `repositoryPRs`. It returned `prs: []` and no error.

**Suggested fix:** In `graphqlPartial`, rethrow when `data.repository` is null, or when any error's `path` starts
with `repository` or `search`. Map the GraphQL error `type` (`NOT_FOUND`, `FORBIDDEN`, `RATE_LIMITED`) in
`prListErrorKind`. Keep returning partial data only for errors on nested fields. Add an integration test for both
the `NOT_FOUND` and SAML `FORBIDDEN` responses.

## 11. Don't let the throttling plugin wait out a primary rate limit

**Where:** `plugins/infra/octokit.ts` (`onRateLimit`) and `plugins/app/usePRData.ts` (`timeoutRace`)

**Problem:** `onRateLimit` returns `true` for the first two hits, which tells `@octokit/plugin-throttling` to wait
`retryAfter` seconds and retry. For a primary rate limit, that wait can be most of an hour. The outer
`timeoutRace` gives up after 15 seconds, so the panel shows **Request timed out** instead of **Rate limit
exceeded**. Meanwhile the waiting request stays queued, and each 60-second refresh adds another. The
rate-limit message and preserved list in `usePRData.ts` are probably unreachable with throttling on. This comes from
reading the code and hasn't been reproduced.

**Suggested fix:** In `onRateLimit`, retry only when `retryAfter` is short (a few seconds) and otherwise return
`false`, so the error reaches `parseRateLimitError`. While the limit lasts, skip scheduled refreshes until
`resetAt` passes.

Separately, for secondary rate limits, `parseRateLimitError` reports the time from `x-ratelimit-reset`, which is
the primary limit's reset time. Use the `retry-after` header when it's present.

## 12. Make the green PR icon mean "ready to merge"

**Where:** `plugins/app/PRRow.tsx` (`iconColor`) and `plugins/domain/pr-status.ts`

**Problem:** The README says a green PR icon means **ready to merge**. The row actually colours it green whenever
`mergeable === "MERGEABLE"`, which only means there are no merge conflicts. A PR with failing checks, changes
requested, or required reviews missing still shows green. `classifyRowState` has stricter logic, but nothing calls
it.

**Suggested fix:** Fetch `mergeStateStatus` (`CLEAN`, `BLOCKED`, `BEHIND`, `UNSTABLE`, `DIRTY`, ...) and
`reviewDecision`, and colour the icon from those: green for `CLEAN`, red for `DIRTY`, yellow for
`BLOCKED`/`BEHIND`/`UNSTABLE`. Then remove `classifyRowState`. Otherwise, change the README to say green means "no
merge conflicts".

## 13. Don't count a re-requested reviewer twice

**Where:** `plugins/domain/pr-status.ts`, `reviewSummary`

**Problem:** When a reviewer approves or comments and is then asked to review again, they appear in both
`latestReviews` and `reviewRequests`. They're counted once as approved or commented and again as pending. In the
row this shows as mixed review states, for example one green and one yellow icon for one person. `reviewRequests` is
also limited to `first: 5`.

**Suggested fix:** Exclude logins that are in `reviewRequests` from the `latestReviews` counts, because a pending
request supersedes their earlier review. Raise the `reviewRequests` limit, or use its `totalCount`.

## 14. Follow theme changes without a reload

**Where:** `plugins/app/DashboardView.tsx`, `const sk = skin(props.theme, props.colors)`

**Problem:** The colour palette is computed once, when the component is created, outside any reactive scope. If
the user switches OpenCode theme while the plugin is loaded, the panel keeps the old colours until `/reload`. This
has not been confirmed, and it depends on whether OpenCode re-creates slot content when the theme changes.

**Suggested fix:** Make it reactive with `const sk = () => skin(props.theme, props.colors)`, or a `createMemo`, and
read `sk().text` and so on in the JSX.

## 15. Smaller UI issues

- **Page isn't reset when the scope changes:** in `plugins/app/DashboardView.tsx`, the `createEffect` resets the
  page when the status filter changes but not when the scope changes. Switching scope while on page 3 opens page 3
  of the new list. The value is clamped, so this is only odd, not broken. Track `props.scope` in the effect as well.
- **Wrong word in the loading message:** after a scope change, the message reads "Loading open PRs", naming the
  status filter instead of the scope that changed.
- **Sign-in error leaves out `gh`:** the **GitHub sign-in failed** description only says "Set GITHUB_TOKEN or
  GH_TOKEN." It should also mention `gh auth login`, the README's recommended route.
- **Title width runs on every frame:** `updateTitleWidth` is attached to the renderer's `frame` event, so it runs
  on every frame. It's cheap and exits early, but listening for `resize` plus a layout or size-change hook on the
  box would be enough.
