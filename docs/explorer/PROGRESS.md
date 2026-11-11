# Explorer progress

`/pipeline:project-explorer` on Online Boutique, 2026-11-11. Main session on Opus 5.5; survey readers on Sonnet.

**The brief (Stage 2):** run only currency, payment and ads, from Google's v0.10.7 images with plain Docker and the memory limits
from `kubernetes-manifests/` (ads with `DISABLE_STATS=1 DISABLE_TRACING=1`); trace browse, cart and checkout from the code.

**The brief (Stage 2b, same day):** run the whole shop (all 11 services and Redis; the load generator briefly) from the
same images, each at its manifest memory limit, inside the 4 GB VM. Replace "traced from code" with real data in flows
4–13, show the Node and Java breakpoints hit from real clicks, try the traced findings for real. No Go, C# or Python
debuggers (a later "Stage B", if wanted).

## Phases

- [x] 0 Safety and setup
- [x] 1 Survey, gate 1
- [x] 2 Debuggers (run-time overrides approved at gate 1)
- [x] 3 Flows: 13 flows, 71 steps
- [x] 4 Pathways: TOUR.md (by hand), FLOWS.md (generated)
- [x] 5 Concepts, gate 3
- [x] 6 Ladders and labs: 5 concepts, 15 levels; labs for 3; LABS.md (generated); MEASURED.md M1–M8
- [x] 7 Verified and handed over (Stage 2): `validate-data.mjs` 0 errors (10 warnings, below); `check-explorer.mjs` 257 views
  clean in light and dark; everything we started is stopped

**To rebuild after a data change:** validate, `gen-guides.mjs`, bundle, check (commands at the top of
`src/explorer-data.js`).

## Constraints

- **Machine:** M1 Pro, 16 GB, shared with browser and editors. Docker is OrbStack, VM capped at 4 GB: don't raise it
  without asking. Every container gets `--memory` = `--memory-swap`.
- **Images are amd64** and run under Rosetta on this arm64 Mac. Every timing is under emulation.
- **Ports:** all on 127.0.0.1. macOS holds 7000 (AirPlay) and 5000, so currency is on host port **7001**. Debug
  ports: currency 9229, payment 9230, ads JDWP 5005.
- **Not ours, leave alone:** a `java` process (127.0.0.1:64996, 65001), `mongod` on 27017, the gcloud config in
  `~/.config/gcloud`. No kube context is set.
- **Ours:** `bx-currency`, `bx-payment`, `bx-ads`, and since Stage 2b `bx-frontend`, `bx-checkout`, `bx-cart`,
  `bx-catalog`, `bx-shipping`, `bx-rec`, `bx-email`, `bx-redis` (and `bx-loadgen` while measuring), network
  `bx-boutique`, and throwaway `--rm` driver containers. `docs/explorer/run-services.sh down` removes them.
- **Whole shop memory:** 2030 MiB of limits (2542 with the load generator), about 650 MiB used at idle. Only the
  frontend is published besides the three services: `127.0.0.1:8080`.
