// Flows 4–5: browsing. The frontend, catalog, cart and recommendation steps are TRACED FROM CODE, NOT RUN: they have
// no `d` and no `bp` (a breakpoint here could not be verified). Steps inside currency and ads were run for real with
// the same request the frontend would send; their `d` was captured and their `bp` verified on 2026-11-11.
const FE = "src/frontend/";
const CUR = "src/currencyservice/server.js";
const ADS = "src/adservice/src/main/java/hipstershop/AdService.java";

export const browseFlows = [
  {
    id: "home", title: "4. Browse: the home page (traced + run)",
    intro: "One `GET /` and the six calls behind it, made **one after another**. The frontend is traced from code (`src/frontend/handlers.go:59`); the currency and ads steps were run with the request the frontend sends.",
    steps: [
      { n: ["browser", "frontend"], e: ["browser>frontend"], t: "GET /: who is this shopper?",
        x: "Traced from code, not run. A middleware gives every new browser a random UUID in the `shop_session-id` cookie (`middleware.go:94-97`). There is no login: that id is the user, and the key of their cart.",
        st: [["add", "Browser", "cookie `shop_session-id` = a new UUID (48 h)"]],
        obs: "Not run here." },
      { n: ["frontend", "currency"], e: ["frontend>currency"], t: "Which currencies can the shopper pick?",
        x: "Currency returns all 33 codes it has rates for; the frontend keeps only the 6 on its own allow-list (`rpc.go:38`) for the drop-down. Remember that list: `/setCurrency` doesn't use it (flow 10).",
        d: "GetSupportedCurrencies → 33 codes: EUR, USD, JPY, BGN, CZK, … ZAR\nfrontend keeps: USD, EUR, CAD, JPY, GBP, TRY",
        bp: [CUR, 131, "Evaluate `Object.keys(data).length` (33). Send `drive currencies`."] },
      { n: ["frontend", "catalog"], e: ["frontend>catalog"], t: "List the products",
        x: "Traced from code, not run. `ListProducts` returns the 9 products from `products.json`, loaded once when the catalog started (`handlers.go:67`).",
        obs: "Not run here." },
      { n: ["frontend", "cart", "redis"], e: ["frontend>cart", "cart>redis"], t: "How many items in the cart?",
        x: "Traced from code, not run. `GetCart` with the session id reads one Redis key (`handlers.go:72`). A new shopper has none, so they get an empty cart. Only the item count is shown, in the header.",
        obs: "Not run here." },
      { n: ["frontend", "currency"], e: ["frontend>currency"], t: "Price every product in the shopper's currency", why: ["chatty", "L0"],
        x: "One `Convert` per product, in a loop: 9 calls for one page (`handlers.go:84`). A flag to skip USD → USD exists but is off (`rpc.go:27`), so even a shopper in dollars costs 9 round trips.",
        d: "Convert {\"from\":{\"currency_code\":\"USD\",\"units\":18,\"nanos\":990000000},\"to_code\":\"USD\"}\n→ {\"currency_code\":\"USD\",\"units\":\"18\",\"nanos\":990000000}",
        bp: [CUR, 141, "Send `drive home-convert-usd`: the breakpoint stops even though nothing needs converting."] },
      { n: ["frontend", "ads"], e: ["frontend>ads"], t: "Fetch an ad that is never shown",
        x: "The handler asks for ads with no keys and puts one in the page data (`handlers.go:116`), but `home.html` never renders it: only `product.html:81` has an ad slot. So on the home page this is a round trip for nothing (traced; the ads half ran).",
        d: "GetAds {\"context_keys\":[]}\n→ Mug for sale. Buy two, get third one for free · Hairdryer for sale. 50% off.   (20 ms)",
        bp: [ADS, 105, "Send `drive ads-none`."] },
      { n: ["frontend", "browser"], e: ["browser>frontend"], t: "Render the page",
        x: "Traced from code, not run. The handler fills the `home` template and answers 200. The six calls ran in sequence, so the page is as slow as their sum; none of them ran in parallel.",
        st: [["del", "Any store", "nothing written: browsing only reads"]],
        obs: "Not run here." },
    ],
  },
  {
    id: "product", title: "5. Browse: a product page (traced + run)",
    intro: "`GET /product/66VCHSJNUP`, the Tank Top, for a shopper whose currency is EUR. Traced from code (`src/frontend/handlers.go:144`), with the currency and ads steps run for real.",
    steps: [
      { n: ["browser", "frontend", "catalog"], e: ["browser>frontend", "frontend>catalog"], t: "Get the product",
        x: "Traced from code, not run. `GetProduct` by id (`handlers.go:154`). An unknown id comes back as `NotFound` and the shopper sees an error page.",
        obs: "Not run here." },
      { n: ["frontend", "currency", "cart"], e: ["frontend>currency", "frontend>cart"], t: "Currencies and cart again",
        x: "Traced from code, not run. The same two calls as the home page, made again for the header (`handlers.go:159`, `165`). Nothing is shared between page loads.",
        obs: "Not run here." },
      { n: ["frontend", "currency"], e: ["frontend>currency"], t: "Show the price in euros",
        x: "One `Convert`, USD → EUR. The answer keeps nine decimal places, and `renderMoney` cuts them to two by integer division (`handlers.go:608`): truncated, not rounded.",
        d: "Convert {\"from\":{\"currency_code\":\"USD\",\"units\":18,\"nanos\":990000000},\"to_code\":\"EUR\"}\n→ {\"currency_code\":\"EUR\",\"units\":\"16\",\"nanos\":797877046}   (€16.79 on the page, from code)",
        bp: [CUR, 158, "Send `drive product-convert-eur` and inspect `result`."] },
      { n: ["frontend", "rec", "catalog"], e: ["frontend>rec", "rec>catalog", "frontend>catalog"], t: "\"You may also like\"",
        x: "Traced from code, not run. Recommendation fetches **all** products, drops this one and samples 5 at random (`recommendation_server.py:73-81`). It returns only ids, so the frontend then calls `GetProduct` once per id (`rpc.go:107`): 1 + 5 calls for one box.",
        obs: "Not run here." },
      { n: ["frontend", "ads"], e: ["frontend>ads"], t: "An ad that matches the product",
        x: "This time the frontend sends the product's categories (`handlers.go:199`). `clothing` matches one ad; `tops` matches none.",
        d: "GetAds {\"context_keys\":[\"clothing\",\"tops\"]}\n→ {\"ads\":[{\"redirect_url\":\"/product/66VCHSJNUP\",\"text\":\"Tank top for sale. 20% off.\"}]}",
        bp: [ADS, 101, "Send `drive product-ads`; it stops once per key."] },
    ],
  },
];
