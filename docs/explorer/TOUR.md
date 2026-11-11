# Debug tour: the first hour

Online Boutique is 11 services in 5 languages. This tour runs them from Google's v0.10.7 images: first three on their
own (**currency** and **payment** in Node, **ads** in Java), then the **whole shop** in your browser. Those three have
debuggers you can stop in; the Go, C# and Python services run from release images with no debugger, so you watch
them through their logs, their replies and Redis.

Open the page: [`docs/explorer/explorer.html`](explorer.html) (double-click it, or open it from VS Code).

## How deep to go

1. **Run it**: the three services start and answer one request each.
2. **Follow one request**: flow 1 under the debugger, every breakpoint hit.
3. **Follow the real path**: flows 4–8, a shopper from the home page to a placed order, clicking in the real shop.
   Currency, payment and ads steps you can stop in; the rest you watch in the logs.
4. **Break it**: flows 9–13: a declined card, a free order, a dropped ad, a charge with no order, a lost cart item,
   each one made to happen.

## Before you start

- [ ] Docker is running (OrbStack here). **Check:** `docker ps` answers.
- [ ] Node 22 or newer, and a JDK if you want to use `jdb`. **Check:** `node --version`, `jdb -version`.
- [ ] VS Code with the **Debugger for Java** extension (for ads). Node debugging is built in.
- [ ] Docker memory: the containers are capped at the manifests' limits. The three services need 556 MiB of limits
  (currency 128, payment 128, ads 300); the whole shop about 2 GiB (it used about 650 MiB at idle here).

The images are linux/amd64. On an Apple Silicon Mac they run under emulation: everything works, just slower,
especially the first call to ads.

## 1. Run it (5 minutes)

- [ ] Start the three services with their debugger ports:
  ```bash
  docs/explorer/run-services.sh debug
  ```
  **Check:** three lines, `bx-currency`, `bx-payment`, `bx-ads`, all `Up`, every port on `127.0.0.1`.
  Currency is on host port **7001**, not 7000: macOS keeps 7000 for AirPlay.
- [ ] Send one request to each:
  ```bash
  docs/explorer/run-services.sh drive convert charge ads-ctx
  ```
  **Check:** three JSON lines: a EUR amount (`"units":"17","nanos":682441398`), a `transaction_id`, and one ad
  (`Tank top for sale. 20% off.`).
- [ ] Watch a service log while you send a request: `docker logs -f bx-currency` in one terminal, `drive convert`
  in another. **Check:** `conversion request successful`.

`drive.js` is the client: it loads the repo's own `protos/demo.proto` and runs in a throwaway container from the
currency image, which already has the gRPC libraries. Run `drive` with no names to send every scenario; the names
are listed in [`drive.js`](drive.js).

## 1b. The whole shop (10 minutes)

- [ ] Start all 11 services and Redis, with the three debugger ports:
  ```bash
  docs/explorer/run-services.sh down        # if the three are still running
  docs/explorer/run-services.sh shop debug
  ```
  **Check:** 11 `bx-` containers `Up`; only the frontend (`127.0.0.1:8080`) and the three services' ports are
  published.
- [ ] Open http://localhost:8080. The first page after a start can take a second or two, and can log a timed-out
  ads call: that's flow 11. **Check:** nine products.
- [ ] In one terminal `docker logs -f bx-frontend`, in another `docker logs -f bx-cart`. Add something to the cart.
  **Check:** the frontend logs `adding to cart` with the product id; cart logs `AddItemAsync called with userId=…`,
  and that id is your `shop_session-id` cookie (DevTools → Application → Cookies).
- [ ] Look at your cart in Redis: `docker exec bx-redis redis-cli --no-raw HGETALL <your session id>`. **Check:**
  `absexp -1`, `sldexp -1` (it never expires) and the cart's bytes in `data`.

The same walk is scripted: `docs/explorer/shop-session.sh order` saves every page, every service's log lines and the
Redis entry after each step into a folder.

## 2. Follow one request: flow 1 (15 minutes)

