# ADR 0001: The explorer's readers run on Sonnet; the judgement stays on Opus

**Status:** accepted, 2026-11-09 · **Evidence:** [Stage 1](../01-who-reads-the-code.md)

## Context

On a big repository, `/project-explorer` hands the reading to subagents, one per service. Until now they ran on
whatever model the session used, usually Opus. Reading is most of the tokens and little of the judgement, so it was
worth knowing whether a cheaper model reads as well.

## Decision

- The survey readers run on **Sonnet** (`model: "sonnet"`), one per service, started together.
- **Opus** does everything else: checking and merging the readers' sheets, the map, the flows, the explanations, the
  questions at each gate, reading screenshots. Any other subagent runs on Opus too.

## Why

On this repository, Sonnet readers found every entry point, call and store the Opus readers found, with no broken
references, in two runs out of two, at about half the cost of a run. Haiku readers found the same but cost no less,
because they made three to four times the tool calls, and they noted far less of what they couldn't trace. A blind
read of the three draft maps found none clearly worse.

## Consequences

- An explorer run on a big repository costs about half as much, and the part that shapes what a learner sees doesn't
  change model.
- The session should run on Opus. The explorer says so if it isn't.
- The main session now checks each sheet against the repository's own contracts and deployment config. That adds a
  little cost back, and catches a reader's miss before it reaches the map.
- Revisit when Claude Code offers Haiku 5.5, or when a repository of another shape (a monolith, a monorepo of
  libraries) gives different results.
