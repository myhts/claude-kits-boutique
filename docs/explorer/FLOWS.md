# Flows, step by step

Follow each request with the debugger. Tick a box when you've seen it happen, not when you've read it.

<!-- generated below: edit the data, not this part -->

## 1. Convert a price (currency · run)

The simplest request in the shop: one gRPC call into one Node process, no other service involved. **Run for real.** Start the services with `docs/explorer/run-services.sh debug`, attach **Attach · currency (Node, 9229)**, then send the request with `docs/explorer/run-services.sh drive convert`.

[open on the page](explorer.html#flow=convert)

- [ ] **1. A Convert request arrives**: The frontend sends one for every price it shows; checkout, one per cart item plus one for shipping. Money is two integers: `units` and `nanos` (billionths), so 19.99 is `19` and `990000000`.
  - Breakpoint: [server.js:141](../../src/currencyservice/server.js#L141). Inspect `call.request`. `units` arrives as a **string**: the proto loader is set to `longs: String` (line 96).
  - See it: `docker logs -f bx-currency`
- [ ] **2. Where do the rates come from?**: From `data/currency_conversion.json`, loaded with `require()`: read from disk on the first call, then cached by Node for the life of the process. Rates are against EUR and are **strings**; JavaScript turns them into numbers when it divides.
  - Breakpoint: [server.js:145](../../src/currencyservice/server.js#L145). Evaluate `data[from.currency_code]` and `data[request.to_code]`. (Line 146 is not a break location: V8 moves it to 150.)
- [ ] **3. Divide into EUR, carrying fractions**: Units and nanos are divided **separately**, which leaves a fractional `units`. `_carry` moves that fraction into `nanos` and any whole euros out of `nanos`. It runs twice per conversion.
  - Breakpoint: [server.js:119](../../src/currencyservice/server.js#L119). Inspect `amount` on entry, then step to line 122.
  - Why: concept [money L0](explorer.html#concept=money&level=L0)
- [ ] **4. Multiply into the target currency, round down**: The EUR amount is multiplied by the target rate and carried again, then both parts are floored. Rounding down every time means a converted price is never more than the exact one, and can be a nano less.
  - Breakpoint: [server.js:158](../../src/currencyservice/server.js#L158). Inspect `result` before the floor.
- [ ] **5. Reply**: The reply is a `Money` in the target currency. Nothing was stored; the same request always gives the same answer, so the caller could cache it but doesn't.
  - Breakpoint: [server.js:163](../../src/currencyservice/server.js#L163). Inspect `result` once more: this is what goes on the wire.
  - Check (gone / not touched) **Any store**: untouched: currency keeps no state
  - See it: `docker logs bx-currency` shows `conversion request successful`.

## 2. Charge a card (payment · run)

Checkout's call to payment, on its own. Three checks, then a made-up transaction id: **no money moves anywhere**. **Run for real.** Attach **Attach · payment (Node, 9230)**, then `docs/explorer/run-services.sh drive charge`.

[open on the page](explorer.html#flow=charge)

- [ ] **1. A Charge request arrives, and is logged whole**: The handler logs the full request with `JSON.stringify` before doing anything else. That puts the **card number and the CVV** in the service's log in plain text.
  - Breakpoint: [server.js:43](../../src/paymentservice/server.js#L43). Inspect `call.request`, then run `docker logs bx-payment` and find the same JSON in the log.
  - Check (new) **bx-payment log**: the full card number and CVV, in plain text
  - See it: `docker logs bx-payment | grep Charge`
- [ ] **2. Is the number valid at all?**: The `simple-card-validator` library runs the Luhn check and works out the card type from the number. An invalid number throws `InvalidCreditCard`.
  - Breakpoint: [charge.js:70](../../src/paymentservice/charge.js#L70). Inspect `cardType` and `valid`.
- [ ] **3. Is it a card we take?**: Only VISA and Mastercard. Anything else (Amex, Diners) throws `UnacceptedCreditCard`, even when it's valid.
  - Breakpoint: [charge.js:74](../../src/paymentservice/charge.js#L74). Inspect `cardType`.
- [ ] **4. Has it expired?**: Both dates become a count of months (year × 12 + month), so a card is good to the end of its expiry month. The CVV is never looked at.
  - Breakpoint: [charge.js:80](../../src/paymentservice/charge.js#L80). Evaluate `currentYear*12+currentMonth` and `year*12+month`.
- [ ] **5. "Charge" the card**: There is no payment gateway: the function logs the last four digits and returns a random UUID. Nothing is recorded, so the same order sent twice gets two different transaction ids.
  - Breakpoint: [charge.js:85](../../src/paymentservice/charge.js#L85). Step over: `uuidv4()` is the whole charge.
  - Check (gone / not touched) **Ledger**: none: no charge, no record, no idempotency key
- [ ] **6. Reply with the transaction id**: Checkout gets the id and logs `payment went through`. From here on, checkout treats the card as charged.
  - Breakpoint: [server.js:45](../../src/paymentservice/server.js#L45). Inspect `response`.

## 3. Pick ads (ads · run)

The frontend asks for ads on the home page (no keys) and on a product page (the product's categories). **Run for real**, with `DISABLE_STATS=1 DISABLE_TRACING=1`. Attach **Attach · ads (Java JDWP, 5005)**, then `docs/explorer/run-services.sh drive product-ads ads-none ads-unknown`.

[open on the page](explorer.html#flow=ads)

- [ ] **1. A GetAds request arrives with context keys**: A product page sends the product's categories. The handler lives in a **nested class**, so a breakpoint by class name needs `hipstershop.AdService$AdServiceImpl`; clicking the line in VS Code handles that for you.
  - Breakpoint: [AdService.java:99](../../src/adservice/src/main/java/hipstershop/AdService.java#L99). Evaluate `req.getContextKeysCount()`. In jdb: `stop at hipstershop.AdService$AdServiceImpl:99`.
  - See it: `docker logs -f bx-ads` shows `received ad request (context_words=[clothing, tops])`.
- [ ] **2. Look each key up in the ads map**: Each key is an exact lookup in an in-memory map built at class load: 7 ads in 6 categories. `clothing` has one ad; `tops` has none, so it adds nothing.
  - Breakpoint: [AdService.java:124](../../src/adservice/src/main/java/hipstershop/AdService.java#L124). Class `hipstershop.AdService` (the outer class). Evaluate `category`.
- [ ] **3. No keys? Two random ads**: The home page sends no keys, so the service picks 2 ads at random **with replacement**: the same ad can come back twice.
  - Breakpoint: [AdService.java:105](../../src/adservice/src/main/java/hipstershop/AdService.java#L105). Send `drive ads-none` to reach this line.
- [ ] **4. Nothing matched? Fall back to random**: If the keys matched nothing (an unknown category), the list is empty and the service serves random ads instead. The caller never gets an empty answer.
  - Breakpoint: [AdService.java:107](../../src/adservice/src/main/java/hipstershop/AdService.java#L107). Evaluate `allAds.size()`.
- [ ] **5. Reply**: The frontend picks one ad from the list at random and shows it. If the reply takes more than **100 ms**, the frontend has already given up: see flow 11.
  - Breakpoint: [AdService.java:112](../../src/adservice/src/main/java/hipstershop/AdService.java#L112). Evaluate `reply.getAdsCount()`.
  - Check (gone / not touched) **Any store**: untouched: the ads are constants in the code

## 4. Browse: the home page (traced + run)

One `GET /` and the six calls behind it, made **one after another**. The frontend is traced from code (`src/frontend/handlers.go:59`); the currency and ads steps were run with the request the frontend sends.

[open on the page](explorer.html#flow=home)

- [ ] **1. GET /: who is this shopper?**: Traced from code, not run. A middleware gives every new browser a random UUID in the `shop_session-id` cookie (`middleware.go:94-97`). There is no login: that id is the user, and the key of their cart.
  - Check (new) **Browser**: cookie `shop_session-id` = a new UUID (48 h)
  - See it: Not run here.
- [ ] **2. Which currencies can the shopper pick?**: Currency returns all 33 codes it has rates for; the frontend keeps only the 6 on its own allow-list (`rpc.go:38`) for the drop-down. Remember that list: `/setCurrency` doesn't use it (flow 10).
  - Breakpoint: [server.js:131](../../src/currencyservice/server.js#L131). Evaluate `Object.keys(data).length` (33). Send `drive currencies`.
- [ ] **3. List the products**: Traced from code, not run. `ListProducts` returns the 9 products from `products.json`, loaded once when the catalog started (`handlers.go:67`).
  - See it: Not run here.
- [ ] **4. How many items in the cart?**: Traced from code, not run. `GetCart` with the session id reads one Redis key (`handlers.go:72`). A new shopper has none, so they get an empty cart. Only the item count is shown, in the header.
  - See it: Not run here.
- [ ] **5. Price every product in the shopper's currency**: One `Convert` per product, in a loop: 9 calls for one page (`handlers.go:84`). A flag to skip USD → USD exists but is off (`rpc.go:27`), so even a shopper in dollars costs 9 round trips.
  - Breakpoint: [server.js:141](../../src/currencyservice/server.js#L141). Send `drive home-convert-usd`: the breakpoint stops even though nothing needs converting.
  - Why: concept [chatty L0](explorer.html#concept=chatty&level=L0)
- [ ] **6. Fetch an ad that is never shown**: The handler asks for ads with no keys and puts one in the page data (`handlers.go:116`), but `home.html` never renders it: only `product.html:81` has an ad slot. So on the home page this is a round trip for nothing (traced; the ads half ran).
  - Breakpoint: [AdService.java:105](../../src/adservice/src/main/java/hipstershop/AdService.java#L105). Send `drive ads-none`.
- [ ] **7. Render the page**: Traced from code, not run. The handler fills the `home` template and answers 200. The six calls ran in sequence, so the page is as slow as their sum; none of them ran in parallel.
  - Check (gone / not touched) **Any store**: nothing written: browsing only reads
  - See it: Not run here.

## 5. Browse: a product page (traced + run)

`GET /product/66VCHSJNUP`, the Tank Top, for a shopper whose currency is EUR. Traced from code (`src/frontend/handlers.go:144`), with the currency and ads steps run for real.

[open on the page](explorer.html#flow=product)

- [ ] **1. Get the product**: Traced from code, not run. `GetProduct` by id (`handlers.go:154`). An unknown id comes back as `NotFound` and the shopper sees an error page.
  - See it: Not run here.
- [ ] **2. Currencies and cart again**: Traced from code, not run. The same two calls as the home page, made again for the header (`handlers.go:159`, `165`). Nothing is shared between page loads.
  - See it: Not run here.
- [ ] **3. Show the price in euros**: One `Convert`, USD → EUR. The answer keeps nine decimal places, and `renderMoney` cuts them to two by integer division (`handlers.go:608`): truncated, not rounded.
  - Breakpoint: [server.js:158](../../src/currencyservice/server.js#L158). Send `drive product-convert-eur` and inspect `result`.
- [ ] **4. "You may also like"**: Traced from code, not run. Recommendation fetches **all** products, drops this one and samples 5 at random (`recommendation_server.py:73-81`). It returns only ids, so the frontend then calls `GetProduct` once per id (`rpc.go:107`): 1 + 5 calls for one box.
  - See it: Not run here.
- [ ] **5. An ad that matches the product**: This time the frontend sends the product's categories (`handlers.go:199`). `clothing` matches one ad; `tops` matches none.
  - Breakpoint: [AdService.java:101](../../src/adservice/src/main/java/hipstershop/AdService.java#L101). Send `drive product-ads`; it stops once per key.

## 6. Add to cart (traced)

`POST /cart` with `product_id=66VCHSJNUP&quantity=2`. **Traced from code, not run**: neither cart nor Redis runs here. Read along in `src/cartservice/src/cartstore/RedisCartStore.cs`.

[open on the page](explorer.html#flow=add-to-cart)

- [ ] **1. Check the form, and that the product exists**: Traced from code, not run. The quantity must be 1–10 (`validator.go`), and `GetProduct` must find the id (`handlers.go:219-225`), so a made-up id can't land in a cart.
  - See it: Not run here.
- [ ] **2. AddItem for this session**: Traced from code, not run. The cart's user id is the `shop_session-id` cookie (`handlers.go:231`). Anyone who copies that cookie gets the same cart.
  - See it: Not run here.
- [ ] **3. Read the whole cart**: Traced from code, not run. One `GET` by session id (`RedisCartStore.cs:40`). No key yet means a new cart; otherwise the bytes are parsed back into a `Cart` protobuf (`:49`).
  - See it: Not run here.
- [ ] **4. Change it in memory, write it all back**: Traced from code, not run. The item is appended, or its quantity increased (`:50-57`), and the **whole** cart is written back with `SET` (`:60`). Two separate round trips and no lock: two adds at once can lose one (flow 13).
  - Check (changed) **Redis**: key `<session id>`: the whole Cart, now with 66VCHSJNUP × 2 (no expiry)
  - See it: Not run here.
- [ ] **5. Redirect to the cart**: Traced from code, not run. The frontend answers `302 Location: /cart` (`handlers.go:235-236`), so a browser refresh repeats the GET, not the add.
  - See it: Not run here.

## 7. View the cart (traced + run)

`GET /cart` with 2 × Tank Top and 1 × Mug, shopper currency EUR (`src/frontend/handlers.go:251`). Currency steps run for real; the rest traced.

[open on the page](explorer.html#flow=view-cart)

- [ ] **1. Currencies, then the cart**: Traced from code, not run. The same header calls as every page (`handlers.go:254`, `259`), then the cart's items: ids and quantities only, no names or prices.
  - See it: Not run here.
- [ ] **2. Recommendations, excluding what's in the cart**: Traced from code, not run. The cart's product ids are sent as the ones to leave out (`handlers.go:266`). Again 1 + 5 catalog calls.
  - See it: Not run here.
- [ ] **3. A shipping quote, in euros**: Shipping is traced: any non-empty cart costs **8.99 USD** (`quote.go:38`), address and weight ignored. The conversion to EUR ran for real.
  - Breakpoint: [server.js:158](../../src/currencyservice/server.js#L158). Send `drive checkout-eur`; the third stop is the shipping price.
- [ ] **4. Name and price each line**: For each item, `GetProduct` (traced) and `Convert` (run), one item after another (`handlers.go:285`, `290`). A cart of 10 different items is 20 more calls.
  - Breakpoint: [server.js:141](../../src/currencyservice/server.js#L141). Inspect `call.request.from` for each item.
  - Check (gone / not touched) **Any store**: nothing written: viewing the cart only reads

## 8. Place an order (traced + run)

The longest path in the shop: one click on **Place order**, one synchronous call to checkout, nine calls behind it. Cart: 2 × Tank Top + 1 × Mug, currency EUR. Currency and payment ran for real with exactly the requests checkout would send; the rest is traced (`src/checkoutservice/main.go:230`).

[open on the page](explorer.html#flow=place-order)

- [ ] **1. Check the form**: Traced from code, not run. Every field is required; the card number must pass Luhn and the month must be 1–12 (`validator.go:42-53`). A mistyped number stops here with **422** and never reaches payment.
  - See it: Not run here.
- [ ] **2. PlaceOrder, with the cookies as identity**: Traced from code, not run. The user id is the session cookie and the currency is the `shop_currency` cookie, read without checking (`handlers.go:354-370`). The frontend waits for the whole order to finish.
  - See it: Not run here.
- [ ] **3. New order id, read the cart**: Traced from code, not run. A UUID is made (`main.go:233`) and the cart read (`:325`). The id is only ever in memory: no table, no log of orders beyond a log line.
  - See it: Not run here.
- [ ] **4. Price each item in the shopper's currency**: `GetProduct` per item (traced), then `Convert` (run). Checkout calls `Convert` with `context.TODO()` (`main.go:360`), not the request's context: if currency hangs, neither a deadline nor the shopper leaving cancels the call.
  - Breakpoint: [server.js:141](../../src/currencyservice/server.js#L141). Send `drive checkout-eur`; it stops for each item, then for shipping.
  - Why: concept [deadlines L0](explorer.html#concept=deadlines&level=L0)
- [ ] **5. Quote shipping and convert it**: GetQuote is traced (8.99 USD flat); the conversion ran for real.
  - Breakpoint: [server.js:158](../../src/currencyservice/server.js#L158). Inspect `result` on the third stop.
- [ ] **6. Add it up**: Shipping plus price × quantity, in units and nanos (`main.go:243-250`). Nothing rounds to cents, so the total keeps nine decimal places.
  - Why: concept [money L1](explorer.html#concept=money&level=L1)
- [ ] **7. Charge the card**: Payment accepts the sub-cent amount as it is. From this moment the shopper has "paid", and nothing below can undo it: payment has no refund call (`protos/demo.proto:177-179`).
  - Breakpoint: [charge.js:85](../../src/paymentservice/charge.js#L85). Inspect `amount`: 49 units, 500221142 nanos.
  - Check (new) **bx-payment log**: "Transaction processed: visa ending 0454 Amount: EUR49.500221142"
  - Why: concept [order-saga L0](explorer.html#concept=order-saga&level=L0)
- [ ] **8. Ship it**: Traced from code, not run. `ShipOrder` returns a random tracking id; only the address's length goes into it (`main.go:387`, shipping `main.go:147`). If this fails, the card stays charged: flow 12.
  - See it: Not run here.
- [ ] **9. Empty the cart, ignoring errors**: Traced from code, not run. The result is thrown away (`_ = cs.emptyUserCart`, `main.go:263`), so if cart is down the order still succeeds and the items stay in the cart. Redis gets an empty cart, not a deleted key (`RedisCartStore.cs:74-75`).
  - Check (changed) **Redis**: key `<session id>`: an empty Cart (the key stays)
  - See it: Not run here.
- [ ] **10. Send the confirmation**: Traced from code, not run. Emailservice runs in dummy mode only: it logs one line and sends nothing (`email_server.py:110`). An error here is only logged by checkout (`main.go:273-274`).
  - See it: Not run here.
- [ ] **11. Show the confirmation**: Traced from code, not run. The frontend re-adds the total from the order's lines, fetches recommendations (errors ignored) and currencies, and renders order id, tracking id and total (`handlers.go:375-395`).
  - See it: Not run here.

## 9. The card is declined (payment · run, rest traced)

A shopper pays with an Amex card. The frontend's check passes it (the number is valid), payment refuses it, and the shopper gets a **500**. Payment's half ran for real: `drive charge-amex`.

[open on the page](explorer.html#flow=declined)

- [ ] **1. The frontend lets the Amex number through**: Traced from code, not run. The frontend checks only that the number passes Luhn (`validator.go:49`); it doesn't know which brands payment takes. A mistyped number would stop here with 422.
  - See it: Not run here.
- [ ] **2. Checkout prices the order and charges**: Everything in flow 8 up to the charge happens first: cart, catalog, currency, shipping quote. Then payment checks the brand.
  - Breakpoint: [charge.js:74](../../src/paymentservice/charge.js#L74). Send `drive charge-amex`; `cardType` is `amex`.
- [ ] **3. Payment throws, with "code 400"**: The error classes set `this.code = 400` meaning "invalid argument" (`charge.js:33`), and the handler passes the error straight to gRPC (`server.js:48`). 400 isn't a gRPC status (INVALID_ARGUMENT is 3), so callers can't tell a bad card from a broken server.
  - Breakpoint: [server.js:48](../../src/paymentservice/server.js#L48). Inspect `err.code` and `err.message`.
- [ ] **4. Checkout turns it into Internal**: Traced from code, not run. Any charge error becomes `codes.Internal "failed to charge card: …"` (`main.go:253-254`). Nothing after the charge runs: no shipping, cart kept, no email.
  - Check (gone / not touched) **Redis**: untouched: the cart keeps its items
  - See it: Not run here.
- [ ] **5. The shopper sees a server error**: Traced from code, not run. The frontend renders **500** "failed to complete the order" (`handlers.go:371-372`) with the wrapped message. A problem with the shopper's card looks like the shop is broken.
  - See it: Not run here.

## 10. An unknown currency makes the order free (bug · run + traced)

A currency the frontend accepts but currency has no rate for (ARS, Argentine peso) turns every price into **0**, all the way through payment. Currency and payment ran for real (`drive convert-ars-item charge-ars-zero`); the frontend and checkout are traced. **Reported, not fixed.**

[open on the page](explorer.html#flow=zero-currency)

- [ ] **1. POST /setCurrency currency_code=ARS**: Traced from code, not run. The handler checks only that it's an ISO 4217 code (`validator.go:56`); the 6-currency allow-list only fills the drop-down (`rpc.go:38`). Every later request reads the cookie without checking it (`handlers.go:573`).
  - Check (new) **Browser**: cookie `shop_currency` = ARS
  - See it: Not run here.
- [ ] **2. Convert USD → ARS: no rate**: `data["ARS"]` doesn't exist, so it's `undefined`, and dividing or multiplying by it gives `NaN`. JavaScript doesn't throw on that.
  - Breakpoint: [server.js:145](../../src/currencyservice/server.js#L145). Evaluate `data[request.to_code]`: `undefined`.
  - Why: concept [money L2](explorer.html#concept=money&level=L2)
- [ ] **3. NaN all the way down; the catch never runs**: `Math.floor(NaN)` is `NaN`. The `try/catch` around the conversion only catches exceptions, and there are none: a breakpoint on the catch (`server.js:166`) never stopped, even for ARS.
  - Breakpoint: [server.js:158](../../src/currencyservice/server.js#L158). Evaluate `String(result.units)`: `NaN`.
- [ ] **4. On the wire: 0, status OK**: Protobuf has no NaN for integers, so the encoder writes 0. The caller gets a normal reply that says the price is zero.
  - Breakpoint: [server.js:163](../../src/currencyservice/server.js#L163). Inspect `result` just before `callback`.
- [ ] **5. Checkout totals 0, payment charges 0**: Every item and the shipping convert to 0, so the total is ARS 0 (checkout traced). Payment never looks at the amount, only the card, so the charge goes through (run).
  - Breakpoint: [charge.js:85](../../src/paymentservice/charge.js#L85). Inspect `amount`: zero, and nothing checked it.
- [ ] **6. The order ships**: Traced from code, not run. Ship, empty the cart, confirm: the order is placed for ARS 0. Each service did what it was asked; the bug is that no one checks a price is above zero.
  - Check (new) **Order**: a placed order with total ARS 0
  - See it: Not run here.

## 11. Ads are slow: the page drops the ad (measured)

The frontend gives ads **100 ms**, and only the product page shows an ad. Here, the first call after ads starts takes ~650 ms (measured three times, under Rosetta: MEASURED.md M1). The frontend half is traced. Step 5 says when Kubernetes avoids it, and when it doesn't.

[open on the page](explorer.html#flow=ads-slow)

- [ ] **1. The frontend allows 100 ms**: Traced from code, not run. `getAd` wraps the call in `context.WithTimeout(…, 100ms)` (`rpc.go:120`). It's the only per-call deadline in the frontend.
  - See it: Not run here.
- [ ] **2. First call after a start: ~650 ms**: Measured: 643–653 ms on a cold server, against 83–94 ms for a new client on a warm one, so ~550 ms is the server warming up (class loading and JIT on a fresh JVM, most likely; Rosetta makes it worse). Not measured on native amd64.
  - Breakpoint: [AdService.java:99](../../src/adservice/src/main/java/hipstershop/AdService.java#L99). Attach after a fresh `run-services.sh debug`; the first request is slow to reach here too.
  - See it: `docs/explorer/run-services.sh drive $(printf 'ads-none %.0s' {1..20})` right after a start.
  - Why: concept [deadlines L1](explorer.html#concept=deadlines&level=L1)
- [ ] **3. The product page renders without an ad**: Traced from code, not run. The deadline passes, `chooseAd` logs "failed to retrieve ads" and returns nil (`handlers.go:527-531`), and `product.html:81` skips the ad slot. The shopper sees nothing wrong; only the log knows.
  - See it: Not run here.
- [ ] **4. After that, it fits easily**: Every later call took 4–19 ms, well inside 100 ms. So without a probe the cost is one lost ad per ads start.
- [ ] **5. With a readiness probe, the probe pays instead**: Measured: a gRPC health check (what the manifest's readiness probe sends) takes the cold cost itself, 551–623 ms, and the first GetAds after it takes 28–35 ms. But at the manifest's 300m CPU the first health check took 2.9–3.7 s, past the probe's default 1 s timeout, and the first GetAds after it 276–377 ms: the ad is still dropped.
  - See it: `docs/explorer/run-services.sh restart ads && docs/explorer/run-services.sh drive lab-ads-probe-then-ads`
  - Why: concept [deadlines L2](explorer.html#concept=deadlines&level=L2)

## 12. Shipping fails after the card is charged (traced + run)

What happens if `ShipOrder` fails? **Traced from code, not run** (shipping doesn't run here), except the two charges at the end, which ran for real.

[open on the page](explorer.html#flow=ship-fails)

- [ ] **1. The card is charged**: As in flow 8: payment returns a transaction id and checkout logs "payment went through".
  - Breakpoint: [charge.js:85](../../src/paymentservice/charge.js#L85). Send `drive charge`.
- [ ] **2. ShipOrder fails**: Traced from code, not run. Checkout returns `codes.Unavailable "shipping error: …"` at once (`main.go:258-261`). There is no compensation: payment has no refund call to make (`protos/demo.proto:177-179`).
  - Check (new) **Shopper**: charged, with no order
  - Check (gone / not touched) **Redis**: untouched: the cart keeps its items
  - See it: Not run here.
  - Why: concept [order-saga L1](explorer.html#concept=order-saga&level=L1)
- [ ] **3. The shopper sees 500 and tries again**: Traced from code, not run. The cart is still full, so **Place order** works again, and charges again: nothing ties the second attempt to the first.
  - See it: Not run here.
- [ ] **4. Same request, a second charge**: Run for real: the same Charge request sent twice got two different transaction ids. Payment has no idempotency key, so it can't tell a retry from a new purchase.
  - Breakpoint: [server.js:45](../../src/paymentservice/server.js#L45). Send `drive charge charge` and compare the two `response` values.
  - Why: concept [order-saga L0](explorer.html#concept=order-saga&level=L0)

## 13. Two add-to-carts at once (traced)

The same shopper adds two products from two tabs at the same moment. **Traced from code, not run.** The Redis store reads the whole cart, changes it and writes it back, with nothing in between to stop the other request.

[open on the page](explorer.html#flow=lost-update)

- [ ] **1. Both requests read the same cart**: Traced from code, not run. Request A (Mug) and request B (Watch) each `GET` the session's key (`RedisCartStore.cs:40`) before either writes. Both now hold the same cart: 2 × Tank Top.
  - See it: Not run here.
- [ ] **2. Each adds its own item in memory**: Traced from code, not run. A's copy becomes Tank Top + Mug, B's becomes Tank Top + Watch (`:50-57`). Neither knows about the other.
  - See it: Not run here.
- [ ] **3. The second write wins**: Traced from code, not run. Both `SET` the whole cart (`:60`); whichever lands last replaces the other, and both shoppers' requests got a 302 as if all was well. The Spanner store does this inside a transaction (`SpannerCartStore.cs:60`); the Redis one doesn't.
  - Check (changed) **Redis**: cart = Tank Top + Watch: the Mug is gone
  - See it: Not run here.
  - Why: concept [cart-updates L0](explorer.html#concept=cart-updates&level=L0)
