/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo } from "solid-js"
import type { PR } from "../domain/types"
import { ellipsize, displayLogin } from "../domain/login"
import { truncateTitle } from "../domain/format"
import {
  classifyCI,
  classifyRowState,
  reviewSummary,
} from "../domain/pr-status"

type ReviewerKind = "approved" | "changes" | "pending" | "commented"
type ReviewerEntry = { login: string; kind: ReviewerKind }

function CIIndicator(props: {
  ci: ReturnType<typeof classifyCI>
  pass: string
  fail: string
  warn: string
  muted: string
}) {
  const sym = { pass: "✓", fail: "✗", pending: "•", none: " " }[props.ci]
  const color = { pass: props.pass, fail: props.fail, pending: props.warn, none: props.muted }[props.ci]
  return <text fg={color} selectable={false}>{sym}</text>
}

export function PRRow(props: {
  pr: PR
  onClick: () => void
  onReviewer: () => void
  onReviewerComments: (login: string) => void
  text: string
  muted: string
  pass: string
  fail: string
  warn: string
  draft: string
}) {
  const numStr = String(props.pr.number)
  const title = truncateTitle(props.pr.title, numStr.length + 1)
  const rowState = classifyRowState(props.pr)
  const numColor =
    rowState === "draft" ? props.draft
    : rowState === "blocked" ? props.fail
    : rowState === "ready" ? props.pass
    : props.text
  const titleColor = numColor
  const r = reviewSummary(props.pr)
  const showAdd = r.approved === 0 && r.changes === 0 && r.pending === 0 && r.commented === 0

  const reviewers = createMemo<ReviewerEntry[]>(() => [
    ...r.approvedLogins.map((l) => ({ login: l, kind: "approved" as const })),
    ...r.changesLogins.map((l) => ({ login: l, kind: "changes" as const })),
    ...r.pendingLogins.map((l) => ({ login: l, kind: "pending" as const })),
    ...r.commentedLogins.map((l) => ({ login: l, kind: "commented" as const })),
  ])

  const reviewerColor = (kind: ReviewerKind): string =>
    kind === "approved" ? props.pass
    : kind === "changes" ? props.fail
    : kind === "pending" ? props.warn
    : props.muted

  return (
    <box
      flexDirection="column"
      paddingLeft={0}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      selectable={false}
      onMouseUp={() => props.onClick()}
    >
      <box flexDirection="row" gap={1} selectable={false}>
        <CIIndicator
          ci={classifyCI(props.pr)}
          pass={props.pass}
          fail={props.fail}
          warn={props.warn}
          muted={props.muted}
        />
        <text fg={numColor} selectable={false}>
          <b>#{numStr}</b>
        </text>
        <text fg={titleColor} selectable={false}>{title}</text>
      </box>
      <box flexDirection="row" flexWrap="no-wrap" gap={0} paddingLeft={2} selectable={false}>
        <Show when={reviewers().length > 0} fallback={<text selectable={false}> </text>}>
          <For each={reviewers()}>
            {(rv, i) => (
              <>
                <Show when={i() > 0}>
                  <text selectable={false}> </text>
                </Show>
                <Show when={rv.kind === "commented"} fallback={
                  <text fg={reviewerColor(rv.kind)} selectable={false}>
                    {`${ellipsize(displayLogin(rv.login))}${
                      rv.kind === "approved" ? "✓"
                      : rv.kind === "changes" ? "±"
                      : "⬤"
                    } `}
                  </text>
                }>
                  <box
                    selectable={false}
                    onMouseUp={(e: any) => {
                      e?.stopPropagation?.()
                      props.onReviewerComments(rv.login)
                    }}
                  >
                    <text fg={props.muted} selectable={false}>
                      <u>{`${ellipsize(displayLogin(rv.login))}⬤ `}</u>
                    </text>
                  </box>
                </Show>
              </>
            )}
          </For>
        </Show>
        <Show when={showAdd}>
          <box
            selectable={false}
            onMouseUp={(e: any) => {
              e?.stopPropagation?.()
              props.onReviewer()
            }}
          >
            <text fg={props.muted} selectable={false}>
              <u> add reviewers</u>
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}
