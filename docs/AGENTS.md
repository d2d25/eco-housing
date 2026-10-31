# Codex Notes For This Project

Keep work token-efficient:

- Inspect current state first with targeted commands such as `git status --short`, `rg`, and small file reads.
- Do not dump long logs or JSON payloads in chat. Summarize the important lines and write large output to `tmp/` when needed.
- Prefer focused tests while iterating. Run full validation only before commit, release, or when behavior spans multiple modules.
- Keep implementation steps small and verifiable.
- Reuse known evidence from the current worktree and live server checks instead of redoing broad discovery.
- For Eco server work, target the existing Eco web server on port `3001`; do not reinstall the experimental UserCode/HttpListener bootstrap by default.
- Treat live proof as required for server integration: EcoServer must start, logs must show `Loading EcoHousingExporter...`, and endpoints must answer under `/api/v1/eco-housing`.
