// Online Boutique (Google's microservices demo, v0.10.7): architecture explorer data.
// Format: the project-explorer skill's reference/data-schema.md. Rebuild the page after any change:
//   node docs/explorer/tools/validate-data.mjs docs/explorer/src/explorer-data.js --repo .
//   node docs/explorer/tools/bundle-html.mjs docs/explorer/src/explorer-data.js docs/explorer/explorer.html
//   node docs/explorer/tools/check-explorer.mjs docs/explorer/explorer.html
import { runFlows } from "./data/flows-run.js";
import { browseFlows } from "./data/flows-browse.js";
import { orderFlows } from "./data/flows-order.js";
import { failureFlows } from "./data/flows-failure.js";
import { moreFlows } from "./data/flows-more.js";
import { concepts } from "./data/concepts.js";

const FE = "src/frontend/";
const CO = "src/checkoutservice/main.go";
const CART = "src/cartservice/src/";
const ADS = "src/adservice/src/main/java/hipstershop/AdService.java";

export default {
  meta: {
    title: "Online Boutique: architecture explorer",
    subtitle: "Google's microservices demo, v0.10.7, all 11 services run for real. Currency, payment and ads also have proven breakpoints.",
    pagePath: "docs/explorer/explorer.html",
    labsDoc: "docs/explorer/LABS.md",
    repoUrl: "https://github.com/myhts/claude-kits-boutique/blob/main",
    measuredOn: "2026-11-11, Apple M1 Pro, OrbStack 4 GB, amd64 images under Rosetta",
    startHere: "Start with flow **1** (one service, one request, under the debugger), then **2** and **3**. Flows **4–8** follow a shopper through the whole running shop; **9–13** are what goes wrong, each made to happen; **14–15** are the currency switch and the empty-cart button. Steps in currency, payment and ads have a proven breakpoint; the rest show what the service's logs, replies and Redis said. Then the five concept ladders explain **why**, level by level.",
    guides: [["Debug tour (first hour)", "docs/explorer/TOUR.md"], ["Every flow, step by step", "docs/explorer/FLOWS.md"], ["Labs", "docs/explorer/LABS.md"], ["Measurements", "docs/explorer/MEASURED.md"], ["What each service exposes and calls", "docs/explorer/survey.json"]],
  },

  modules: {
    client: { label: "Clients", color: "#868e96" },
    go: { label: "Go · run, no debugger", color: "#1c7ed6" },
    csharp: { label: "C# · run, no debugger", color: "#7048e8" },
    python: { label: "Python · run, no debugger", color: "#d6a100" },
    node: { label: "Node.js · run + debugger", color: "#2f9e44" },
    java: { label: "Java · run + debugger", color: "#e8590c" },
    data: { label: "Data", color: "#5c3d2e", dark: "#c49a6c" },
  },

  map: {
    nodeWidth: 150, gapX: 34,
    lanes: [
      { id: "client", label: "Clients" },
      { id: "edge", label: "Front end & checkout" },
      { id: "svc", label: "Services (gRPC)" },
      { id: "data", label: "Data" },
    ],
    nodes: [
      { id: "browser", lane: "client", col: 1, label: "Browser", sub: "a shopper", mod: "client",
        what: "A shopper's browser. It holds two cookies the frontend sets: `shop_session-id`, which is also the cart's key, and `shop_currency`. There is no login: the session cookie **is** the user.",
        files: [[FE + "middleware.go", 97, "sets shop_session-id"], [FE + "handlers.go", 511, "sets shop_currency"]],
        observe: "`docs/explorer/run-services.sh shop`, open http://localhost:8080, then DevTools → **Application → Cookies**." },
      { id: "loadgen", lane: "client", col: 2, label: "Load generator", sub: "loadgenerator · Locust", mod: "client",
        what: "A Locust script that behaves like shoppers: product pages weigh 10, the cart 3, add-to-cart and currency 2, home and checkout 1. It never empties the cart or logs out.",
        files: [["src/loadgenerator/locustfile.py", 83, "task weights"], ["src/loadgenerator/locustfile.py", 59, "checkout task"]],
        observe: "Run for 3 minutes with the manifest's 10 users: 408 requests, 0 failures (MEASURED.md M10)." },
      { id: "frontend", lane: "edge", col: 1, label: "Frontend", sub: "frontend · HTTP", mod: "go",
        what: "The only service the browser talks to. Each page handler calls several gRPC services **one after another** and renders an HTML template. It talks to seven services and stores nothing itself.",
        files: [[FE + "main.go", 150, "routes"], [FE + "handlers.go", 59, "homeHandler"], [FE + "rpc.go", 30, "the gRPC helpers"]],
        docs: [["Frontend README", "src/frontend/README.md"]],
        observe: "`docker logs -f bx-frontend` (one JSON line per request, with its time) · http://localhost:8080" },
      { id: "checkout", lane: "edge", col: 3, label: "Checkout", sub: "checkoutservice", mod: "go",
        what: "Turns a cart into an order in one long synchronous call: read the cart, price every item, quote shipping, **charge**, ship, empty the cart, send an email. Nothing is stored: the order exists only in the reply.",
        files: [[CO, 230, "PlaceOrder"], [CO, 288, "prepare items and shipping"], [CO, 369, "chargeCard"]],
        docs: [["Checkout README", "src/checkoutservice/README.md"]],
        observe: "`docker logs -f bx-checkout`: three lines per order ([PlaceOrder], payment, email)." },
      { id: "ads", lane: "svc", col: 0, label: "Ads", sub: "adservice", mod: "java",
        what: "Returns ads for the categories it's given, or 2 random ads. The ads live in a map in the code. The frontend waits only **100 ms** for it, and the first call after a start takes ~650 ms here.",
        files: [[ADS, 94, "getAds"], [ADS, 121, "the ads map"]],
        observe: "`docker logs -f bx-ads` · `docs/explorer/run-services.sh drive ads-ctx`" },
      { id: "rec", lane: "svc", col: 0, row: 1, label: "Recommendations", sub: "recommendationservice", mod: "python",
        what: "Asks the catalog for **every** product, drops the ones the shopper is looking at, and returns up to 5 at random. No model, no history.",
        files: [["src/recommendationservice/recommendation_server.py", 70, "ListRecommendations"]],
        observe: "`docker logs -f bx-rec` · `docs/explorer/run-services.sh drive shop-rec`" },
      { id: "catalog", lane: "svc", col: 1, label: "Product catalog", sub: "productcatalogservice", mod: "go",
        what: "Serves 9 products from `products.json`, loaded once at startup. Unknown id → `NotFound`. `EXTRA_LATENCY` adds a sleep to every call, a ready-made fault switch.",
        files: [["src/productcatalogservice/product_catalog.go", 47, "GetProduct"], ["src/productcatalogservice/catalog_loader.go", 47, "reads products.json"], ["src/productcatalogservice/server.go", 88, "EXTRA_LATENCY"]],
        observe: "It logs nothing per request: `docs/explorer/run-services.sh drive shop-catalog-list shop-catalog-get`" },
      { id: "cart", lane: "svc", col: 2, label: "Cart", sub: "cartservice", mod: "csharp",
        what: "Keeps each cart as **one value** in Redis under the session id. Adding an item reads the whole cart, changes it in memory and writes it back, with no lock: two adds at once lost an item in 17–18 carts of 20. Under the load generator it sits at 122–126 MiB of its 128 MiB limit.",
        files: [[CART + "services/CartService.cs", 34, "AddItem"], [CART + "cartstore/RedisCartStore.cs", 33, "AddItemAsync"], [CART + "Startup.cs", 34, "store chosen by env"]],
        observe: "`docker logs -f bx-cart`: one line per GetCart, AddItem, EmptyCart, with the session id." },
      { id: "currency", lane: "svc", col: 3, label: "Currency", sub: "currencyservice", mod: "node",
        what: "Converts money between 33 currencies through EUR, from a JSON file of rates. The busiest service: the frontend calls it once per product shown, even USD → USD. An unknown code gives **0**, not an error.",
        files: [["src/currencyservice/server.js", 138, "convert"], ["src/currencyservice/data/currency_conversion.json", 1, "the rates"]],
        observe: "`docker logs -f bx-currency` · `docs/explorer/run-services.sh drive convert`" },
      { id: "shipping", lane: "svc", col: 4, label: "Shipping", sub: "shippingservice", mod: "go",
        what: "Quotes **8.99 USD** for any non-empty cart, whatever the address or weight, and makes up a tracking id. It ships nothing and remembers nothing.",
        files: [["src/shippingservice/main.go", 119, "GetQuote"], ["src/shippingservice/quote.go", 34, "the flat rate"], ["src/shippingservice/main.go", 142, "ShipOrder"]],
        observe: "`docker logs -f bx-shipping` · `docs/explorer/run-services.sh drive shop-ship-quote shop-ship-order`" },
      { id: "payment", lane: "svc", col: 3, row: 1, label: "Payment", sub: "paymentservice", mod: "node",
        what: "Checks the card (Luhn, VISA or Mastercard, not expired) and returns a random transaction id. Nothing is charged and nothing is stored. It logs the whole request, **card number and CVV included**.",
        files: [["src/paymentservice/server.js", 41, "ChargeServiceHandler"], ["src/paymentservice/charge.js", 61, "charge"]],
        observe: "`docker logs -f bx-payment` · `docs/explorer/run-services.sh drive charge`" },
      { id: "email", lane: "svc", col: 4, row: 1, label: "Email", sub: "emailservice · logs only", mod: "python",
        what: "Starts in dummy mode, the only mode it has: it logs \"A request to send order confirmation email to … has been received\" and returns. The real sender is unfinished code.",
        files: [["src/emailservice/email_server.py", 109, "DummyEmailService"], ["src/emailservice/email_server.py", 200, "dummy_mode = True"]],
        observe: "`docker logs -f bx-email`, then place an order." },
      { id: "redis", lane: "data", col: 2, label: "Redis", sub: "redis-cart", mod: "data",
        what: "One hash per session id: `data` is the whole cart as protobuf bytes, `absexp` and `sldexp` are -1, so it never expires. Emptying a cart writes an empty cart; the entry stays. Spanner and AlloyDB stores exist too, chosen by env vars.",
        files: [[CART + "cartstore/RedisCartStore.cs", 40, "GET"], [CART + "cartstore/RedisCartStore.cs", 60, "SET"]],
        observe: "`docker exec bx-redis redis-cli --no-raw HGETALL <shop_session-id>` · `redis-cli DBSIZE`" },
    ],
    edges: [
      // Geometry (nodeWidth 150, gapX 34): column centres x = 105, 289, 473, 657, 841; the front-end row's boxes end at
      // y = 194 and the first services row starts at 246. The frontend's calls use the engine's routing (they cross at
      // y = 220 and drop into each box's centre); checkout's calls get their own level (y = 232) and drop 24 px to the
      // right of centre, so the two fan-outs can be told apart.
      { from: "browser", to: "frontend", label: "HTTP" },
      { from: "loadgen", to: "frontend", label: "HTTP" },
      { from: "frontend", to: "checkout", label: "PlaceOrder" },
      { from: "frontend", to: "ads" },
      { from: "frontend", to: "rec", around: "left" },
      { from: "frontend", to: "catalog" },
      { from: "frontend", to: "cart" },
      { from: "frontend", to: "currency" },
      { from: "frontend", to: "shipping" },
      { from: "rec", to: "catalog" },
      { from: "checkout", to: "catalog", pts: [[633, 194], [633, 232], [313, 232], [313, 246]] },
      { from: "checkout", to: "cart", pts: [[633, 194], [633, 232], [497, 232], [497, 246]] },
      { from: "checkout", to: "currency", pts: [[633, 194], [633, 246]] },
      { from: "checkout", to: "shipping", pts: [[633, 194], [633, 232], [865, 232], [865, 246]] },
      { from: "checkout", to: "payment", around: "right" },
      { from: "checkout", to: "email", around: "right", dy: 10 },
      { from: "cart", to: "redis" },
    ],
  },

  flows: [...runFlows, ...browseFlows, ...orderFlows, ...failureFlows, ...moreFlows],
  concepts,
};
