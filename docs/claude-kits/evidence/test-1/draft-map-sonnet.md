# Draft map and flow list

Source: `survey.json` (12 readers, one per `src/` folder), plus a spot-check of the cited lines in
`src/checkoutservice/main.go`, `src/frontend/handlers.go`, `src/recommendationservice/recommendation_server.py`,
`src/cartservice/src/cartstore/RedisCartStore.cs` and `src/emailservice/email_server.py`.
**Everything is traced from code, not run.** Nothing was built or started.

How it's normally run: Kubernetes (`kubectl apply -f ./release/kubernetes-manifests.yaml`, README.md:84), or
`skaffold.yaml` for local development. Every service-to-service call is synchronous: gRPC without TLS, except one
HTTP call from frontend to shoppingassistantservice. There is no broker, queue or worker, so the async and workers
lanes are empty.

## Map: boxes by lane (19 boxes)

```
 CLIENT     [ Browser ]                         [ loadgenerator ]
                 \  HTTP                         /  HTTP (Locust)
 EDGE                    [ frontend (Go) :8080, LoadBalancer ]
            ______________________|____________________________________________
           /       |        |         |          |          |        |         \
 SERVICES [ad]  [currency] [product  [cart]  [recommend-  [shipping] [checkout]  [shopping
          Java   Node      catalog]  C#      ation] Py     Go         Go          assistant] Py
                           Go                   |                     |  calls cart, product-
                                                └─► productcatalog    |  catalog, currency,
                                                                      |  shipping, payment, email
                                              [payment] Node   [email] Python (dummy mode)
 ASYNC      (none)
 WORKERS    (none)
 DATA      [ redis-cart ]  [ products.json ]  [ currency_conversion.json ]  [ AlloyDB (optional) ]
 EXTERNAL  [ Gemini / GenAI embeddings API ]  [ Google Secret Manager ]
```

| Lane | Box | What it is | Ref |
|---|---|---|---|
| client | Browser | the shopper | — |
| client | loadgenerator | Locust, headless, hits frontend | src/loadgenerator/Dockerfile:46 |
| edge | frontend | Go HTTP server, 13 routes, session cookie only | src/frontend/main.go:150 |
| services | checkoutservice | orchestrates PlaceOrder | src/checkoutservice/main.go:230 |
| services | cartservice | cart CRUD, store chosen at startup | src/cartservice/src/Startup.cs:34 |
| services | productcatalogservice | List/Get/Search products | src/productcatalogservice/product_catalog.go:41 |
| services | currencyservice | supported currencies, Convert | src/currencyservice/server.js:185 |
| services | recommendationservice | ListRecommendations | src/recommendationservice/recommendation_server.py:70 |
| services | shippingservice | GetQuote, ShipOrder (local only) | src/shippingservice/main.go:119 |
| services | paymentservice | Charge (local card validation) | src/paymentservice/server.js:89 |
| services | emailservice | SendOrderConfirmation (logs only) | src/emailservice/email_server.py:109 |
| services | adservice | GetAds from an in-memory map | src/adservice/src/main/java/hipstershop/AdService.java:94 |
| services | shoppingassistantservice | Flask POST /, RAG over the catalog | src/shoppingassistantservice/shoppingassistantservice.py:65 |
| data | redis-cart | Redis, the deployed cart store | src/cartservice/src/cartstore/RedisCartStore.cs:40 |
| data | products.json | default catalog source | src/productcatalogservice/catalog_loader.go:47 |
| data | currency_conversion.json | bundled rates | src/currencyservice/server.js:110 |
| data | AlloyDB (optional) | vector store for the assistant; optional catalog/cart store | src/shoppingassistantservice/shoppingassistantservice.py:91 |
| external | Gemini / GenAI API | LLM + embeddings | src/shoppingassistantservice/shoppingassistantservice.py:82 |
| external | Secret Manager | AlloyDB password | src/shoppingassistantservice/shoppingassistantservice.py:38 |

## Arrows

