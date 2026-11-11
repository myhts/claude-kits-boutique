# 3. Set up the flow

**The feature:** `/pipeline:setup-project`, the step that tells every later stage what the stack is, which commands
prove a change works, where tickets live and how big a PR may be. Then `/pipeline:setup-project protect` makes
GitHub enforce it.

**In one line:** claude-kits' first run on a five-language repository. The setup itself went through. Running the
commands it was about to write down showed that Google's code failed five of its own checks, which their CI never
ran. Those failures became a 31-line prefactor PR, and nine gaps in the skill became feedback for claude-kits.

## What it's for

Stages 1–2b only read and ran the shop. From Stage 4 on, Claude changes it: tickets, test-first builds, reviewers, a
human review, a merge. Each step needs to know how to compile, test and lint *this* repo, and `main` needs a gate a
change can't slip past. Online Boutique makes that hard on purpose: Go, C#, Java, Node and Python, built five
different ways, with Google's CI switched off because it needs Google Cloud.

## What we typed

```text
/pipeline:setup-project
yes. I will also like to keep recording and retro the work so that if we have issues we add them to the original
`claude-kits` because we are dealing with new stuff here
sorry wont the setup-project protect main add verify, human review and other things ?
OK
```

Then one choice from a menu: fix the failing code in a separate prefactor PR first.

## What Claude did

1. **Looked before asking.** It found five stacks and no Spring Boot, so the pack is `none`. Google's nine workflows
   were all `disabled_manually`, and Actions allows GitHub-owned actions only. The repo is public, so rulesets are
   free, and `gh` is 2.103.
2. **Asked five questions in one round,** each with a recommendation; "yes" took them all. Pack `none` with a section
   per language in `CODING_STANDARDS.md`, build mode `deliver`, one domain context, a 400-line budget, and a new
   `ci.yml` instead of Google's path-filtered one.
3. **Explained the order when asked.** `protect` can only require checks whose workflows are already on `main`, so it
   runs after the setup is merged. It also suggested one `verify` gate job, so the ruleset needs two checks, not ten.
4. **Ran every command before writing it down.** That's where the surprises were (see below). Nothing went into the
   stack card without running once, and C# ran in the .NET SDK container, at a 1.5 GB limit, because of the Apple
   silicon problem.
