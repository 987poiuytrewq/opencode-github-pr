.PHONY: opencode

# Use a private server so the GitHub token is available to both plugin parts.
opencode:
	@token="$${GH_TOKEN:-$${GITHUB_TOKEN:-$${GITHUB_PERSONAL_ACCESS_TOKEN}}}"; \
	if [ -z "$$token" ]; then token="$$(gh auth token)"; fi; \
	GH_TOKEN="$$token" opencode --standalone