| From | To | How | Ref |
|---|---|---|---|
| Browser | frontend | HTTP | src/frontend/main.go:150 |
| loadgenerator | frontend | HTTP GET /, /product, /cart; POST /setCurrency, /cart, /cart/checkout | src/loadgenerator/locustfile.py:35 |
| frontend | currencyservice | gRPC GetSupportedCurrencies, Convert | src/frontend/rpc.go:32, :82 |
| frontend | productcatalogservice | gRPC ListProducts, GetProduct | src/frontend/rpc.go:47, :53 |
| frontend | cartservice | gRPC GetCart, AddItem, EmptyCart | src/frontend/rpc.go:58, :68, :63 |
| frontend | shippingservice | gRPC GetQuote | src/frontend/rpc.go:88 |
| frontend | recommendationservice | gRPC ListRecommendations | src/frontend/rpc.go:100 |
| frontend | adservice | gRPC GetAds | src/frontend/rpc.go:123 |
| frontend | checkoutservice | gRPC PlaceOrder | src/frontend/handlers.go:354 |
| frontend | shoppingassistantservice | HTTP POST | src/frontend/handlers.go:472 |
| checkoutservice | cartservice | gRPC GetCart, EmptyCart | src/checkoutservice/main.go:325, :333 |
| checkoutservice | productcatalogservice | gRPC GetProduct | src/checkoutservice/main.go:344 |
| checkoutservice | currencyservice | gRPC Convert | src/checkoutservice/main.go:360 |
| checkoutservice | shippingservice | gRPC GetQuote, ShipOrder | src/checkoutservice/main.go:314, :387 |
| checkoutservice | paymentservice | gRPC Charge | src/checkoutservice/main.go:370 |
| checkoutservice | emailservice | gRPC SendOrderConfirmation | src/checkoutservice/main.go:380 |
| recommendationservice | productcatalogservice | gRPC ListProducts | src/recommendationservice/recommendation_server.py:73 |
| cartservice | redis-cart | read / write | src/cartservice/src/cartstore/RedisCartStore.cs:40, :60 |
| productcatalogservice | products.json | file read | src/productcatalogservice/catalog_loader.go:47 |
| currencyservice | currency_conversion.json | file read | src/currencyservice/server.js:110 |
| shoppingassistantservice | AlloyDB | vector similarity search | src/shoppingassistantservice/shoppingassistantservice.py:91 |
| shoppingassistantservice | Gemini / GenAI API | invoke ×2, embeddings | src/shoppingassistantservice/shoppingassistantservice.py:82, :108, :55 |
| shoppingassistantservice | Secret Manager | AlloyDB password | src/shoppingassistantservice/shoppingassistantservice.py:38 |

Optional or alternative edges, off by default: cartservice → Spanner or AlloyDB
(`src/cartservice/src/Startup.cs:42`, `:46`); productcatalogservice → AlloyDB and Secret Manager
(`src/productcatalogservice/catalog_loader.go:37`, `:96`). Telemetry (OTLP collector, Cloud Profiler) is left off
the map.

## Flow list (simplest first)

All flows are traced from code, not run. ★ marks the recommended first set for gate 1.

### Happy paths

1. ★ **Add to cart**, `POST /cart`: frontend → productcatalog GetProduct → cartservice AddItem → Redis write.
   Single chain, one store write.
2. ★ **Home page**, `GET /`: frontend fans out to currency (GetSupportedCurrencies, then Convert per product),
   productcatalog ListProducts, cart GetCart and ad GetAds. Read-only fan-out.
3. ★ **Product page**, `GET /product/{id}`: GetProduct, GetCart, Convert, ad GetAds, and recommendation
   ListRecommendations, which itself calls productcatalog ListProducts. The first two-hop call.
4. **View cart**, `GET /cart`: GetCart, shipping GetQuote, recommendations, GetProduct and Convert per item.
5. ★ **Place order**, `POST /cart/checkout` → checkout PlaceOrder (main.go:230): GetCart → GetProduct + Convert per
   item → GetQuote → Charge → ShipOrder → EmptyCart → SendOrderConfirmation. The core orchestration.
6. **Shopping assistant**, `POST /bot` → shoppingassistantservice `POST /`: Gemini describes the image →
   embedding + AlloyDB similarity search → Gemini recommendation. Needs GCP: trace only, with invented data.

### Failure paths

7. ★ **Card rejected**: invalid / unaccepted type / expired (paymentservice charge.js:70, :74, :80) → checkout
   returns `Internal "failed to charge card"` (main.go:253-255) → back to frontend (how it renders the error is still to trace). The cart is untouched.
8. ★ **Shipping fails after payment**: Charge succeeds (main.go:252), then ShipOrder fails → `Unavailable`
   (main.go:258-260). The card stays charged, the cart is not emptied and there's no refund or compensation step.
   *(Observation, not fixed.)*
9. **Email fails**: the error is logged and swallowed (main.go:272-276), so the order still succeeds.
10. **Slow dependency**: `EXTRA_LATENCY` on productcatalog (server.go:88; sleeps at product_catalog.go:42/48/61)
    slows home, product, cart and checkout. This is an existing fault seam, useful for labs.
11. **Cart store down**: Redis unreachable → cartservice Health.Check pings the store
    (HealthCheckService.cs:33) and fails; GetCart/AddItem errors propagate to frontend and checkout.

### Ops paths

12. **cartservice startup store selection**: REDIS_ADDR → Spanner → AlloyDB → in-memory (Startup.cs:34-54).
13. **Catalog hot reload**: SIGUSR1/SIGUSR2 toggle per-request reload from the source (server.go:100,
    product_catalog.go:75).
14. **Health probes**: frontend `/_healthz` (main.go:161) and gRPC Health.Check in each service.
    Health.Watch is Unimplemented in several of them.

## Survey notes for gate 1

- Front end: Go `html/template` server-rendered pages, no JS framework, so the page should be **standalone HTML**.
- loadgenerator never runs `empty_cart` or `logout`: they're defined (locustfile.py:55, :74) but missing from the
  task table (locustfile.py:83-88).
- checkout's Convert call uses `context.TODO()` (main.go:360) instead of the request `ctx`, so the deadline and
  cancellation from the caller are not passed on to currencyservice.
- Open questions: cartservice's bound port in code; how shoppingassistantservice is deployed (not in
  `kubernetes-manifests/`); how grpc-js maps paymentservice's code 400 to a gRPC status.
