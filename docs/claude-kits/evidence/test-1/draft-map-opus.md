# Draft map and flow list (Phase 1, before gate 1)

Source: `docs/explorer/survey.json`, built from 12 read-only fact sheets, one per `src/` folder.
**Traced from code, not run.** No breakpoints are verified and no data was captured yet.

How it runs normally: `skaffold dev` / `skaffold run` on a local Kind or Minikube cluster (`docs/development-guide.md:89-114`).
The front end is Go `html/template` pages (no JS framework), so the explorer page can only be **standalone HTML**.

There is **no async lane**. Every hop is synchronous gRPC or HTTP request/response; the code has no queue, broker, topic
or worker. Everything that looks like "send later" (the order email, emptying the cart) is a blocking call inside
`PlaceOrder`.

## Map: boxes by lane

`[opt]` = only in an optional kustomize component or behind an env flag, not in the base `kubernetes-manifests/`.
22 boxes in total, 4 of them optional.

### Lane 1: Client

| Box | Sub | Module | Anchor |
|---|---|---|---|
| `browser` Shopper's browser | HTML pages + 2 cookies | client | `src/frontend/middleware.go:97` (session cookie) |
| `loadgen` loadgenerator | Locust, 6 weighted tasks | loadgenerator | `src/loadgenerator/locustfile.py:83` |

### Lane 2: Edge

| Box | Sub | Module | Anchor |
|---|---|---|---|
| `lb` frontend-external | LoadBalancer :80 | k8s | `kubernetes-manifests/frontend.yaml:126` |
| `frontend` frontend | Go HTTP, 14 routes, fan-out | frontend | `src/frontend/main.go:150` |

### Lane 3: Orchestrating services (call other services)

| Box | Sub | Module | Anchor |
|---|---|---|---|
| `checkout` checkoutservice | PlaceOrder, 8 downstream calls | checkoutservice | `src/checkoutservice/main.go:230` |
| `reco` recommendationservice | ListRecommendations | recommendationservice | `src/recommendationservice/recommendation_server.py:70` |
| `assistant` shoppingassistantservice `[opt]` | Flask POST /, RAG on Gemini | shoppingassistantservice | `src/shoppingassistantservice/shoppingassistantservice.py:65` |

### Lane 4: Leaf services (call nothing in-cluster)

| Box | Sub | Module | Anchor |
|---|---|---|---|
| `cart` cartservice | C#, Add/Get/EmptyCart | cartservice | `src/cartservice/src/services/CartService.cs:34` |
| `catalog` productcatalogservice | List/Get/SearchProducts | productcatalogservice | `src/productcatalogservice/product_catalog.go:41` |
| `currency` currencyservice | Node, Convert | currencyservice | `src/currencyservice/server.js:185` |
| `shipping` shippingservice | GetQuote 8.99 / ShipOrder | shippingservice | `src/shippingservice/main.go:119` |
| `payment` paymentservice | Charge: local card check | paymentservice | `src/paymentservice/server.js:91` |
| `email` emailservice | dummy: logs only | emailservice | `src/emailservice/email_server.py:109` |
| `ad` adservice | Java, GetAds | adservice | `src/adservice/src/main/java/hipstershop/AdService.java:94` |

### Lane 5: Data

| Box | Sub | Module | Anchor |
|---|---|---|---|
| `redis` redis-cart | redis:alpine, emptyDir | cartservice | `src/cartservice/src/cartstore/RedisCartStore.cs:40` |
| `productsjson` products.json + cache | in-memory, reload switch | productcatalogservice | `src/productcatalogservice/catalog_loader.go:47` |
| `ratesjson` currency_conversion.json | rates, read-only | currencyservice | `src/currencyservice/server.js:110` |
| `adsmem` ads (in memory) | 7 hardcoded ads | adservice | `src/adservice/src/main/java/hipstershop/AdService.java:121` |
| `alloydb` AlloyDB / Spanner `[opt]` | carts, catalog, vectors | gcp | `src/cartservice/src/Startup.cs:34` (store choice) |

### Lane 6: External

| Box | Sub | Module | Anchor |
|---|---|---|---|
| `gemini` Google Generative AI `[opt]` | gemini-1.5-flash + embeddings | gcp | `src/shoppingassistantservice/shoppingassistantservice.py:82` |
| `secrets` Secret Manager `[opt]` | AlloyDB password | gcp | `src/productcatalogservice/catalog_loader.go:76` |
| `gcpmeta` GCP metadata / OTel / Profiler | env-gated, off in base | gcp | `src/frontend/deployment_details.go:45` |

