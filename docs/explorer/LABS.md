# Labs

Each lab makes one level of a concept happen on your machine. Run them in order: each level's problem is the previous level's cost.

<!-- generated below: edit the data, not this part -->

## Deadlines across a call chain

How long may one call wait for another? In this shop exactly one call has an answer (the frontend gives ads 100 ms); checkout's calls to currency have none at all. From no deadline to one budget for the whole request.

### L0 · No deadline

*Currency freezes. How long does checkout wait?* [open on the page](explorer.html#concept=deadlines&level=L0)

Config: **services started with docs/explorer/run-services.sh up, no debugger attached**

- [ ] `docs/explorer/run-services.sh restart currency`, then `docker pause bx-currency`.
- [ ] Terminal 1: `docs/explorer/run-services.sh drive lab-no-deadline`. **Check:** nothing comes back.
- [ ] Terminal 2: `docs/explorer/run-services.sh drive lab-deadline-100`. **Check:** `DEADLINE_EXCEEDED`, `ms` ≈ 115.
- [ ] `docker unpause bx-currency`. **Check:** terminal 1 prints a EUR amount, `ms` ≈ how long currency was frozen.
- [ ] Breakpoint: [server.js:141](../../src/currencyservice/server.js#L141). With currency paused nothing stops here; it stops the moment you unpause.

What we measured (2026-11-11, Apple M1 Pro, OrbStack 4 GB, amd64 images under Rosetta): Convert with a 100 ms deadline: **115–116 ms, DEADLINE_EXCEEDED**. Yours will differ; the shape shouldn't.

### L1 · Warm up before traffic

*Ads answers in 4–19 ms. Why does a product page lose its ad after a restart?* [open on the page](explorer.html#concept=deadlines&level=L1)

Config: **services started with docs/explorer/run-services.sh up, no debugger attached**

- [ ] `docs/explorer/run-services.sh restart ads`.
- [ ] `docs/explorer/run-services.sh drive lab-ads-probe-then-ads`. **Check:** `probeMs` ≈ 550–650, `firstGetAdsMs` under 100.
- [ ] `restart ads` again, then `drive ads-none`. **Check:** `ms` ≈ 650: without a probe, the real call pays.
- [ ] Breakpoint: [AdService.java:99](../../src/adservice/src/main/java/hipstershop/AdService.java#L99). Attach right after a restart: the first request is slow to arrive here.

What we measured (2026-11-11, Apple M1 Pro, OrbStack 4 GB, amd64 images under Rosetta): First GetAds after a health check: **28–35 ms**. Yours will differ; the shape shouldn't.

## Money as integers

Prices travel as two integers, `units` and `nanos`. That fixes floats on the wire, but nothing rounds to cents and nothing refuses an impossible price. Both found by running currency and payment.

### L0 · Floats

*Why not keep 19.99 as a plain number?* [open on the page](explorer.html#concept=money&level=L0)

Config: **services started with docs/explorer/run-services.sh debug, then Attach · currency**

- [ ] Breakpoint on `server.js:119`.
- [ ] `docs/explorer/run-services.sh drive convert`. **Check:** on the first stop, `amount.units` is `16.80672268907563`.
- [ ] Breakpoint: [server.js:119](../../src/currencyservice/server.js#L119). Inspect `amount`: the float before it's carried into nanos.

### L1 · Round to the currency's unit (proposed: not built)

*Integers on the wire. Why do 45 of 54 prices have more than cents?* [open on the page](explorer.html#concept=money&level=L1)

Config: **services started with docs/explorer/run-services.sh up, no debugger attached**

- [ ] `docs/explorer/run-services.sh drive lab-money-sweep`. **Check:** `subCent: 45` of `conversions: 54`.
- [ ] `docs/explorer/run-services.sh drive checkout-eur`. **Check:** the charge's amount has `nanos: 500221142`.
- [ ] Breakpoint: [server.js:158](../../src/currencyservice/server.js#L158). Inspect `result`: nine decimals, about to be floored.

### L2 · Refuse what you can't price (proposed: not built)

*What does currency do with a code it has no rate for?* [open on the page](explorer.html#concept=money&level=L2)

Config: **services started with docs/explorer/run-services.sh debug, then Attach · currency**

- [ ] Breakpoints on `server.js:145` and `server.js:166` (the catch).
- [ ] `docs/explorer/run-services.sh drive convert-ars-item`. **Check:** at 145, `data[request.to_code]` is `undefined`; 166 never stops; the reply is `"units":"0"`.
- [ ] `docs/explorer/run-services.sh drive charge-ars-zero`. **Check:** a transaction id comes back.
- [ ] Breakpoint: [server.js:145](../../src/currencyservice/server.js#L145). Evaluate `data[request.to_code]`: undefined.

## Chatty pages: one call per price

The home page makes 13 gRPC calls one after another, 9 of them to currency, even for a shopper in dollars. What that costs, measured against the real currency service, and what 10× traffic changes.

### L0 · One call per price, in order

*One home page, 13 calls. Where does the time go?* [open on the page](explorer.html#concept=chatty&level=L0)

Config: **currency at the manifest's CPU: CPUS=0.2 docs/explorer/run-services.sh restart currency**

- [ ] `docs/explorer/run-services.sh drive lab-fanout`. **Check:** `sequentialMedianMs` ≈ 90 at 200m (≈ 15 without the limit: `restart currency` with no CPUS).
- [ ] `docs/explorer/run-services.sh drive home-convert-usd`. **Check:** a USD → USD call still goes to currency and comes back unchanged.
- [ ] Breakpoint: [server.js:141](../../src/currencyservice/server.js#L141). Send `drive home-convert-usd`: it stops though nothing needs converting.

### L1 · Ask for all nine at once (proposed: not built)

*A EUR shopper still needs 9 prices. Why wait for each before asking for the next?* [open on the page](explorer.html#concept=chatty&level=L1)

Config: **currency at the manifest's CPU: CPUS=0.2 docs/explorer/run-services.sh restart currency**

- [ ] `docs/explorer/run-services.sh drive lab-fanout`. **Check:** `parallelMedianMs` far below `sequentialMedianMs`.

### L2 · Ten times the shoppers (proposed: not built)

*At 10× today's traffic, does currency need more instances?* [open on the page](explorer.html#concept=chatty&level=L2)

Config: **currency at the manifest's CPU: CPUS=0.2 docs/explorer/run-services.sh restart currency**

- [ ] `CONC=16 DUR=10 docs/explorer/run-services.sh drive lab-flood`. **Check:** `perSecond` in the hundreds (≈ 860 here), `errors: 0`.
- [ ] `docker stats --no-stream bx-currency`. **Check:** memory well under 128 MiB (85 MiB here).

## Self-check

Answer without the page, then check:

- [ ] Deadlines across a call chain L0: Currency freezes. How long does checkout wait?
- [ ] Deadlines across a call chain L1: Ads answers in 4–19 ms. Why does a product page lose its ad after a restart?
- [ ] Money as integers L0: Why not keep 19.99 as a plain number?
- [ ] Money as integers L1: Integers on the wire. Why do 45 of 54 prices have more than cents?
- [ ] Money as integers L2: What does currency do with a code it has no rate for?
- [ ] Chatty pages: one call per price L0: One home page, 13 calls. Where does the time go?
- [ ] Chatty pages: one call per price L1: A EUR shopper still needs 9 prices. Why wait for each before asking for the next?
- [ ] Chatty pages: one call per price L2: At 10× today's traffic, does currency need more instances?
