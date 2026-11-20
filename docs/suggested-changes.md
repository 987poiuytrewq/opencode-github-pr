# Suggested changes

These findings come from a review of v0.2.0, based on commit `5c96e59`. That commit includes the fixes from
`opencode-github-pr#59`, `#60` and `#61`. When the review was done, typecheck passed, along with 91 unit tests and
99 integration tests. The end-to-end tests weren't run.

## Fixed since the previous review

- **Inaccessible repositories now show an error.** They used to show an empty list. `graphqlPartial` now rethrows
  root-level `NOT_FOUND`, `FORBIDDEN` and `RATE_LIMITED` errors.
- **Long primary rate limits now reach the dashboard.** The throttling plugin only retries waits of 5 seconds or
  less, and scheduled refreshes stop until the limit resets.
- **The secondary rate-limit message uses the right time.** It now comes from `retry-after`.
- **The PR icon colour comes from `mergeStateStatus` and `reviewDecision`.**
- **Re-requested reviewers are counted once,** and `reviewRequests` is raised to 100.
- **The palette is reactive.** The page also resets when the scope changes, and the loading and sign-in messages are
  fixed.
- **Most of the unused code is removed.**

The open items are below, most important first.

## 1. Filter changes during a rate limit show "Loading" until the limit resets

**Where:** `plugins/app/usePRData.ts` (`refresh` and `loadMore`) and `plugins/pr-dashboard.tui.tsx`

**Problem:** While a primary rate limit is active, `refresh()` returns straight away without changing state. If the
user then clicks the scope or status filter, the filter changes but the loaded list stays tagged with the old
filter. `DashboardView` sees that they don't match, so it hides the list and shows **Loading author PRs** (or
similar) next to the rate-limit error. This can last up to an hour. `/pr-refresh` also shows a "Refreshing PRs…"
toast but does nothing. This comes from reading the code and hasn't been reproduced.

**Suggested fix:** When `primaryLimitActive()` is true, still update `pagination.listing`, `scope` and `scopeValue`
for a filter change. Re-filter the PRs already loaded, or show the rate-limit message in place of the list instead
of "Loading". Make `/pr-refresh` show a toast that includes the reset time instead of "Refreshing PRs…".

## 2. Back off during secondary rate limits too

**Where:** `plugins/app/usePRData.ts`, `recordPrimaryRateLimit`

**Problem:** Only primary limits pause refreshing. During a secondary rate limit, the dashboard keeps sending a
request every 60 seconds, on each `session.idle` and on each page change. GitHub's guidance is to stop until
`retry-after` has passed, and it can lengthen secondary limits for clients that keep sending requests.

**Suggested fix:** Record `resetAt` for secondary limits as well. It already comes from `retry-after`, so it's
usually short. Rename the guard to something like `rateLimitActive()`.

## 3. Fix the remaining gaps in the merge-readiness colour

**Where:** `plugins/domain/pr-status.ts`, `mergeReadiness`, and the README's "Reading a row" table

- **`HAS_HOOKS` shows grey:** this state means the PR can be merged and its pre-receive hooks pass, but it falls
  through to `"none"`, which is grey. Treat it like `CLEAN`.
- **Changes requested shows yellow:** `CLEAN` with `reviewDecision: "CHANGES_REQUESTED"` maps to `"pending"`.
  Red (`"fail"`) would match how the review icon shows requested changes.
- **The README is out of date:** it still says "Green: ready to merge. Red: merge conflict. Grey: draft, closed or
  unknown." It doesn't mention yellow for `BLOCKED`, `BEHIND` and `UNSTABLE`, or for reviews still required.
- **Older Enterprise servers are a risk:** `mergeStateStatus` and `reviewDecision` are now in the shared fragment
  used by every query. On a GitHub Enterprise Server version that doesn't have one of these fields, the whole query
  fails and the panel only shows **Invalid request**. This hasn't been checked against specific GHES versions.
  Confirm the minimum GHES version, document it, or fall back to a query without these fields when a `422` or
  "Field doesn't exist" error comes back.

## 4. Recolour PR icons when the theme changes

**Where:** `plugins/app/PRRow.tsx`

**Problem:** The `createMemo` in `DashboardView` now makes the palette reactive. But `PRRow` computes `icon`,
`iconColor`, `checks`, `reviews` and `comments` once, as plain constants in the component body. After a theme change,
the PR icon keeps its old colour until the next refresh rebuilds the rows. Colours passed directly as JSX attributes
do update.

**Suggested fix:** Turn them into accessors, for example `const iconColor = () => ...`, and call them in the JSX.

## 5. Check the first title width

**Where:** `plugins/app/DashboardView.tsx`, `onMount`

**Problem:** `updateTitleWidth()` now runs once in `onMount` and then only on `resize` events, where before it ran on
every frame. If the box hasn't been laid out when `onMount` runs, `view.width` is 0 and titles are cut to `…` until
the first `resize`. Whether that `resize` always arrives after the first layout depends on OpenTUI and hasn't been
confirmed. An end-to-end test that checks a title on the first frame would settle it.

## 6. Small leftovers

- **Errors on the supplementary query fail the whole search:** in `graphqlPartial`, any `NOT_FOUND` or `FORBIDDEN`
  error with a path of length 2 or less is fatal, including `["repository", "recentPullRequests"]`. An error on that
  optional connection fails the whole `author` or `assignee` search, which could still have been shown on its own.
  Also, the `!query.includes("recentPullRequests:")` check in `hasRootFailure` relies on the query text. Passing an
  explicit flag would be sturdier.
- **More unused code:** `refreshOne`, `fetchOnePR` and `mapPullFromREST` are still unused, and #60 gave `refreshOne`
  rate-limit handling. Remove them, or use them.
- **Team review requests:** `reviewRequests` still only selects `... on User`, so pending team reviews aren't
  counted. Add `... on Team { slug }`.
- **Clock skew:** `primaryLimitActive` compares GitHub's `x-ratelimit-reset`, which uses the server's clock, with
  the local `Date.now()`. If the local clock is behind, refreshing stays paused after the limit has reset. Adding a
  few seconds of margin, or using `retryAfter` from the throttling callback, would avoid it.
