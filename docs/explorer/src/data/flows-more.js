// Flows 14–15, added in Stage 2b because they only make sense with the whole shop running. Run for real
// (2026-11-11): `run-services.sh shop`, then `shop-session.sh order` (steps 2, 8 and 9 of it). No breakpoints:
// neither flow touches currency, payment or ads, and the frontend and cart run from release images with no debugger.
export const moreFlows = [
  {
    id: "set-currency", title: "14. Change currency",
    intro: "`POST /setCurrency currency_code=EUR`: the drop-down in the header. It calls **no** service: it only sets a cookie, and every later page converts its prices. It's also the doorway to flow 10.",
    steps: [
      { n: ["browser", "frontend"], e: ["browser>frontend"], t: "Check the code, set a cookie",
        x: "The code must be a valid ISO 4217 code (`validator.go:56`), not one of the six in the drop-down. The handler sets `shop_currency` for 48 hours and redirects back to the page the shopper came from (`handlers.go:499-521`).",
        d: "POST /setCurrency currency_code=EUR → 302 Found · Location: /   (no Referer sent)\nSet-Cookie: shop_currency=EUR; Max-Age=172800\nfrontend log: setting currency · request complete · 302 · 0 ms",
        st: [["add", "Browser", "cookie `shop_currency` = EUR (48 h)"]],
        obs: "`curl -si -X POST -d currency_code=EUR http://localhost:8080/setCurrency`" },
      { n: ["browser", "frontend", "currency"], e: ["browser>frontend", "frontend>currency"], t: "Every later page reads the cookie",
        x: "`currentCurrency()` reads the cookie on every request, with USD when it's missing, and never checks it again (`handlers.go:573`). Each price on the next page is one `Convert` to that code.",
        d: "next page, frontend log: serving product page · id 66VCHSJNUP · currency EUR\nthe page: \"Tank Top €16.79\"" },
      { n: ["browser"], e: [], t: "Nothing stops a code with no rate",
        x: "The load generator picks only from the drop-down's six codes (`locustfile.py:38`), so it never finds the gap. A shopper who posts ARS gets a cookie the same way, and every price becomes 0: flow 10.",
        d: "POST /setCurrency currency_code=ARS → 302 · Set-Cookie: shop_currency=ARS; Max-Age=172800\nload generator, 3 minutes: 33 currency changes, all from USD, EUR, JPY, CAD, GBP, TRY" },
    ],
  },
  {
    id: "empty-cart", title: "15. Empty the cart",
    intro: "`POST /cart/empty`: the **Empty Cart** button. One call to cart, which writes an empty cart over the old one.",
    steps: [
      { n: ["browser", "frontend", "cart"], e: ["browser>frontend", "frontend>cart"], t: "EmptyCart for this session",
        x: "The handler calls `EmptyCart` with the session id (`handlers.go:243`, `rpc.go:63`). Unlike checkout, it checks the error: if cart is down, the shopper gets a 500 (from code, not tried).",
        d: "frontend log: emptying cart · request complete · 302 · 7 ms\ncart log: EmptyCartAsync called with userId=a1918d75-5ce5-48b9-8038-07f2fefd3f4d" },
      { n: ["cart", "redis"], e: ["cart>redis"], t: "An empty cart, not a deleted entry",
        x: "Cart writes a brand-new empty `Cart` (`RedisCartStore.cs:74-75`). The Redis entry stays, still with no expiry, and the new cart has no user id in it.",
        d: "before: data \"\\x12\\x0e\\n\\nOLJCESPC7Z\\x10\\x01\"   (one Sunglasses)\nafter:  data \"\"   · absexp -1 · sldexp -1",
        st: [["chg", "Redis", "hash `<session id>`: an empty Cart; the entry stays, with no expiry"]],
        obs: "`docker exec bx-redis redis-cli --no-raw HGETALL <your shop_session-id>`" },
      { n: ["frontend", "browser"], e: ["browser>frontend"], t: "Back to the home page",
        x: "`302 Location: /` (`handlers.go:247-248`), so a refresh reloads the home page, not the empty.",
        d: "POST /cart/empty → 302 Found · Location: /" },
    ],
  },
];