- **Data:** no secrets or data dumps in the repo. Card numbers are public test numbers (4432-8015-6152-0454 is the
  frontend form's default with dashes; 378282246310005 is a public Amex test number).
- **Files:** everything is under `docs/explorer/`, plus `.vscode/launch.json` (`.vscode/` is gitignored). Google's code,
  images and manifests are unchanged.

## Decisions

- **Gate 1:** all four flow groups; standalone HTML only (the frontend is server-rendered Go templates); folder
  `docs/explorer/`; debugging by overriding the container command at run time, no image or Dockerfile changes.
- **Gate 3:** ladder pages for Deadlines, Money as integers, Chatty pages, Charge-then-ship, plus Lost cart updates,
  marked as outside the Node and Java services the implementation stages concentrate on. Labs where they fit
  (Deadlines, Money, Chatty pages); Charge-then-ship and the cart are pages only. Existing seams only (pause, restart,
  CPU limit at run time; no switches, no image changes). Scale target 10× today. Load on this laptop only.
- Source matches the images: `git diff 38e7348e HEAD -- src/{currency,payment,ad}service protos` is empty.
- Survey: 9 Sonnet readers. `survey.json` covers all 15 rpcs of `protos/demo.proto` and all 12 `*_ADDR` values of
  the manifests; 97 refs checked to land on code lines; one reader ref was off by one and was corrected.
- No grpcurl here: `drive.js` runs in a throwaway container from the currency image, which has the gRPC libraries.
  `lab-kit.mjs` speaks HTTP only, so the gRPC labs are `lab-*` scenarios in `drive.js`.
- Labs measure with no debugger attached (`run-services.sh restart …`), and at the manifest's CPU limit where the
  question is about capacity or warm-up (`CPUS=0.2` / `0.3`).

## Memory (docker stats --no-stream)

| Container | Limit (manifest) | Idle after start | Highest seen |
|---|---|---|---|
| bx-currency | 128 MiB | 73 MiB | 85 MiB after the 10 s floods |
| bx-payment | 128 MiB | 70 MiB | |
| bx-ads | 300 MiB | 131 MiB | 179 MiB after 120 calls |

No container hit its limit.

## Verified breakpoints

Verified by `tools/verify-bp-node.mjs` (CDP) and `tools/verify-bp-jdb.mjs` (jdb), each during a real request sent by
`run-services.sh drive`, 2026-11-11. The VS Code attach configs use the same ports and path mapping, but weren't
clicked through in the VS Code UI.

| Line | Hit during | Notes |
|---|---|---|
| src/currencyservice/server.js:131 | currencies | 33 codes |
| src/currencyservice/server.js:141 | convert, convert-ars-item | |
| src/currencyservice/server.js:145 | convert, convert-ars-item | line 146 is not a break location: V8 moves it to 150 |
| src/currencyservice/server.js:119 | convert (×2 per call) | `_carry` |
| src/currencyservice/server.js:153 | convert | |
| src/currencyservice/server.js:158 | convert, convert-ars-item | ARS: `NaN NaN` |
| src/currencyservice/server.js:163 | convert, convert-ars-item | |
| src/currencyservice/server.js:166 | **never**, even for ARS | the catch doesn't see NaN |
| src/paymentservice/server.js:43 | all four charges | |
| src/paymentservice/charge.js:70 | all four | |
| src/paymentservice/charge.js:74 | three (not the invalid number) | |
| src/paymentservice/charge.js:80 | two (good, expired) | |
| src/paymentservice/charge.js:85 | good card | |
| src/paymentservice/server.js:45 | good card | |
| src/paymentservice/server.js:48 | expired, amex, invalid | `code: 400` |
| AdService.java:99 `hipstershop.AdService$AdServiceImpl` | 3 calls | nested class |
| AdService.java:101 `$AdServiceImpl` | clothing, unknown key | |
| AdService.java:124 `hipstershop.AdService` | clothing, unknown key | |
| AdService.java:105 `$AdServiceImpl` | empty keys | |
| AdService.java:107 `$AdServiceImpl` | 3 calls | sizes 1, 2, 0 |
| AdService.java:130 `hipstershop.AdService` | empty keys, unknown key | |
| AdService.java:112 `$AdServiceImpl` | 3 calls | |

**Stage 2b, from real clicks:** with `run-services.sh shop debug`, the same lines were verified again with the
trigger being real requests through the frontend (`shop-session.sh order`, `amex`, `ars`) instead of `drive.js`:

| Lines | Hits during the shop sessions |
|---|---|
| currency `server.js:131` · `141` · `145` · `158` · `163` | 8 · 38 · 38 · 38 · 38 (`145` read `undefined` for ARS) |
| currency `server.js:166` | **never**, ARS included |
| payment `server.js:43` · `45` · `48` | 3 (EUR 49.500221142, USD 27.98 Amex, ARS 0) · 2 · 1 (`400`) |
| payment `charge.js:70` · `74` · `80` · `85` | 3 · 3 (visa, amex, visa) · 2 · 2 (EUR 49.500221142, ARS 0) |
| ads `$AdServiceImpl:99` · `101` · `105` · `107` · `112`, `AdService:124` · `130` | 2 · 2 · 1 · 2 · 2, 2 · 1 |

Pausing ads at those breakpoints made the frontend's 100 ms deadline pass: the product page from that run has no ad.

No breakpoints in the Go, C# and Python services: they run from Google's release images, which have no debugger.
Their steps show real logs, replies and Redis contents instead. Catalog logs nothing per request, so its data comes
from `drive shop-*` with the same request. The cart concept's levels still have no breakpoint (a validator warning).

## Bugs and mismatches found (reported, not fixed)

1. **An order can cost 0.** Currency returns 0 with status OK for a code not in its rate table (run, M8: USD 19.99 →
   ARS gives `units 0, nanos 0`; NaN inside, encoded as 0; the catch at `server.js:166` never runs). Payment charges
   ARS 0 (run). Frontend half traced: `/setCurrency` accepts any ISO 4217 code (`validator.go:56`) and
   `currentCurrency()` never re-checks the cookie (`handlers.go:573`). **Repro (frontend part not run):**
   `curl -X POST -d currency_code=ARS localhost:<frontend>/setCurrency`, then place an order.
2. **Payment logs the full card number and CVV** (`server.js:43`). Repro: `run-services.sh drive charge`, then
   `docker logs bx-payment | grep Charge`.
3. **Payment's card errors carry gRPC status 400**, which isn't a gRPC code (INVALID_ARGUMENT is 3). Repro:
   `drive charge-amex` shows `"code":400` with no status name. Through checkout, a card the shop won't take becomes
   `Internal`, then HTTP 500 (traced).
4. **Ads' cold start against the frontend's 100 ms** (M1, M3). Without a probe the first GetAds takes ~650 ms and the
   product page drops the ad. A readiness-style health check absorbs that (then 28–35 ms). At the manifest's 300m
   CPU, though, ads takes 16–17 s to listen, its first health check 2.9–3.7 s (past Kubernetes' default 1 s probe
   timeout; the manifest sets none), and the first GetAds after it 276–377 ms. All under Rosetta; not tested on a
   cluster or native amd64.
5. **Charges have sub-cent amounts:** 45 of 54 converted prices have digits below the cent (M7), and a EUR cart was
   charged 49.500221142 (run). The page truncates (`renderMoney`, `handlers.go:608`), so page and charge differ.
6. **No idempotency on Charge:** the same request twice gave two transaction ids (M8).
7. **Only one per-call deadline in the shop** (frontend → ads, 100 ms). Checkout's `Convert` uses `context.TODO()`
   (`main.go:360`): with currency frozen, a no-deadline call waited as long as the freeze, once over 3 minutes (M4).
8. Traced only:
   - Checkout charges before shipping and doesn't refund if `ShipOrder` fails (`main.go:252-261`); payment has no
     refund RPC.
   - `EmptyCart` errors are ignored (`main.go:263`).
   - Cart's Redis store is read-modify-write with no lock (`RedisCartStore.cs:40-60`).
   - The home page fetches an ad that `home.html` never renders (`handlers.go:116`; only `product.html:81` shows
     one).
   - `avoidNoopCurrencyConversionRPC` is false (`rpc.go:27`), so USD → USD conversions still go over the network.

## Corrections made along the way

- Flow 5 first said €16.80; `renderMoney` truncates, so the page shows €16.79.
- Flow 4 first said the home page shows an ad; it doesn't render one.
- Finding 4 first said "the first ad after a start is dropped"; M3 showed a probe absorbs it, except at the CPU limit.

## What the engine could use (not changed: it's the skill's)

- A step field for a **code reference that isn't a verified breakpoint** (`ref`), so traced steps get a clickable
  link instead of `file:line` in the text.
- The map has a fixed minimum width of 1050 px, wider than the panel at 1440 px; this map was laid out to fit.
- Concept scenes: a box at column 4 runs past the 1000 px scene (16 + 4 × 210 + 180 = 1036), and
  `check-explorer.mjs` didn't flag it. The docs say columns 0–4 fit.
- The validator warns on every proposed level that links to code, even where the link shows where the change
  would go ("not built" in the text). 9 of the 10 warnings are this.

## Left behind

- The images: since Stage 2b all eleven `us-central1-docker.pkg.dev/online-boutique-ci/microservices-demo/*:v0.10.7`
  plus `loadgenerator:v0.10.7` and `redis:alpine` (about 1.9 GB). Remove with `docker rmi` if the space is wanted.
- `.vscode/launch.json` (gitignored).
- Nothing else: containers and network removed with `run-services.sh down`.

## After the hand-over (2026-11-11)

- **Stage 2 write-up** written: `docs/claude-kits/02-the-architecture.md`, screenshots and the cost run in
  `docs/claude-kits/evidence/stage-2/`, linked from `docs/claude-kits/README.md`. Google's root README untouched.
- **Cost of the run:** $12.49 at list price (Opus 5.5 main session $11.62, 113 calls; Sonnet 5.5 readers $0.87,
  33 calls), 59 minutes, cut at the first message after the hand-over. Script and output in the evidence folder.
- **GitHub Pages** switched on for this repo: branch `main`, folder `/docs`. The explorer will be at
  https://myhts.github.io/claude-kits-boutique/explorer/explorer.html once `docs/explorer/` is on `main`.
- Lab configs reworded after a look at the screenshots: the engine already prefixes "No special config:" and shows
  backticks literally.

## Stage 2b: the whole shop (2026-11-11)

- [x] 0 Safety: no other containers, ports 8080 and the rest free, 480 GB disk. 8 more images pulled (7 services,
  `redis:alpine`), plus the load generator.
- [x] 1 Gate 1: re-capture flows 4–13 for real (all four groups); load generator briefly; add flows 14 (Change
  currency) and 15 (Empty cart). (The answer also ticked "keep the 13": read as keep them and add these two.)
- [x] 2 Debuggers: unchanged; `run-services.sh shop debug`. 20 of the 22 breakpoint lines re-verified from real clicks
  (all but currency `server.js:119` and `:153`, which only flow 1 uses); `:166` still never stops.
- [x] 3 Flows 4–13 rewritten with real data; 14 and 15 added (`src/data/flows-more.js`). 15 flows, 78 steps.
- [x] 4 TOUR.md: section 1b (the whole shop), flows 4–8 by clicking, 9–13 by `shop-session.sh`. FLOWS.md regenerated.
- [x] 6 Cart concept: lost update now `measured` (M9). MEASURED.md M9–M11.
- [x] 7 `validate-data.mjs` 0 errors (same 10 warnings); `check-explorer.mjs` 271 views clean; everything stopped.

New tools: `docs/explorer/shop-session.sh` (scenarios `order`, `amex`, `ars`, `no-ads`, `bad-product`, `ship-fails`,
`race`), `run-services.sh shop [debug]`, `drive shop-*`.

### Found in Stage 2b (reported, not fixed)

9. **The free order, end to end** (finding 1, now fully run): `/setCurrency` ARS → every price `$0.00` (the frontend
   falls back to `$` for unknown codes, `handlers.go:621`; Chrome's currency picker shows EUR) → order placed, charged
   `ARS0.0`, shipped, emailed, "Total Paid $0.00". Repro: `shop-session.sh ars`.
10. **Lost cart updates are the common case, not an edge case:** 17, 18 and 18 carts of 20 lost an item when two adds
    overlapped; both requests got 302 (M9). Repro: `shop-session.sh race`.
11. **Shipping down after the charge:** a 20.4 s wait (no deadline on `ShipOrder`), a 500, the cart kept, and the
    retry charged again: one order, two charges (M11). Repro: `shop-session.sh ship-fails`.
12. **Cart runs at its memory limit:** 97 MiB at start, 122–127 of 128 MiB once it has served traffic; under the
    manifest's 10-user load a single `docker exec` inside it got it OOM-killed (M10). Under Rosetta.
13. **Carts never expire:** every Redis entry has `absexp -1 sldexp -1`, while the session cookie lasts 48 h.
14. **A made-up product id gives a 500**, not a 404 (catalog says `NotFound`; the frontend renders 500).
15. **Emptying a cart drops its user id:** the empty cart is written without `user_id`, and items added later are
    stored without it.
16. **Recommendations: 5 fetched, 4 shown.** The frontend calls `GetProduct` for all 5 ids, then keeps 4
    (`rpc.go:114`).

### Corrections in Stage 2b

- Stage 2 called `4432-8015-6152-0454` "the frontend form's default with dashes". The form's default is
  `4432801561520454` (`cart.html:168`), and the frontend **rejects** the dashed form with 422. Payment, called
  directly by `drive.js`, accepts both.
- Stage 2's EUR total (49.500221142, added up by `drive.js` the way checkout does) was right: the real checkout charged
  exactly that.

## Next

- Commit `docs/explorer/` and the Stage 2b page on branch `claude-kits-test-2b`, and open a PR (ask first).
- The engine notes above as a PR to claude-kits, then link it from the Stage 2 page's last section.
- Stage B, if wanted: Go (Delve), C# and Python debuggers, which need images built from source.
