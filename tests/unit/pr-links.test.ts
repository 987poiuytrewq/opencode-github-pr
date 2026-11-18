import { describe, expect, test } from "bun:test"
import { prTargetUrl } from "../../plugins/domain/pr-links"

describe("prTargetUrl", () => {
  const url = "https://github.com/octocat/Hello-World/pull/42"

  test("uses the PR overview by default", () => {
    expect(prTargetUrl(url)).toBe(url)
    expect(prTargetUrl(url, "overview")).toBe(url)
  })

  test("builds checks and files pages from the PR URL", () => {
    expect(prTargetUrl(url, "checks")).toBe(`${url}/checks`)
    expect(prTargetUrl(url, "files")).toBe(`${url}/files`)
  })

  test("normalizes a trailing slash before appending a page", () => {
    expect(prTargetUrl(`${url}/`, "checks")).toBe(`${url}/checks`)
  })
})
