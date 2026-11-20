import { describe, expect, test } from "bun:test"
import { parseReviewerInput } from "../../plugins/domain/reviewer"

describe("parseReviewerInput", () => {
  test("classifies a GitHub username", () => {
    expect(parseReviewerInput(" octocat ", "acme")).toEqual({
      kind: "user",
      login: "octocat",
    })
  })

  test("classifies an org/team slug and returns the API team slug", () => {
    expect(parseReviewerInput("@Acme/design-reviewers", "acme")).toEqual({
      kind: "team",
      slug: "design-reviewers",
    })
  })

  test.each([
    "",
    "two words",
    "bad/name/extra",
    "acme/",
    "/team",
    "other-org/team",
    "-bad",
    "bad-",
  ])("rejects invalid reviewer input %j", (input) => {
    expect(() => parseReviewerInput(input, "acme")).toThrow()
  })
})