5. **Split the fixes off** into [PR #6](https://github.com/myhts/claude-kits-boutique/pull/6), 31 changed lines
   with no behaviour change, and filed the one real refactor as
   [issue #7](https://github.com/myhts/claude-kits-boutique/issues/7).
6. **Wrote the setup** on a branch stacked on the prefactor:

   ```text
   CLAUDE.md                          pointers: tracker, labels, domain docs, the pipeline's path by size
   CODING_STANDARDS.md                template rules + the gRPC boundary + one short section per language
   docs/agents/stack.md               pack none, services table, commands per language, deliver, 400 lines
   docs/agents/issue-tracker.md       GitHub Issues; never file into GoogleCloudPlatform/microservices-demo
   docs/agents/domain.md              single context
   .claude/settings.json              kits marketplace + pipeline@kits, project scope
   .github/workflows/ci.yml           go ×4, dotnet, java, node ×2, python, and the verify gate
   .github/workflows/pr-size.yml      template, plus protobuf output in the skip list
   .github/workflows/human-review.yml template, unchanged
   labels                             ready-for-agent, size/large, wayfinder:map|grilling|research|prototype|task
   ```

## What it found

The setup asks for "the fast ones once (compile or typecheck, one test file)". Running the *full* checks found what
the fast ones would have missed:

| Check | Before | Why nobody saw it |
|---|---|---|
| `go test ./...` in checkoutservice | **build failed**: `status.Errorf` with a non-constant format string | Google's CI tested only shipping, catalog and `frontend/validator` |
| `gofmt -l` | 3 files unformatted (frontend ×2, shipping) | no format check in their CI |
| `gradlew build` (adservice) | **failed** in `verifyGoogleJavaFormat`: the formatter can't reach javac internals on JDK 16+ | the Dockerfile runs `installDist`, which skips `check` |
| google-java-format | 2 files off-format, once the tool could run | same |
| `go vet ./...` | "copies lock value" ×9: protobuf `Money` passed by value | `go test` runs only a subset of vet |

The first four are fixed in PR #6. The last is a real refactor (the `money` helpers take `*pb.Money` instead), so CI
runs `go vet -copylocks=false` until issue #7 is done.

## What we decided

- **Pack `none`, one section per language.** No pack fits, so the review checklist lives in `CODING_STANDARDS.md`:
  deadlines on every gRPC call, meaningful status codes, `Money` never a float, plus a few lines per language.
- **`deliver` by default.** Stage 4 exists to show the implementer and the review loop end to end.
- **A new `ci.yml`, Google's left off.** `ci-pr.yaml` filters by `paths-ignore`, so it can never be a required
  check, and it tests a fraction of the code.
- **One `verify` gate.** It needs every other job, runs `if: always()`, and fails unless they all succeeded. The
  ruleset requires `verify` + `human-review`; the per-language checks are listed under "Checks not required" in the
  stack card so `/next` doesn't ask for them.
- **Prefactor first.** The setup PR writes no application code, and its CI is green on its first run.
- **Java on JDK 25 in CI.** That's what the Dockerfile ships. `build.gradle` targets 21, and 21 is what ran locally;
  the PR's CI is the first JDK 25 run.

## Evidence

- Every command in [`docs/agents/stack.md`](../agents/stack.md) ran once on this machine (C# in the SDK container),
  before and after the prefactor. The PR bodies carry the before/after output.
- `pr-size`'s skip list was tested against real paths: `genproto/demo.pb.go`, `demo_pb2.py`, `demo_pb2_grpc.py` and
  `package-lock.json` skipped; `handlers.go` and `email_server.py` counted.
- CI on the setup PR ([PR #8](https://github.com/myhts/claude-kits-boutique/pull/8), first run): all 11 checks
  green in about 1½ minutes. `setup-go` read Go 1.27.1 from the `toolchain` line, and `java (adservice)` built and
  format-checked on Temurin 25.0.5, the first JDK 25 run.

  ```text
  go (checkoutservice)        pass  44s     java (adservice)       pass  38s
  go (frontend)               pass  1m2s    node (currencyservice) pass  22s
  go (productcatalogservice)  pass  1m0s    node (paymentservice)  pass  20s
  go (shippingservice)        pass  1m0s    python (all services)  pass   7s
  dotnet (cartservice)        pass  27s     verify                 pass   2s
  size                        pass   5s     → labelled size/large: 739 lines, over 400
  ```

- `pr-size` labelled the PR and asked for a split or a reason. The reason went in a reply: no application code, and
  the files only work together.
- **Not yet shown:** `verify` failing when a job fails, and `human-review`, which can't run until it's on `main`.
  Stage 4's first PR exercises both.

## What it cost

From `/pipeline:setup-project` to this page took about 2½ hours of wall time (most of it waiting on answers, toolchain
downloads and CI) and came to **$3.92 at list price**: 63 calls, all on Opus 5.5, no subagents. Priced with Stage
2b's [`run-cost.mjs`](evidence/stage-2b/run-cost.mjs).

| Who | Model | Calls | List price |
|---|---|---|---|
| The main session: exploring, every command run, the prefactor, the setup, both PRs, this page | Opus 5.5 | 63 | $3.92 |

It ran on a Claude Max plan, so nothing extra was billed.

## What didn't work, and the fix

- **C# wouldn't build on this Mac.** `Grpc.Tools` 2.83 ships only an Intel `protoc` for macOS, and there's no
  Rosetta. Ran it in `mcr.microsoft.com/dotnet/sdk:10.0` instead; the stack card has the command.
- **The JDK 25 check couldn't run locally.** The Temurin 25 container couldn't download Gradle: DNS returned IPv6 the
  OrbStack VM can't reach, and with IPv4 forced, the redirect to GitHub failed. The PR's CI runs it instead.
- **The merge guard blocked a scoped undo.** To measure the Java formatter's diff, Claude ran it and then
  `git checkout -- .` inside `src/adservice`. The guard read it as "discard all local changes" and stopped the whole
  command before anything ran. It measured on a copy in the scratchpad instead.
- **`gradlew` isn't executable in git.** Google's Dockerfile `chmod`s it, so the commands say `sh gradlew`.

## Feedback for claude-kits

Each one is a gap in `pipeline@kits` 0.5.3 that this repository hit, with the fix it suggests. None has been filed
on `myhts/claude-kits` yet.

1. **Polyglot repos don't fit the stack card.** The skill says "more than one stack → ask which one", but when every
   stack maps to `none` the question is moot. The card also has one cell per purpose. *Fix:* when no stack has a
   pack, choose `none` without asking, and give the template a **Services** table (language, services, what pins the
   toolchain) and commands per language.
2. **"If there is no CI yet" misses CI that exists but can't gate.** Here the CI was disabled, path-filtered and tested
   a subset. *Fix:* step 1 reads the workflows' state (`gh api repos/<r>/actions/workflows`) and asks of each PR
   workflow: does it run, would a filter skip it, and does it cover every service? If not, write `ci.yml`.
3. **Step 1 doesn't check Actions permissions.** With `allowed_actions: selected`, a template using a third-party
   action fails on its first run. *Fix:* add `gh api repos/<r>/actions/permissions` to step 1, and keep the
   templates GitHub-owned.
4. **Running only the fast commands hides a red baseline.** The full verify failed on code nobody touched. *Fix:*
   step 3 runs the full verify once too. When existing code fails, offer a prefactor PR before the setup PR, and an
   issue for anything bigger than mechanical.
5. **`pr-size` counts generated gRPC code.** One `demo.proto` change regenerates code in eleven services. *Fix:* add
   `(^|/)genproto/`, `_pb2(_grpc)?\.py$` and `\.pb\.go$` to the template's `SKIP`.
6. **Ten required checks, kept in sync by hand.** Step 5 makes every PR job required, so matrix jobs become one check
   each and a new service means a ruleset change. *Fix:* the no-pack `ci.yml` shape ends with a `verify` gate
   (`needs:` all, `if: always()`, fail unless every result is `success`), and step 5 requires just that.
7. **"Checks not required" is the wrong place for gated checks.** Listing nine checks as "not required" reads as
   "these may fail", when the gate requires them. *Fix:* a stack card line **Required through:** `verify`, which step
   5 and `/next` read.
8. **The merge guard can't tell a scoped undo from a repo-wide one.** `git checkout -- .` run in a subfolder is
   blocked as "discarding all local changes". *Fix:* resolve the pathspec against the working directory, and block
   only when it covers the repo root or the change isn't Claude's own.
9. **An existing, uncommitted `.claude/settings.json`.** The plugin commands reported "already installed" and
   rewrote the file, dropping `"ref": "main"`. Harmless here, but the skill never mentions that the file must be
   committed for collaborators to get the plugins. *Fix:* step 4 lists `.claude/settings.json` among the files to
   commit.

## Next

Merge [PR #6](https://github.com/myhts/claude-kits-boutique/pull/6), then the setup PR, then run
`/pipeline:setup-project protect` to require `verify` + `human-review` on `main`.
