import { describe, expect, test } from "bun:test"
import { parseReviewerTarget } from "../../plugins/domain/reviewer-target"

const repo = { owner: "Acme", repo: "widgets" }

describe("parseReviewerTarget", () => {
  test("accepts a GitHub login", () => {
    expect(parseReviewerTarget("octocat", repo)).toEqual({
      kind: "user",
      login: "octocat",
    })
  })

  test("accepts an exact team path for the repository owner", () => {
    expect(parseReviewerTarget("Acme/platform-team", repo)).toEqual({
      kind: "team",
      organization: "Acme",
      slug: "platform-team",
    })
  })

  test.each([
    "",
    " octocat",
    "@octocat",
    "foo/bar/baz",
    "other-org/platform",
    "acme/",
    "/platform",
    "bad_slug",
    "ends-",
    "-starts",
  ])("rejects malformed or out-of-repository reviewer %j", (value) => {
    expect(parseReviewerTarget(value, repo)).toBeNull()
  })
})