## Map: arrows

Solid = always in the base deployment. Dashed = optional or env-gated.

| Edge id | Label | Style | Ref |
|---|---|---|---|
| `browser>lb` | HTTP | solid | `kubernetes-manifests/frontend.yaml:126` |
| `lb>frontend` | :80 → :8080 | solid | `kubernetes-manifests/frontend.yaml:126` |
| `loadgen>frontend` | HTTP (frontend:80) | solid | `src/loadgenerator/locustfile.py:35` |
| `frontend>checkout` | PlaceOrder | solid | `src/frontend/handlers.go:355` |
| `frontend>reco` | ListRecommendations | solid | `src/frontend/rpc.go:100` |
| `frontend>assistant` | HTTP POST /bot → / | dashed | `src/frontend/handlers.go:472` |
| `frontend>cart` | Get/Add/EmptyCart | solid | `src/frontend/rpc.go:58` |
| `frontend>catalog` | List/GetProduct | solid | `src/frontend/rpc.go:47` |
| `frontend>currency` | Currencies, Convert | solid | `src/frontend/rpc.go:32` |
| `frontend>shipping` | GetQuote | solid | `src/frontend/rpc.go:88` |
| `frontend>ad` | GetAds (100 ms) | solid | `src/frontend/rpc.go:123` |
| `checkout>cart` | GetCart, EmptyCart | solid | `src/checkoutservice/main.go:325` |
| `checkout>catalog` | GetProduct ×items | solid | `src/checkoutservice/main.go:344` |
| `checkout>currency` | Convert (ctx.TODO) | solid | `src/checkoutservice/main.go:360` |
| `checkout>shipping` | GetQuote, ShipOrder | solid | `src/checkoutservice/main.go:315` |
| `checkout>payment` | Charge | solid | `src/checkoutservice/main.go:370` |
| `checkout>email` | SendOrderConfirmation | solid | `src/checkoutservice/main.go:380` |
| `reco>catalog` | ListProducts | solid | `src/recommendationservice/recommendation_server.py:73` |
| `cart>redis` | GET/SET userId | solid | `src/cartservice/src/cartstore/RedisCartStore.cs:40` |
| `cart>alloydb` | Spanner / AlloyDB | dashed | `src/cartservice/src/Startup.cs:34` |
| `catalog>productsjson` | load + reload | solid | `src/productcatalogservice/catalog_loader.go:47` |
| `catalog>alloydb` | SELECT products | dashed | `src/productcatalogservice/catalog_loader.go:133` |
| `currency>ratesjson` | require() | solid | `src/currencyservice/server.js:110` |
| `ad>adsmem` | lookup by category | solid | `src/adservice/src/main/java/hipstershop/AdService.java:121` |
| `assistant>alloydb` | similarity_search | dashed | `src/shoppingassistantservice/shoppingassistantservice.py:91` |
| `assistant>gemini` | invoke ×2 + embed | dashed | `src/shoppingassistantservice/shoppingassistantservice.py:82` |
| `assistant>secrets` | password at startup | dashed | `src/shoppingassistantservice/shoppingassistantservice.py:38` |
| `catalog>secrets` | password (AlloyDB path) | dashed | `src/productcatalogservice/catalog_loader.go:76` |
| `frontend>gcpmeta` | metadata DNS + HTTP | dashed | `src/frontend/handlers.go:100` |

Layout notes for Phase 3: `frontend` fans out to 8 boxes, so put it centred, with `checkout` and `reco` directly below
it and the leaf services spread under them. `checkout>*` and `frontend>*` both enter `cart`, `catalog`, `currency` and
`shipping`, so expect to need `fromX`/`toX` offsets. Tracing (OTel collector) and Cloud Profiler hang off almost every
service but are off in the base manifests; one `gcpmeta` box with a note keeps the map readable.

## Flow list (simplest first)

Each flow is traced from code. Breakpoints and data come in Phase 3, from a real run if one is approved.

### Happy paths

