.PHONY: opencode install typecheck test test-unit test-integration test-e2e test-watch ci ci-tools

BUN ?= bun
OPENCODE_BIN ?= opencode
OPENCODE_VERSION ?= 2.0.20

install:
	$(BUN) install --frozen-lockfile

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

test: typecheck test-unit test-integration test-e2e

ci: install test

# GitHub Actions runs this on Ubuntu before invoking the test targets.
ci-tools:
	sudo apt-get update
	sudo apt-get install --yes tmux
	npm install --global @opencode/cli@$(OPENCODE_VERSION)

# Use a private server so the GitHub token is available to both plugin parts.
opencode:
	@token="$${GH_TOKEN:-$${GITHUB_TOKEN:-$${GITHUB_PERSONAL_ACCESS_TOKEN}}}"; \
	if [ -z "$$token" ]; then token="$$(gh auth token)"; fi; \
	GH_TOKEN="$$token" opencode --standalone
