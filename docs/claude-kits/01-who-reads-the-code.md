# 1. Who reads the code

**The feature:** `/project-explorer`'s survey, and how claude-kits chooses a model for an agent: by a test with the
rule written down first, not by taste.

**In one line:** cheaper readers (Sonnet) found everything the expensive ones (Opus) found, at about half the cost.
So Sonnet reads the code, and Opus keeps everything that needs judgement.

## What it's for

Before the explorer can draw a map of this 11-service, 5-language app, something has to read every service: what it
offers, whom it calls, where it keeps data. On a repository this size that's a lot of reading and not much
judgement, so a cheaper model might do it just as well. The question was whether cheaper readers would make the
architecture worse.

## How it was tested

| | |
|---|---|
| **Arms** | readers on Opus, on Sonnet, on Haiku. The main session, which merges, checks and draws the map, was Opus every time |
| **Each run** | the explorer's first two phases, headless, in a fresh clone of this repository at `c7cb6d5b`; nothing run or built. Opus once, Sonnet and Haiku twice each |
| **Answer key** | taken from the code itself, by a script: the 15 gRPC methods in `protos/demo.proto`, the frontend's 8 routes, the 14 calls between services set in `kubernetes-manifests/`, and Redis behind the cart |
| **Rule, fixed before any run** | an arm passes when it finds every call Opus found, at least 95% of the entry points, and no `file:line` it cites is broken. The cheapest arm that passes wins |
| **Then** | a fresh agent read the three draft maps blind (labelled X, Y, Z) and said which was clearest and whether any was clearly worse |

The tools and the rule are in claude-kits: [`kit-check/explorer-eval/`](https://github.com/myhts/claude-kits/pull/9).

## What we typed

From claude-kits' `kit-check/explorer-eval/` folder, one run per arm, one after another:

```bash
./run.sh path/to/claude-kits-boutique opus 1      # then sonnet 1, haiku 1, sonnet 2, haiku 2
node score.mjs work/answers.json work/opus-1/repo opus=work/opus-1/survey.json sonnet=… haiku=…
```

Each run asks the explorer to do its first two phases only, with one reader per service folder on the arm's model,
and to stop before its first question. In everyday use you'd just type `/pipeline:project-explorer`.

## What Claude did

In each run Claude first checked the repository for secrets and confidential data, then started one reader per
service folder, twelve at once. Each reader returned a short fact sheet: entry points, calls and stores, each with the
line of code that shows it. The main session checked the sheets, merged them into one survey, and drafted the map and
the list of flows worth explaining. About four minutes a run.

## Results

| Run | Entry points | Calls | Store | Broken refs | List price |
|---|---|---|---|---|---|
| Opus | 23/23 | 14/14 | 1/1 | 0 of 118 | $4.02 |
| Sonnet, run 1 · 2 | 23/23 · 23/23 | 14/14 · 14/14 | 1/1 · 1/1 | 0 · 0 | $2.09 · $2.45 |
| Haiku, run 1 · 2 | 23/23 · 23/23 | 14/14 · 14/14 | 1/1 · 1/1 | 0 · 0 | $2.14 · $2.64 |

- **Every run found everything.** No reader made up a call. Every call outside the key (telemetry, the profiler,
  Google Cloud services, Gemini) was checked against the line it cites, and is real.
- **Sonnet readers halved the cost.** The Opus session that does the judgement became most of what's left.
- **Haiku's lower price didn't show.** Its readers made three to four times as many tool calls as Sonnet's, so they
  cost the same or more. They also noted far less of what they couldn't trace: 3 to 5 notes against 48 to 61.
- **The blind read found no map clearly worse.** It ranked Opus's first, Haiku's second and Sonnet's third. All three
  got the system's shape right, each with a few slips on failure paths.

## What we decided

**Sonnet reads; Opus decides.** The readers run on Sonnet. The map, the flows, the explanations and every other
judgement stay on Opus. The reasons are in [ADR 0001](adr/0001-explorer-readers-on-sonnet.md). The explorer
changed to match in [claude-kits #10](https://github.com/myhts/claude-kits/pull/10). A check run of the changed
explorer started all twelve readers on Sonnet by itself and found everything again.

## Evidence

- [Raw scores and usage](evidence/test-1/scores.md), as the tools printed them.
- The three draft maps: [Opus](evidence/test-1/draft-map-opus.md), [Sonnet](evidence/test-1/draft-map-sonnet.md),
  [Haiku](evidence/test-1/draft-map-haiku.md). Everything in them is traced from code, not run.
- [The blind read](evidence/test-1/blind-read.md), with the label key and the claims checked again in the code.

## What it cost

Five runs came to $13.35 at list price, and the check run of the changed explorer to $3.05. They ran on a Claude Max
plan, so nothing extra was billed; list price is just the fair way to compare runs.

## What didn't work, and the fix

- **The scorer misread notes.** Opus wrote notes in brackets after names, and the scorer read them as part of the
  name, so a method it had found counted as missed. The scorer now ignores bracketed notes. This was fixed after the
  Opus run and before the others were scored, and it's recorded in the test's README.
- **The rule's tie-break assumed list prices.** It listed the arms "Haiku, then Sonnet, then Opus". Measured, Sonnet
  was cheaper in both runs, so the measurement decided, and the scorer now says so.
- **The blind read can't separate the readers from the session.** The Opus session writes the map in every arm, so
  the map ranking mostly measures that session. The scores on the readers' own fact sheets are the cleaner comparison,
  and the evidence includes them.
- **Limits:** one repository, and Opus ran once. `haiku` in Claude Code is Haiku 4.5, so test again when Haiku 5.5 is
  offered there.
