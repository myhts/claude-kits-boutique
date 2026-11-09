# Draft map and flow list

Phase 1 draft for the project explorer. **Traced from code, not run**: per this run's instructions nothing was
started, built or containerised. Every box, arrow and flow cites the line it comes from; the full fact sheets are
in [`survey.json`](survey.json).

## Phase 0 notes

- **Confidential data:** none found. No `.env`, key, credential, `.sql` or `.csv` files are tracked. The catalog
  (`products.json`), currencies and ads are demo data.
- **External/paid APIs:** `shoppingassistantservice` calls the Gemini API and Google Secret Manager, and
  cartservice/productcatalogservice can use AlloyDB/Spanner. All of these are optional cloud components. Any flow
  through them uses invented inputs only and stays plan-only unless the user provides their own project.
- **Shared infra:** the repo has Kubernetes, Kustomize, Helm and Terraform configs (GKE). No cluster was touched.
  Labs would run only on a local cluster or local processes.
- **Tools:** Node v22.23.2 (OK). Chrome and Docker weren't checked, because this run doesn't start anything.
- **UI shell:** the frontend is server-rendered Go `html/template` with no React/Next/Vue/Svelte app, so the only
  option is a **standalone HTML** page.

## Map: lanes and boxes

| Lane | Box | Language | Source |
|---|---|---|---|
| client | Browser (shopper) | – | – |
| client | loadgenerator (Locust) | Python | `src/loadgenerator/locustfile.py:35` |
| edge | frontend (HTTP, session cookie) | Go | `src/frontend/main.go:149` |
| services | checkoutservice | Go | `src/checkoutservice/main.go:230` |
| services | cartservice | C# | `src/cartservice/src/services/CartService.cs:34` |
| services | productcatalogservice | Go | `src/productcatalogservice/product_catalog.go:41` |
| services | currencyservice | Node.js | `src/currencyservice/server.js:138` |
| services | recommendationservice | Python | `src/recommendationservice/recommendation_server.py:70` |
| services | shippingservice | Go | `src/shippingservice/main.go:119` |
| services | paymentservice | Node.js | `src/paymentservice/server.js:41` |
| services | emailservice (dummy mode) | Python | `src/emailservice/email_server.py:109` |
| services | adservice | Java | `src/adservice/src/main/java/hipstershop/AdService.java:94` |
| services | shoppingassistantservice *(optional)* | Python | `src/shoppingassistantservice/shoppingassistantservice.py:65` |
| async | *(empty: every call is synchronous gRPC/HTTP; no queue or broker exists)* | | |
| data | Redis `redis-cart` | – | `src/cartservice/src/Startup.cs:35`, `kubernetes-manifests/cartservice.yaml:51` |
| data | Spanner / AlloyDB cart *(optional)* | – | `src/cartservice/src/Startup.cs:44`, `:49` |
| data | products.json | – | `src/productcatalogservice/catalog_loader.go:47` |
| data | AlloyDB catalog *(optional)* | – | `src/productcatalogservice/catalog_loader.go:37` |
| data | currency_conversion.json | – | `src/currencyservice/server.js:110` |
| data | ads map (in memory) | – | `src/adservice/src/main/java/hipstershop/AdService.java:121` |
| data | AlloyDB vector store *(optional)* | – | `src/shoppingassistantservice/shoppingassistantservice.py:91` |
| external | Gemini API *(optional)* | – | `src/shoppingassistantservice/shoppingassistantservice.py:82` |
| external | Secret Manager *(optional)* | – | `src/shoppingassistantservice/shoppingassistantservice.py:38` |
| external | packaging service *(optional, not deployed here)* | – | `src/frontend/packaging_info.go:54` |

There are 24 boxes. The 5 optional ones can be folded into one "optional cloud" group if the page gets crowded.

