/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import type { TuiPR as PR, ReviewerThreadCounts } from "../infra/loader"
import { ellipsize, displayLogin } from "../domain/login"
import { SK, truncateTitle } from "../domain/format"
import {
  classifyCI,
  reviewSummary,
  missingReviewerCount,
  isReadyToMerge,
} from "../domain/pr-status"

function CIIndicator(props: {
  ci: ReturnType<typeof classifyCI>
  pass: string
  fail: string
  warn: string
  muted: string
}) {
  const sym = { pass: "✓", fail: "✗", pending: "•", none: " " }[props.ci]
  const color = { pass: props.pass, fail: props.fail, pending: props.warn, none: props.muted }[props.ci]
  return <text fg={color}>{sym}</text>
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
  required: number | null | undefined
  threadCount: ReviewerThreadCounts
}) {
  const numStr = String(props.pr.number)
  const title = truncateTitle(props.pr.title, numStr.length + 1)
  const ready = isReadyToMerge(props.pr, props.required)
  const blocked =
    props.pr.mergeStateStatus === "CONFLICTING" ||
    props.pr.mergeable === "CONFLICTING" ||
    reviewSummary(props.pr).changes > 0
  const numColor = props.pr.isDraft || blocked ? props.draft : ready ? props.pass : props.text
  const titleColor = numColor
  const r = reviewSummary(props.pr)
  const missing = missingReviewerCount(props.pr, props.required)
  const showAdd =
    missing > 0 || (r.approved === 0 && r.changes === 0 && r.pending === 0 && r.commented === 0)

  const reviewerBoxes: any[] = []
  const pushReviewer = (el: any) => {
    if (reviewerBoxes.length > 0) reviewerBoxes.push(<text>{" "}</text>)
    reviewerBoxes.push(el)
  }

  r.approvedLogins.forEach((l) =>
    pushReviewer(<text fg={props.pass}>{`${ellipsize(displayLogin(l))}✓ `}</text>),
  )
  r.changesLogins.forEach((l) =>
    pushReviewer(<text fg={props.fail}>{`${ellipsize(displayLogin(l))}± `}</text>),
  )
  r.pendingLogins.forEach((l) =>
    pushReviewer(<text fg={props.warn}>{`${ellipsize(displayLogin(l))}• `}</text>),
  )
  r.commentedLogins.forEach((l) => {
    const tc = props.threadCount.get(l) ?? { unresolved: 0, resolved: 0 }
    const icon = tc.unresolved > 0 ? "☐" : tc.resolved > 0 ? "☑" : ""
    const login = displayLogin(l)
    if (tc.unresolved > 0) {
      pushReviewer(
        <box
          onMouseUp={(e: any) => {
            e?.stopPropagation?.()
            props.onReviewerComments(l)
          }}
        >
          <text fg={props.muted}>
            <u>{`${ellipsize(login)}${icon} `}</u>
          </text>
        </box>,
      )
    } else {
      pushReviewer(<text fg={props.muted}>{`${ellipsize(login)}${icon} `}</text>)
    }
  })

  return (
    <box
      flexDirection="column"
      paddingLeft={0}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      onMouseUp={() => props.onClick()}
    >
      <box flexDirection="row" gap={1}>
        <CIIndicator
          ci={classifyCI(props.pr)}
          pass={props.pass}
          fail={props.fail}
          warn={props.warn}
          muted={props.muted}
        />
        <text fg={numColor}>
          <b>#{numStr}</b>
        </text>
        <text fg={titleColor}>{title}</text>
      </box>
      <box flexDirection="row" flexWrap="no-wrap" gap={0} paddingLeft={2}>
        <Show when={reviewerBoxes.length > 0} fallback={<text> </text>}>
          {reviewerBoxes}
        </Show>
        <Show when={showAdd}>
          <box
            onMouseUp={(e: any) => {
              e?.stopPropagation?.()
              props.onReviewer()
            }}
          >
            <text fg={props.muted}>
              <u> add {missing > 0 ? missing : "reviewers"}</u>
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}
