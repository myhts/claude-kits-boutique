# Debug tour: the first hour

Online Boutique is 11 services in 5 languages. This tour runs three of them for real (**currency** and **payment**
in Node, **ads** in Java) from Google's v0.10.7 images, and follows requests through them with a debugger. The rest
of the shop is on the page too, traced from the code and marked that way.

Open the page: [`docs/explorer/explorer.html`](explorer.html) (double-click it, or open it from VS Code).

## How deep to go

1. **Run it**: the three services start and answer one request each.
2. **Follow one request**: flow 1 under the debugger, every breakpoint hit.
3. **Follow the real path**: flows 4–8, a shopper from the home page to a placed order. Currency, payment and ads
   steps you can stop in; the rest you read along.
4. **Break it**: flows 9–13: a declined card, a free order, a dropped ad, a charge with no order, a lost cart item.

## Before you start

- [ ] Docker is running (OrbStack here). **Check:** `docker ps` answers.
- [ ] Node 22 or newer, and a JDK if you want to use `jdb`. **Check:** `node --version`, `jdb -version`.
- [ ] VS Code with the **Debugger for Java** extension (for ads). Node debugging is built in.
- [ ] About 600 MB of free Docker memory: the containers are capped at the manifests' limits
  (currency 128 MiB, payment 128 MiB, ads 300 MiB).

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

These follow a shopper: home page, product page, add to cart, view cart, place order. Steps marked **traced from
code, not run** have a code reference in the text and no breakpoint; open the file and read along. Steps that went
through currency, payment or ads have the real data and a breakpoint you can hit with the matching `drive` scenario:

| Flow | Send | Stop in |
|---|---|---|
| 4 home | `drive currencies home-convert-usd ads-none` | currency 131, 141 · ads 105 |
| 5 product | `drive product-convert-eur product-ads` | currency 158 · ads 101 |
| 7 view cart, 8 place order | `drive checkout-eur` | currency 141, 158 · payment `charge.js:85` |

`checkout-eur` sends exactly what checkout would for a cart of 2 × Tank Top + 1 × Mug in EUR. **Check** at
`charge.js:85`: `amount` is EUR 49 units, **500221142** nanos. Nothing rounds to cents.

## 5. Break it: flows 9–13

Each failure flow says what the shopper sees and what went wrong underneath. Five are worth knowing before you
change anything in this code:

- [ ] [9](explorer.html#flow=declined): an Amex card gets a **500**, because payment's "400" isn't a gRPC status.
- [ ] [10](explorer.html#flow=zero-currency): `/setCurrency` with a currency that has no rate makes every price,
  and the whole order, **0**.
- [ ] [11](explorer.html#flow=ads-slow): the first ads call after a start takes ~650 ms here, and the product page
  drops the ad. A readiness probe absorbs that, except at the manifest's 300m CPU, where the probe itself takes
  ~3 s. Measure it yourself: [MEASURED.md](MEASURED.md) M1 and M3.
- [ ] [12](explorer.html#flow=ship-fails): a shipping failure after the charge leaves the shopper charged, and a
  retry charges again.
- [ ] [13](explorer.html#flow=lost-update): two add-to-carts at once can lose one item.

## When you're done

```bash
docs/explorer/run-services.sh down
```

**Check:** `docker ps --filter name=bx-` is empty. The images stay (about 950 MB); remove them with
`docker rmi` on the three `…/microservices-demo/*:v0.10.7` images if you want the space back.

## Where to go next

- [FLOWS.md](FLOWS.md): every step of every flow as a checklist.
- [survey.json](survey.json): every entry point, call and store of all 12 services, each with its line.
- [LABS.md](LABS.md): make the concept ladders happen on your machine (Deadlines, Money, Chatty pages).
- [PROGRESS.md](PROGRESS.md): what was run, what was verified, and the bugs found.
