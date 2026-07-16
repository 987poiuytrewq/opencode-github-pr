import { beforeEach, describe, expect, test } from "bun:test"
import { detectRepo, JSON_FIELDS, listOpenPRs, PrDashboardPlugin } from "../../plugins/pr-dashboard"
import { MockShell } from "../helpers/mock-shell"
import { makePR, samplePRs } from "../helpers/fixtures"

describe("detectRepo", () => {
  test("returns owner/repo on success", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ stdout: "foo/bar\n" }))
      .build()
    expect(await detectRepo($, "/work/foo")).toBe("foo/bar")
  })

  test("trims surrounding whitespace", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ stdout: "  foo/bar  \n" }))
      .build()
    expect(await detectRepo($, "/work/foo")).toBe("foo/bar")
  })

  test("returns null when gh command fails", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ exitCode: 1, stderr: "not a repo" }))
      .build()
    expect(await detectRepo($, "/work/foo")).toBeNull()
  })

  test("returns null when output has no slash", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ stdout: "no-slash-here" }))
      .build()
    expect(await detectRepo($, "/work/foo")).toBeNull()
  })

  test("returns null when output is empty", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ stdout: "" }))
      .build()
    expect(await detectRepo($, "/work/foo")).toBeNull()
  })

  test("returns null when output has only one segment", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ stdout: "only-owner" }))
      .build()
    expect(await detectRepo($, "/work/foo")).toBeNull()
  })
})

describe("listOpenPRs", () => {
  test("parses JSON output on success", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ stdout: JSON.stringify(samplePRs) }))
      .build()
    const prs = await listOpenPRs($, "any")
    expect(prs).toHaveLength(samplePRs.length)
    expect(prs[0].number).toBe(10)
  })

  test("passes --author @me when author=me", async () => {
    let capturedArgs: string[] = []
    const $ = new MockShell()
      .on(/^gh$/, (_cmd, args) => {
        capturedArgs = args
        return { stdout: "[]" }
      })
      .build()
    await listOpenPRs($, "me")
    expect(capturedArgs).toContain("--author")
    expect(capturedArgs).toContain("@me")
  })

  test("does not pass --author when author=any", async () => {
    let capturedArgs: string[] = []
    const $ = new MockShell()
      .on(/^gh$/, (_cmd, args) => {
        capturedArgs = args
        return { stdout: "[]" }
      })
      .build()
    await listOpenPRs($, "any")
    expect(capturedArgs).not.toContain("--author")
  })

  test("uses JSON_FIELDS constant", async () => {
    let capturedArgs: string[] = []
    const $ = new MockShell()
      .on(/^gh$/, (_cmd, args) => {
        capturedArgs = args
        return { stdout: "[]" }
      })
      .build()
    await listOpenPRs($, "any")
    const jsonIdx = capturedArgs.indexOf("--json")
    expect(jsonIdx).toBeGreaterThan(-1)
    expect(capturedArgs[jsonIdx + 1]).toBe(JSON_FIELDS)
  })

  test("propagates error when gh fails", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ exitCode: 1, stderr: "auth required" }))
      .build()
    await expect(listOpenPRs($, "any")).rejects.toThrow()
  })

  test("parses empty list", async () => {
    const $ = new MockShell()
      .on(/^gh$/, () => ({ stdout: "[]" }))
      .build()
    expect(await listOpenPRs($, "any")).toEqual([])
  })
})