[Flow 1 on the page](explorer.html#flow=convert)

- [ ] In VS Code, **Run and Debug** → **Attach · currency (Node, 9229)**. **Check:** the debug toolbar appears,
  and the call stack shows a process.
- [ ] Set breakpoints in [`src/currencyservice/server.js`](../../src/currencyservice/server.js) on lines **141**,
  **145**, **158** and **163**.
- [ ] `docs/explorer/run-services.sh drive convert`. **Check:** it stops on 141. In **Variables**, open
  `call.request`: `from.units` is the **string** `"19"`, `nanos` the number `990000000`.
- [ ] Continue to 145 and evaluate `data[request.to_code]` in the Debug Console. **Check:** `"1.0"`, a string.
- [ ] Continue to 158. **Check:** `result` is `{units: 17, nanos: 682441398}` before the floor.
- [ ] Continue to 163, then let it finish. **Check:** the terminal prints the same numbers.
- [ ] Now the bug: `drive convert-ars-item`. At 145, `data[request.to_code]` is **`undefined`**; at 158, `result`
  is `NaN`. Set a breakpoint on **166** (the `catch`): it never stops. **Check:** the reply is
  `"units":"0","nanos":0` with no error. That's [flow 10](explorer.html#flow=zero-currency).

**If it doesn't stop:**
- Nothing stops at all: the attach went to the wrong port, or the services were started with `up` instead of
  `debug`. `docker ps` should show `127.0.0.1:9229->9229` on `bx-currency`.
- The breakpoint is grey or "unbound": VS Code didn't map the file. The config maps `src/currencyservice` to
  `/usr/src/app` in the container; open the file from that folder, not from somewhere else.
- It stops on a different line than you set: the line isn't a place V8 can stop, so it moved it. Line 146 moves to
  150, for example. Use the lines above.
- The request times out while you're paused: `drive.js` gives each call 60 s. Continue sooner, or send it again.

## 3. Payment and ads: flows 2 and 3 (15 minutes)

- [ ] **Attach · payment (Node, 9230)**, breakpoints in
  [`charge.js`](../../src/paymentservice/charge.js) on **70**, **74**, **80**, **85** and
  [`server.js`](../../src/paymentservice/server.js) on **43** and **48**.
- [ ] `drive charge charge-amex charge-expired charge-invalid`. **Check:** the good card stops at all of 70–85;
  Amex leaves at 74, the expired card at 80, the invalid number at 70; the three failures all reach `server.js:48`
  with `err.code` = **400**.
- [ ] `docker logs bx-payment | grep Charge`. **Check:** the full card number and CVV are in the log
  ([flow 2](explorer.html#flow=charge), step 1).
- [ ] **Attach · ads (Java JDWP, 5005)**, breakpoints in
  [`AdService.java`](../../src/adservice/src/main/java/hipstershop/AdService.java) on **99**, **105**, **107** and
  **124**.
- [ ] `drive product-ads ads-none ads-unknown`. **Check:** `product-ads` stops at 124 twice (`clothing`, then
  `tops`); `ads-none` goes through 105; `ads-unknown` reaches 107 with `allAds.size()` = 0 and falls back to random ads.

**If ads doesn't stop:** lines 99–117 are inside the nested class `AdServiceImpl`. VS Code handles that when you
click the line; in `jdb` you have to say `stop at hipstershop.AdService$AdServiceImpl:99`. Line 124 is in the outer
class: `stop at hipstershop.AdService:124`.

**While paused:** checkout, the real caller, isn't running here, so nothing times out but `drive.js` (60 s). In the
full shop the frontend gives ads only 100 ms: pausing ads for a second means the page renders without an ad.

## 4. The whole shop: flows 4–8 (20 minutes)

[Flow 4 on the page](explorer.html#flow=home)

These follow a shopper: home page, product page, add to cart, view cart, place order. With `shop debug` running and
VS Code attached, click through the shop; every currency, payment and ads breakpoint below was proven to stop on these
clicks. The Go, C# and Python steps show their real logs and replies on the page; watch them with `docker logs -f`.

| Flow | Click | Stop in |
|---|---|---|
| 4 home | open http://localhost:8080 | currency 131, 141 (×9) · ads 105 |
| 5 product | pick **EUR** in the header, then the Tank Top | currency 158 · ads 101, `AdService.java:124` |
| 7 view cart | add 2 Tank Tops and a Mug, open the cart | currency 141, 158 (the last stop is shipping) |
| 8 place order | **Place order** with the form's defaults | payment `charge.js:70`, `74`, `80`, `85` · `server.js:43`, `45` |

**Check** at `charge.js:85`: `amount` is EUR 49 units, **500221142** nanos, and the confirmation page says €49.50.
Nothing rounds to cents. Payment's log has your card number and CVV in full: `docker logs bx-payment | grep Charge`.

**While paused in ads,** the frontend gives up after 100 ms and renders the page without the ad: even an automated
breakpoint that resumed at once dropped it. The product page you get while stopped in ads has no ad; that's expected.

## 5. Break it: flows 9–13

Each failure flow says what the shopper sees and what went wrong underneath, and each one was made to happen in the
real shop with `docs/explorer/shop-session.sh <scenario>` (with `run-services.sh shop` running). Five are worth knowing
before you change anything in this code:

- [ ] [9](explorer.html#flow=declined) `shop-session.sh amex`: an Amex card gets a **500** "Uh, oh!" page, because
  payment's "400" isn't a gRPC status. The cart keeps its item.
- [ ] [10](explorer.html#flow=zero-currency) `shop-session.sh ars`: `/setCurrency` with ARS, a currency with no
  rate, shows every price as **$0.00**, and the order goes through, ships and is confirmed for **$0.00**.
- [ ] [11](explorer.html#flow=ads-slow) `shop-session.sh no-ads`: with ads paused, the product page takes 110 ms
  and has no ad. The first ads call after a start takes ~650 ms here; a readiness probe absorbs that, except at the
  manifest's 300m CPU, where the probe itself takes ~3 s ([MEASURED.md](MEASURED.md) M1, M3).
- [ ] [12](explorer.html#flow=ship-fails) `shop-session.sh ship-fails`: shipping stops after the charge; the
  shopper waits 20 s, gets a 500 and keeps the cart, and **Place order** again charges a second time (M11).
- [ ] [13](explorer.html#flow=lost-update) `shop-session.sh race`: two add-to-carts at once lost an item in 17–18
  carts of 20 (M9).

Also try `shop-session.sh bad-product`: a made-up product id gets a **500**, not a 404.

## When you're done

```bash
docs/explorer/run-services.sh down
```

**Check:** `docker ps --filter name=bx-` is empty. If you started the load generator (`bx-loadgen`, MEASURED.md
M10), `docker rm -f bx-loadgen` first. The images stay; remove them with `docker rmi` on the
`…/microservices-demo/*:v0.10.7` images and `redis:alpine` if you want the space back.

## Where to go next

- [FLOWS.md](FLOWS.md): every step of every flow as a checklist.
- [survey.json](survey.json): every entry point, call and store of all 12 services, each with its line.
- [LABS.md](LABS.md): make the concept ladders happen on your machine (Deadlines, Money, Chatty pages).
- [PROGRESS.md](PROGRESS.md): what was run, what was verified, and the bugs found.