```
 client    [Browser]                    [loadgenerator]
               \                          /  HTTP
 edge            ───────► [frontend] ◄───
                     │ gRPC (fan-out)                 │ HTTP          │ HTTP (opt)
 services  [checkout] [cart] [catalog] [currency] [recommend] [shipping] [ad] [assistant] [packaging]
             │  gRPC → cart, catalog, currency, shipping, payment, email
             │               [payment]  [email]
           recommend ─gRPC─► catalog
 data      [redis-cart] [products.json] [currency json] [ads map] [AlloyDB vec]
 external                                                    [Gemini] [Secret Mgr]
```

## Arrows

| From | To | How | What | Ref |
|---|---|---|---|---|
| loadgenerator | frontend | HTTP | `/`, `/setCurrency`, `/product/{id}`, `/cart`, `/cart/empty`, `/cart/checkout`, `/logout` | `src/loadgenerator/locustfile.py:35` |
| Browser | frontend | HTTP | all routes | `src/frontend/main.go:150-163` |
| frontend | currencyservice | gRPC | GetSupportedCurrencies | `src/frontend/rpc.go:31` |
| frontend | currencyservice | gRPC | Convert | `src/frontend/rpc.go:81` |
| frontend | productcatalogservice | gRPC | ListProducts | `src/frontend/rpc.go:46` |
| frontend | productcatalogservice | gRPC | GetProduct | `src/frontend/rpc.go:52` |
| frontend | cartservice | gRPC | GetCart / EmptyCart / AddItem | `src/frontend/rpc.go:58`, `:63`, `:68` |
| frontend | shippingservice | gRPC | GetQuote | `src/frontend/rpc.go:88` |
| frontend | recommendationservice | gRPC | ListRecommendations | `src/frontend/rpc.go:100` |
| frontend | adservice | gRPC | GetAds | `src/frontend/rpc.go:123` |
| frontend | checkoutservice | gRPC | PlaceOrder | `src/frontend/handlers.go:354` |
| frontend | shoppingassistantservice | HTTP | POST / (proxy of `/bot`) | `src/frontend/handlers.go:472` |
| frontend | packaging service | HTTP | GET packaging info (only if `PACKAGING_SERVICE_URL` set) | `src/frontend/packaging_info.go:54` |
| checkoutservice | cartservice | gRPC | GetCart, EmptyCart | `src/checkoutservice/main.go:325`, `:333` |
| checkoutservice | productcatalogservice | gRPC | GetProduct (per item) | `src/checkoutservice/main.go:344` |
| checkoutservice | shippingservice | gRPC | GetQuote, ShipOrder | `src/checkoutservice/main.go:314`, `:387` |
| checkoutservice | currencyservice | gRPC | Convert | `src/checkoutservice/main.go:360` |
| checkoutservice | paymentservice | gRPC | Charge | `src/checkoutservice/main.go:370` |
| checkoutservice | emailservice | gRPC | SendOrderConfirmation | `src/checkoutservice/main.go:380` |
| recommendationservice | productcatalogservice | gRPC | ListProducts | `src/recommendationservice/recommendation_server.py:73` |
| cartservice | redis-cart | Redis (IDistributedCache) | get/set cart by userId | `src/cartservice/src/cartstore/RedisCartStore.cs:40`, `:60` |
| productcatalogservice | products.json | file read at load | catalog | `src/productcatalogservice/catalog_loader.go:47` |
| currencyservice | currency_conversion.json | `require` | rates | `src/currencyservice/server.js:110` |
| shoppingassistantservice | Gemini API | SDK | vision + design prompts | `src/shoppingassistantservice/shoppingassistantservice.py:82`, `:108` |
| shoppingassistantservice | AlloyDB vector store | SDK | similarity search | `src/shoppingassistantservice/shoppingassistantservice.py:91` |
| shoppingassistantservice | Secret Manager | SDK | DB password at startup | `src/shoppingassistantservice/shoppingassistantservice.py:38` |

## Flow list (simplest first)

All flows are **traced from code, not run**.

### Happy paths

