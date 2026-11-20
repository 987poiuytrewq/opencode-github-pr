# Suggested changes

These findings come from a review of v0.2.0, based on commit `3d40978`. They are listed with the most important
first.

## 1. Report errors for inaccessible repositories instead of an empty list

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

## 2. Don't let the throttling plugin wait out a primary rate limit

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

## 3. Make the green PR icon mean "ready to merge"

**Where:** `plugins/app/PRRow.tsx` (`iconColor`) and `plugins/domain/pr-status.ts`

**Problem:** The README says a green PR icon means **ready to merge**. The row actually colours it green whenever
`mergeable === "MERGEABLE"`, which only means there are no merge conflicts. A PR with failing checks, changes
requested, or required reviews missing still shows green. `classifyRowState` has stricter logic, but nothing calls
it.

**Suggested fix:** Fetch `mergeStateStatus` (`CLEAN`, `BLOCKED`, `BEHIND`, `UNSTABLE`, `DIRTY`, ...) and
`reviewDecision`, and colour the icon from those: green for `CLEAN`, red for `DIRTY`, yellow for
`BLOCKED`/`BEHIND`/`UNSTABLE`. Then remove `classifyRowState`. Otherwise, change the README to say green means "no
merge conflicts".

## 4. Don't count a re-requested reviewer twice

**Where:** `plugins/domain/pr-status.ts`, `reviewSummary`

**Problem:** When a reviewer approves or comments and is then asked to review again, they appear in both
`latestReviews` and `reviewRequests`. They're counted once as approved or commented and again as pending. In the
row this shows as mixed review states, for example one green and one yellow icon for one person. `reviewRequests` is
also limited to `first: 5`.

**Suggested fix:** Exclude logins that are in `reviewRequests` from the `latestReviews` counts, because a pending
request supersedes their earlier review. Raise the `reviewRequests` limit, or use its `totalCount`.

## 5. Follow theme changes without a reload

**Where:** `plugins/app/DashboardView.tsx`, `const sk = skin(props.theme, props.colors)`

**Problem:** The colour palette is computed once, when the component is created, outside any reactive scope. If
the user switches OpenCode theme while the plugin is loaded, the panel keeps the old colours until `/reload`. This
has not been confirmed, and it depends on whether OpenCode re-creates slot content when the theme changes.

**Suggested fix:** Make it reactive with `const sk = () => skin(props.theme, props.colors)`, or a `createMemo`, and
read `sk().text` and so on in the JSX.

## 6. Remove unused code

**Where:** `plugins/domain/` and `plugins/infra/git.ts`

Nothing in `plugins/` uses this code:

- `classifyRowState` in `plugins/domain/pr-status.ts`. See item 3.
- `formatAge` in `plugins/domain/format.ts`.
- All of `plugins/domain/login.ts`: `displayLogin`, `ellipsize` and `BOT_ALIASES`.
- `originRemoteUrl` in `plugins/infra/git.ts`.
- `errorMessages.failed` in `plugins/domain/messages.ts`.
- The `*Logins` arrays returned by `reviewSummary`.

**Suggested fix:** Delete it, along with any tests that only cover it.

## 7. Smaller UI issues

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
