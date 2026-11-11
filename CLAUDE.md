# Online Boutique (claude-kits copy)

Google's Online Boutique microservices demo: eleven services in five languages talking gRPC through
`protos/demo.proto`. `docs/claude-kits/` records claude-kits being applied to it, one stage per page; each stage's
problems with the toolkit go in that page's "Feedback for claude-kits" section.

## Agent skills

### Issue tracker

GitHub Issues for this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

`ready-for-agent` marks tickets from `/to-tickets`; `wayfinder:map` and `wayfinder:<type>` mark planning maps and their
decision tickets.

### Domain docs

Single context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.

## Pipeline

Stack, commands and build mode: `docs/agents/stack.md`. Choose the path by size:

- **Tiny change** (one idea, easy to redo): make it, then open a PR.
- **Anything bigger:** `/grill-with-docs` first; for an event-driven domain it also loads `event-storming`.
- **Bigger than one session, or foggy:** `/wayfinder`, then `/to-spec` and `/to-tickets`.
- **Each ticket:** `/implement <ticket>`. **Each PR:** `/human-review <PR>`, then the human merges.
- **Between phases:** continue if the next phase needs this one's reasoning; otherwise clear, hand off, use a subagent
  or compact, in that order. End each phase by naming the next command, and whether to `/clear` first.
