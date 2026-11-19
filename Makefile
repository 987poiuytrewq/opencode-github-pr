.PHONY: opencode install format-check typecheck test test-unit test-integration test-e2e test-watch demo ci ci-tools ci-debug

BUN ?= bun
OPENCODE_BIN ?= opencode
OPENCODE_VERSION ?= 2.0.20

install:
	$(BUN) install --frozen-lockfile

format-check:
	$(BUN) fmt --check package.json .github/workflows/ci.yml tests/integration/github-loader.test.ts
	$(BUN) -e 'const readme = await Bun.file("README.md").text(); const match = readme.match(/```json\s*\n([\s\S]*?)\n\s*```/); if (!match) throw new Error("README strict JSON example not found"); JSON.parse(match[1])'

typecheck:
	$(BUN) ./node_modules/typescript/bin/tsc --noEmit

test-unit:
	$(BUN) test tests/unit

test-integration:
	$(BUN) test tests/integration

test-e2e:
	@command -v tmux >/dev/null || { echo "tmux is required for E2E tests" >&2; exit 1; }
	@command -v "$(OPENCODE_BIN)" >/dev/null || { echo "OpenCode binary not found: $(OPENCODE_BIN)" >&2; exit 1; }
	E2E=1 OPENCODE_BIN="$(OPENCODE_BIN)" $(BUN) test tests/e2e

test-watch:
	$(BUN) test --watch

demo:
	$(BUN) run demo/capture.ts --output demo/demo.cast --gif --overwrite

test: format-check typecheck test-unit test-integration test-e2e

ci: install test

# GitHub Actions runs this on Ubuntu before invoking the test targets.
ci-tools:
	sudo apt-get update
	sudo apt-get install --yes tmux
	npm install --global @opencode/cli@$(OPENCODE_VERSION)

ci-debug:
	@log="$$HOME/.local/share/opencode/log/opencode.log"; \
	if [ -f "$$log" ]; then \
		grep -Ei 'failed to load plugin|plugin.*failed|failed.*plugin|plugin.*error|error.*plugin' "$$log" | tail -100 || true; \
	else echo "OpenCode log not found: $$log"; fi

# Use a private server so the GitHub token is available to both plugin parts.
# Resolve the local package from this worktree explicitly: linked worktrees
# share a project identity, so the relative plugin target "." can resolve to
# another worktree's checkout.
opencode:
	@token="$${GH_TOKEN:-$${GITHUB_TOKEN:-$${GITHUB_PERSONAL_ACCESS_TOKEN}}}"; \
	if [ -z "$$token" ]; then token="$$(gh auth token)"; fi; \
	project="$$(pwd -P)"; \
	config_dir="$$(mktemp -d)"; \
	trap 'rm -rf "$$config_dir"' EXIT; \
	config="$$config_dir/opencode.json"; \
	PROJECT_DIR="$$project" CONFIG_PATH="$$config" $(BUN) -e 'await Bun.write(process.env.CONFIG_PATH, JSON.stringify({ plugins: [process.env.PROJECT_DIR] }))'; \
	GH_TOKEN="$$token" \
	OPENCODE_CONFIG_PROJECT_DISABLE=1 \
	OPENCODE_CONFIG="$$config" \
	opencode --standalone "$$project"