describe("PrDashboardPlugin", () => {
  let shell: MockShell
  beforeEach(() => {
    shell = new MockShell()
  })

  function buildApi() {
    return {
      $: shell.build(),
      directory: "/work/foo",
      client: {} as any,
      project: {} as any,
      worktree: "/work/foo",
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("http://localhost:0"),
    }
  }

  test("exports tool definitions for all three tools", async () => {
    const hooks = await PrDashboardPlugin(buildApi() as any)
    expect(hooks.tool).toBeDefined()
    expect(Object.keys(hooks.tool!).sort()).toEqual(
      ["pr_add_reviewer", "pr_dashboard", "pr_rerequest_review"].sort(),
    )
  })

  describe("pr_dashboard tool", () => {
    test("returns noRepoError when not in a repo", async () => {
      shell.on(/^gh$/, () => ({ exitCode: 1, stderr: "no" }))
      const hooks = await PrDashboardPlugin(buildApi() as any)
      const out = await hooks.tool!.pr_dashboard.execute({ author: "any" } as any, {
        directory: "/work/foo",
      } as any)
      expect(out).toContain("not a GitHub repository")
      expect(out).toContain("/work/foo")
    })

    test("returns ghListError when gh pr list fails", async () => {
      let callCount = 0
      shell
        .on(/^gh$/, (_cmd, args) => {
          callCount++
          if (args.includes("repo") && args.includes("view")) {
            return { stdout: "foo/bar\n" }
          }
          if (args.includes("pr") && args.includes("list")) {
            return { exitCode: 1, stderr: "rate limited" }
          }
          return { stdout: "" }
        })
      const hooks = await PrDashboardPlugin(buildApi() as any)
      const out = await hooks.tool!.pr_dashboard.execute({ author: "any" } as any, {
        directory: "/work/foo",
      } as any)
      expect(out).toContain("failed to list PRs")
      expect(out).toContain("rate limited")
      expect(callCount).toBeGreaterThanOrEqual(2)
    })

    test("formats dashboard on success", async () => {
      shell
        .on(/^gh$/, (_cmd, args) => {
          if (args.includes("repo") && args.includes("view")) {
            return { stdout: "foo/bar\n" }
          }
          if (args.includes("pr") && args.includes("list")) {
            return { stdout: JSON.stringify(samplePRs) }
          }
          return { stdout: "" }
        })
      const hooks = await PrDashboardPlugin(buildApi() as any)
      const out = await hooks.tool!.pr_dashboard.execute({ author: "any" } as any, {
        directory: "/work/foo",
      } as any)
      expect(out).toContain("# PR Dashboard — foo/bar")
      expect(out).toContain("#10")
    })

    test("defaults author to 'any' when omitted", async () => {
      let capturedArgs: string[] = []
      shell
        .on(/^gh$/, (_cmd, args) => {
          capturedArgs = args
          if (args.includes("repo") && args.includes("view")) {
            return { stdout: "foo/bar\n" }
          }
          if (args.includes("pr") && args.includes("list")) {
            return { stdout: "[]" }
          }
          return { stdout: "" }
        })
      const hooks = await PrDashboardPlugin(buildApi() as any)
      await hooks.tool!.pr_dashboard.execute({} as any, {
        directory: "/work/foo",
      } as any)
      expect(capturedArgs).not.toContain("--author")
    })

    test("uses context.directory when provided", async () => {
      let capturedCwd: string | undefined
      shell
        .on(/^gh$/, () => ({ stdout: "foo/bar\n" }))
      const hooks = await PrDashboardPlugin({ ...buildApi(), directory: "/default" } as any)
      // Patch the $ to capture cwd
      const api = buildApi()
      let actualCwd: string | undefined
      const tag = (strings: TemplateStringsArray) => {
        const chain: any = {
          cwd: (c: string) => {
            actualCwd = c
            return chain
          },
          text: async () => {
            return "foo/bar\n"
          },
        }
        return chain
      }
      const patchedHooks = await PrDashboardPlugin({ ...api, $: tag as any } as any)
      await patchedHooks.tool!.pr_dashboard.execute({} as any, {
        directory: "/override",
      } as any)
      expect(actualCwd).toBe("/override")
    })
  })

  describe("pr_add_reviewer tool", () => {
    test("invokes gh pr edit with --add-reviewer", async () => {
      let capturedArgs: string[] = []
      shell
        .on(/^gh$/, (_cmd, args) => {
          capturedArgs = args
          return { stdout: "" }
        })
      const hooks = await PrDashboardPlugin(buildApi() as any)
      const out = await hooks.tool!.pr_add_reviewer.execute(
        { pr: 42, reviewer: "alice" } as any,
        { directory: "/work/foo" } as any,
      )
      expect(capturedArgs).toContain("42")
      expect(capturedArgs).toContain("--add-reviewer")
      expect(capturedArgs).toContain("alice")
      expect(out).toContain("alice")
      expect(out).toContain("42")
    })

    test("returns error message on failure", async () => {
      shell
        .on(/^gh$/, () => ({ exitCode: 1, stderr: "permission denied" }))
      const hooks = await PrDashboardPlugin(buildApi() as any)
      const out = await hooks.tool!.pr_add_reviewer.execute(
        { pr: 42, reviewer: "alice" } as any,
        { directory: "/work/foo" } as any,
      )
      expect(out).toContain("Error")
      expect(out).toContain("permission denied")
    })

    test("includes gh output when present", async () => {
      shell
        .on(/^gh$/, () => ({ stdout: "Updated pull request #42" }))
      const hooks = await PrDashboardPlugin(buildApi() as any)
      const out = await hooks.tool!.pr_add_reviewer.execute(
        { pr: 42, reviewer: "alice" } as any,
        { directory: "/work/foo" } as any,
      )
      expect(out).toContain("Updated pull request #42")
    })
  })

  describe("pr_rerequest_review tool", () => {
    test("invokes gh pr edit with --add-reviewer", async () => {
      let capturedArgs: string[] = []
      shell
        .on(/^gh$/, (_cmd, args) => {
          capturedArgs = args
          return { stdout: "" }
        })
      const hooks = await PrDashboardPlugin(buildApi() as any)
      const out = await hooks.tool!.pr_rerequest_review.execute(
        { pr: 7, reviewer: "bob" } as any,
        { directory: "/work/foo" } as any,
      )
      expect(capturedArgs).toContain("7")
      expect(capturedArgs).toContain("--add-reviewer")
      expect(capturedArgs).toContain("bob")
      expect(out).toContain("Re-requested")
    })

    test("returns error message on failure", async () => {
      shell
        .on(/^gh$/, () => ({ exitCode: 1, stderr: "not allowed" }))
      const hooks = await PrDashboardPlugin(buildApi() as any)
      const out = await hooks.tool!.pr_rerequest_review.execute(
        { pr: 7, reviewer: "bob" } as any,
        { directory: "/work/foo" } as any,
      )
      expect(out).toContain("Error")
      expect(out).toContain("not allowed")
    })

    test("falls back to plugin directory when context has none", async () => {
      let capturedCwd: string | undefined
      const api = buildApi()
      const tag = (strings: TemplateStringsArray) => {
        const chain: any = {
          cwd: (c: string) => {
            capturedCwd = c
            return chain
          },
          text: async () => "",
        }
        return chain
      }
      const patchedHooks = await PrDashboardPlugin({ ...api, $: tag as any } as any)
      await patchedHooks.tool!.pr_add_reviewer.execute(
        { pr: 1, reviewer: "x" } as any,
        {} as any,
      )
      expect(capturedCwd).toBe("/work/foo")
    })
  })
})