| # | Flow | Path | Entry |
|---|---|---|---|
| 1 | **Change currency** | browser → frontend: validates, writes `shop_currency` cookie, redirects. No downstream call | `src/frontend/handlers.go:499` |
| 2 | **Add to cart** | frontend validates → catalog `GetProduct` → cart `AddItem` → Redis SET under the session id | `src/frontend/handlers.go:211` |
| 3 | **View a product** | frontend → catalog `GetProduct`, currency `GetSupportedCurrencies` + `Convert`, cart `GetCart`, reco → catalog `ListProducts`, ad `GetAds` | `src/frontend/handlers.go:144` |
| 4 | **Home page** | frontend → currencies, `ListProducts`, `GetCart`, `Convert` per product, `GetAds`; plus the GCP metadata DNS lookup | `src/frontend/handlers.go:59` |
| 5 | **View cart** | frontend → `GetCart`, reco, `GetQuote`, `GetProduct` + `Convert` per item | `src/frontend/handlers.go:251` |
| 6 | **Place an order** (the main one) | frontend validates → checkout `PlaceOrder`: GetCart → GetProduct ×n → Convert → GetQuote → **Charge** → **ShipOrder** → EmptyCart → SendOrderConfirmation | `src/checkoutservice/main.go:230` |
| 7 | **Empty cart** | frontend → cart `EmptyCart` → Redis | `src/frontend/handlers.go:239` |
| 8 | **Log out** | frontend expires every cookie; the cart stays in Redis under the old session id | `src/frontend/handlers.go:418` |

### Failure paths

| # | Flow | What happens (from code) | Entry |
|---|---|---|---|
| 9 | **Bad form input** | the validator rejects the add-to-cart / checkout / currency payload → 422, nothing downstream is called | `src/frontend/handlers.go:220` |
| 10 | **Card rejected** | payment throws Invalid / Unaccepted (not VISA/MC) / Expired → checkout returns `Internal: failed to charge card` → frontend error page; the cart is kept | `src/paymentservice/charge.js:70` |
| 11 | **Shipping fails after the charge** | `ShipOrder` error after a successful `Charge` → `Unavailable`; there's no refund or compensation step, so the card stays charged | `src/checkoutservice/main.go:258` |
| 12 | **Email fails** | `SendOrderConfirmation` error is only logged; the order still succeeds | `src/checkoutservice/main.go:273` |
| 13 | **Ads slow or down** | `GetAds` has a 100 ms timeout; `chooseAd` logs "failed to retrieve ads" and the page renders without an ad | `src/frontend/handlers.go:527` |
| 14 | **Slow catalog** (existing switch) | `EXTRA_LATENCY` sleeps in every catalog RPC → home, product, cart, reco and checkout all slow down | `src/productcatalogservice/server.go:88` |
| 15 | **Redis down** | cart RPCs fail → frontend errors, yet cartservice's health check still says SERVING (`Ping()` is always true) | `src/cartservice/src/services/HealthCheckService.cs:33` |
| 16 | **Lost deadline** | checkout's `Convert` uses `context.TODO()`, so a cancelled or timed-out order keeps converting and the trace breaks there | `src/checkoutservice/main.go:360` |

### Reads and ops

| # | Flow | What happens | Entry |
|---|---|---|---|
| 17 | **Startup: choose a store** | cartservice picks Redis / Spanner / AlloyDB / in-memory from env; catalog picks JSON / AlloyDB | `src/cartservice/src/Startup.cs:34` |
| 18 | **Catalog reload per request** (existing switch) | SIGUSR1 turns on re-reading `products.json` on every request, SIGUSR2 turns it off (unsynchronised flag) | `src/productcatalogservice/server.go:100` |
| 19 | **Health probes** | k8s gRPC probes → the grpc-go health server (Go), custom Check (Node/Python/C#); `/_healthz` on the frontend | `src/frontend/main.go:161` |
| 20 | **Shopping assistant** `[opt, GCP only]` | `/assistant` page → POST /bot → assistant: Gemini describes the image → embeddings + AlloyDB vector search → Gemini recommends. Needs GCP and an API key, so plan-only by default | `src/frontend/handlers.go:451` |

**Suggested for gate 1** (top 6): 1, 2, 6, 10, 11, 13. That covers the simplest path, a single write, the full
orchestration, and three ways it breaks: a clean rejection, a partial failure with no compensation, and a degraded
dependency.

## Open questions for gate 1

- Flows to build (above). Is the optional GCP path (assistant, AlloyDB, Spanner) in scope, or plan-only?
- Page location: standalone HTML is the only option (no JS front end detected). Output folder: `docs/explorer/`?
- Running: may Phase 2/3 start a local Kind/Minikube cluster with `skaffold dev`? That needs Docker and a check that
  the kube context isn't shared.
- Which service matters most for depth: checkout (orchestration) or cart (state)?
