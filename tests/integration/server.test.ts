import { beforeEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { PrDashboardPlugin } from "../../plugins/pr-dashboard"
import {
  clearOctokitMocks,
  installOctokitMock,
  mockOctokitOp,
} from "../helpers/octokit-mock"
import { makeFakeRepo } from "../helpers/graphql-mock"

installOctokitMock()

function buildContext(directory: string) {
  const tools: Record<string, any> = {}
  const context = {
    location: { directory, project: { id: "project", directory, canonical: directory } },
    tool: {
      transform: async (register: (editor: any) => void) => {
        register({ add: (tool: any) => { tools[tool.name] = tool } })
        return { dispose: async () => {} }
      },
    },
    session: {
      get: async () => ({ location: { directory } }),
    },
  }
  const toolContext = {
    sessionID: "test-session",
    agent: "build",
    messageID: "test-message",
    id: "test-call",
    signal: new AbortController().signal,
    progress: async () => {},
  }
  return { context: context as any, tools, toolContext }
}

beforeEach(() => {
  clearOctokitMocks()
})

describe("PrDashboardPlugin V2 server part", () => {
  test("has a stable V2 plugin id", () => {
    expect(PrDashboardPlugin.id).toBe("opencode-github-pr")
  })

  test("registers both reviewer tools with JSON Schema inputs", async () => {
    const { context, tools } = buildContext("/work/foo")
    await PrDashboardPlugin.setup(context)
    expect(Object.keys(tools).sort()).toEqual(["pr_add_reviewer", "pr_rerequest_review"])
    expect(tools.pr_add_reviewer.input.required).toEqual(["pr", "reviewer"])
    expect(tools.pr_rerequest_review.input.properties.reviewer.type).toBe("string")
  })

  describe("pr_add_reviewer tool", () => {
    test("calls requestReviewers with the right args", async () => {
      const dir = makeFakeRepo("foo", "bar")
      let captured: any = null
      mockOctokitOp("pulls.requestReviewers", (params: any) => {
        captured = params
        return { data: {} }
      })
      const { context, tools, toolContext } = buildContext(dir)
      await PrDashboardPlugin.setup(context)
      const out = await tools.pr_add_reviewer.execute({ pr: 42, reviewer: "alice" }, toolContext)
      expect(captured).toMatchObject({
        owner: "foo",
        repo: "bar",
        pull_number: 42,
        reviewers: ["alice"],
      })
      expect(out.content).toContain("alice")
      expect(out.content).toContain("42")
      rmSync(dir, { recursive: true, force: true })
    })

    test("returns an error message on failure", async () => {
      const dir = makeFakeRepo("foo", "bar")
      mockOctokitOp("pulls.requestReviewers", () => {
        const e: any = new Error("permission denied")
        e.status = 403
        throw e
      })
      const { context, tools, toolContext } = buildContext(dir)
      await PrDashboardPlugin.setup(context)
      const out = await tools.pr_add_reviewer.execute({ pr: 42, reviewer: "alice" }, toolContext)
      expect(out.content).toContain("Failed:")
      expect(out.content).toContain("permission denied")
      rmSync(dir, { recursive: true, force: true })
    })
  })

  describe("pr_rerequest_review tool", () => {
    test("calls requestReviewers and reports the re-request", async () => {
      const dir = makeFakeRepo("foo", "bar")
      let captured: any = null
      mockOctokitOp("pulls.requestReviewers", (params: any) => {
        captured = params
        return { data: {} }
      })
      const { context, tools, toolContext } = buildContext(dir)
      await PrDashboardPlugin.setup(context)
      const out = await tools.pr_rerequest_review.execute({ pr: 7, reviewer: "bob" }, toolContext)
      expect(captured).toMatchObject({
        owner: "foo",
        repo: "bar",
        pull_number: 7,
        reviewers: ["bob"],
      })
      expect(out.content).toContain("Re-requested")
      rmSync(dir, { recursive: true, force: true })
    })

    test("uses the session location instead of the plugin load location", async () => {
      const sessionDir = makeFakeRepo("session-owner", "session-repo")
      let captured: any = null
      mockOctokitOp("pulls.requestReviewers", (params: any) => {
        captured = params
        return { data: {} }
      })
      const { context, tools, toolContext } = buildContext("/plugin/config/location")
      context.session.get = async () => ({ location: { directory: sessionDir } })
      await PrDashboardPlugin.setup(context)
      await tools.pr_add_reviewer.execute({ pr: 1, reviewer: "x" }, toolContext)
      expect(captured.owner).toBe("session-owner")
      expect(captured.repo).toBe("session-repo")
      rmSync(sessionDir, { recursive: true, force: true })
    })
  })
})
