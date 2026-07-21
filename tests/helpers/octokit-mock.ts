import { mock } from "bun:test"
import { setOctokit } from "../../plugins/infra/octokit"

// Op-specific handlers receive just the request params (the op is already
// matched). The default handler receives (op, params) so it can dispatch
// across multiple operations in a single test.
export type OctokitHandler = (params: any) => any
export type OctokitDefaultHandler = (op: string, params: any) => any

const handlers: { match: (op: string, params: any) => boolean; respond: OctokitHandler }[] = []
let defaultHandler: OctokitDefaultHandler | null = null

export function mockOctokitOp(op: string, respond: OctokitHandler) {
  handlers.push({
    match: (o, p) => o === op,
    respond,
  })
}

export function mockOctokitDefault(respond: OctokitDefaultHandler) {
  defaultHandler = respond
}

export function clearOctokitMocks() {
  handlers.length = 0
  defaultHandler = null
  // Keep a mock client installed so getOctokit() returns it instead of
  // trying real auth (which would hang in tests). The client will throw
  // clean errors if test code calls an un-mocked operation.
  setOctokit(buildMockClient())
}

function buildMockClient() {
  return {
    pulls: {
      list: async (params: any) => dispatch("pulls.list", params),
      get: async (params: any) => dispatch("pulls.get", params),
      requestReviewers: async (params: any) => dispatch("pulls.requestReviewers", params),
    },
    repos: {
      getBranchProtection: async (params: any) => dispatch("repos.getBranchProtection", params),
    },
    orgs: {
      listMembers: (params: any) => dispatch("orgs.listMembers", params),
    },
    graphql: async (query: string, params: any) => dispatch("graphql", { query, params }),
    paginate: {
      iterator: (fn: any, params: any) => {
        return (async function* () {
          const res = await fn(params)
          yield res
        })()
      },
    },
  } as any
}

async function dispatch(op: string, params: any): Promise<any> {
  for (const h of handlers) {
    if (h.match(op, params)) return h.respond(params)
  }
  if (defaultHandler) return defaultHandler(op, params)
  throw new Error(`No Octokit mock for ${op}: ${JSON.stringify(params)}`)
}

export function installOctokitMock() {
  setOctokit(buildMockClient())
}
