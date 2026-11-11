# claude-kits on Online Boutique

This folder records [claude-kits](https://github.com/myhts/claude-kits) being applied to this copy of Google's
Online Boutique, one stage at a time. Each page has the same shape: what the feature is for, what we typed, what
Claude did, what we decided, the evidence, what it cost, and what didn't work, with the fix.

| Stage | What it proves | Page |
|---|---|---|
| 1 Who reads the code | choosing an agent's model by a test, not by taste | [01-who-reads-the-code.md](01-who-reads-the-code.md) · [ADR 0001](adr/0001-explorer-readers-on-sonnet.md) |
| 2 The architecture | `/project-explorer`: the map, and flows run for real or traced from code | [02-the-architecture.md](02-the-architecture.md) · [the live explorer](https://myhts.github.io/claude-kits-boutique/explorer/explorer.html) |
| 2b The whole shop | every service run; each traced bug made to happen through the real shop | [02b-the-whole-shop.md](02b-the-whole-shop.md) |
| 3 Set up the flow | `/setup-project` on a five-language repository | to come |
| 4 Features, end to end | plan, spec, tickets, test-first build, reviewers, human review | to come |
| 5 The reviewers | the reviewers on real code with planted defects | to come |
| 6 Ship it | images per changed service, `/deploy`, rollout and undo | to come |
| 7 Retro | what worked, what didn't, what it cost | to come |

Stage 2 ran only the Node and Java services (currency, payment, ads) and traced the rest from the code; Stage 2b ran
the whole shop. Breakpoints exist in the Node and Java services; the others are watched through their logs. Everything outside this folder is Google's, under the [Apache License 2.0](../../LICENSE).