| # | Flow | Path through the system | Start at |
|---|---|---|---|
| 1 | **Change currency** | frontend only: sets a cookie, no backend call | `src/frontend/handlers.go:499` |
| 2 | **Product metadata** `GET /product-meta/{id}` | frontend → catalog.GetProduct | `src/frontend/handlers.go:430` |
| 3 | **Add to cart** `POST /cart` | frontend → catalog.GetProduct → cart.AddItem → Redis | `src/frontend/handlers.go:211` |
| 4 | **Home page** `GET /` | frontend → currency.GetSupportedCurrencies, catalog.ListProducts, cart.GetCart, currency.Convert ×N, ad.GetAds | `src/frontend/handlers.go:59` |
| 5 | **Product page** `GET /product/{id}` | + recommendation → catalog.ListProducts (a second hop); optional packaging HTTP | `src/frontend/handlers.go:144` |
| 6 | **View cart** `GET /cart` | + shipping.GetQuote, GetProduct and Convert per cart item | `src/frontend/handlers.go:251` |
| 7 | **Place order** `POST /cart/checkout` | frontend → checkout.PlaceOrder → cart.GetCart → catalog.GetProduct + currency.Convert per item → shipping.GetQuote → currency.Convert → payment.Charge → shipping.ShipOrder → cart.EmptyCart → email.SendOrderConfirmation | `src/checkoutservice/main.go:230` |
| 8 | **Shopping assistant** `POST /bot` *(optional, needs GCP)* | frontend → assistant → Gemini (vision) → AlloyDB vector search → Gemini (answer) | `src/shoppingassistantservice/shoppingassistantservice.py:66` |

### Failure paths

| # | Flow | What the code does | Ref |
|---|---|---|---|
| 9 | **Card rejected** (invalid number, a type that isn't Visa/Mastercard, or expired) | payment throws, checkout returns `Internal: failed to charge card`, frontend renders an error page | `src/paymentservice/charge.js:70`, `:74`, `:80`; `src/checkoutservice/main.go:253` |
| 10 | **Shipping fails after payment** | the card is already charged (`:252`) when ShipOrder fails (`:258`). Checkout returns `Unavailable` and there's no refund or compensation step. **Candidate bug to report** | `src/checkoutservice/main.go:252-261` |
| 11 | **Errors that are swallowed** | EmptyCart errors are discarded (`_ =`), and email failure is only logged, so the order still succeeds | `src/checkoutservice/main.go:263`, `:273-274` |
| 12 | **Cart store down** (Redis unreachable) | GetCart fails, so the home, cart and checkout pages error. Worth tracing how far the error propagates | `src/cartservice/src/cartstore/RedisCartStore.cs:40` |
| 13 | **Slow catalog / timeouts** | `EXTRA_LATENCY` slows every catalog call. Checkout's Convert uses `context.TODO()`, so the caller's deadline isn't passed on | `src/productcatalogservice/server.go:88`; `src/checkoutservice/main.go:360` |
| 14 | **Retry / double submit of checkout** | there's no idempotency key in PlaceOrder: each call makes a new order uuid and charges again | `src/checkoutservice/main.go:233`, `:252` |

### Ops paths

| # | Flow | Ref |
|---|---|---|
| 15 | **cartservice startup: choosing a store** (Redis → Spanner → AlloyDB → in-memory fallback) | `src/cartservice/src/Startup.cs:33-56` |
| 16 | **Catalog load and SIGUSR1/SIGUSR2 reload toggle** | `src/productcatalogservice/catalog_loader.go:33`; `src/productcatalogservice/server.go:100-109` |
| 17 | **Session cookie creation and logout** (including `ENABLE_SINGLE_SHARED_SESSION`) | `src/frontend/middleware.go:85-97`; `src/frontend/handlers.go:418` |

**Recommended for gate 1 (not asked in this run):** 1, 3, 4, 7, 9, 10, 12, 15. Together they cover a single-service
path, a store write, a fan-out read, the full checkout saga, two failure modes and a startup decision.

## Open questions for gate 1

- Include the optional cloud parts (shopping assistant, AlloyDB, Spanner), or skip them? They need a GCP project and
  paid APIs.
- Flows 10 and 14 look like real gaps (no compensation after a charge, no idempotency). Report them as findings only,
  per the rules.
