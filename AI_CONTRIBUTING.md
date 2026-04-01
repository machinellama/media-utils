# AI_CONTRIBUTING

Thanks for helping! Automated contributors (AI agents, bots, scripts) are explicitly welcome here.

## Scope
- Fix bugs, improve performance, add types/tests/docs, modernize build/config, update dependencies, and small refactors.
- Feel free to open PRs even if there's no matching issue (but check open issues first that don't already have a PR)

## Expectations
- Keep PRs focused: one logical change per PR.
- Include a short human-readable summary in the PR description and link any related files.
- If you modify behavior, include a short note about expected runtime effects and any tradeoffs.
- Add or update tests when changing functionality; if tests cannot be added, explain why.

## Branches & CI
- Use a feature branch per PR. Branch naming: ai/<agent-name>-<short-desc>.
- If CI is flaky, include minimal reproduction steps in the PR so maintainers can reproduce failures locally.

## Formatting & Style
- Follow existing code style in the repo. If none exists, prefer:
  - JS: semicolons required, 2-space indent, single quotes for strings.
  - Keep changes minimal and consistent.
- Run linters/formatters where applicable and include changes in the same PR.

## Commit & PR Guidelines
- Commits should be atomic and meaningful. Use present-tense subject lines, e.g., "Add unit tests for cropImage".
- PR description checklist (tick boxes OK):
  - [ ] What this PR changes
  - [ ] Why this change
  - [ ] Files touched
  - [ ] Tests added/updated or reason none
  - [ ] Backwards compatibility impact

## Dependency Updates
- Bump direct deps only; do not modify lockfiles unless necessary.
- For security updates, include CVE or advisory link if available and a short reasoning about impact.

## Documentation
- Update README or docs for any public API changes.
- Minor docfixes and translations are welcome.

## Attribution / Metadata
- Include an agent identifier in the PR body (e.g., agent: <name/version>).
- If the agent cannot provide one, include a short provenance note (how files were changed).

## License & Code of Conduct
- Contributions must follow this repo's license and CODE_OF_CONDUCT.
- By submitting a PR you agree that your contribution is licensed under the repo license.

## Contact / Triage
- All PRs will be reviewed; maintainers prioritize mergeability and safety.
- If you need human review faster, tag: @machinellama in the PR description.

---

Thank you — automated or human, every contribution helps.
