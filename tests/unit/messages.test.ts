import { describe, expect, test } from "bun:test"
import { prListErrorKind, prListErrorMessage } from "../../plugins/domain/messages"

describe("PR list error classification", () => {
  test("classifies authentication and missing-token failures", () => {
    const unauthorized = Object.assign(new Error("Bad credentials"), { status: 401 })
    expect(prListErrorKind(unauthorized)).toBe("authentication")
    expect(prListErrorMessage(unauthorized)).toBe("Not authorised, check token is valid")
    expect(prListErrorKind(new Error("Not authenticated, set GITHUB_TOKEN."))).toBe("authentication")
  })

  test("classifies permission, rate-limit, and not-found failures", () => {
    expect(prListErrorKind(Object.assign(new Error("Forbidden"), { status: 403 }))).toBe("forbidden")
    expect(prListErrorKind(Object.assign(new Error("API rate limit exceeded"), { status: 403 }))).toBe("rate-limit")
    expect(prListErrorKind(Object.assign(new Error("Not Found"), { status: 404 }))).toBe("not-found")
  })

  test("classifies query, timeout, network, server, and unknown failures", () => {
    expect(prListErrorKind(Object.assign(new Error("Invalid query"), { status: 422 }))).toBe("invalid-query")
    expect(prListErrorKind(Object.assign(new Error("Request timed out"), { status: 408 }))).toBe("timeout")
    expect(prListErrorKind(Object.assign(new Error("connect failed"), { code: "ECONNRESET" }))).toBe("network")
    expect(prListErrorKind(Object.assign(new Error("GitHub error"), { status: 502 }))).toBe("server")
    expect(prListErrorKind(new Error("Unexpected failure"))).toBe("unknown")
  })
})
