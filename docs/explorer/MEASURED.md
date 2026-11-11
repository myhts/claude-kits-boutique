# Measured

Every number tagged `measured` on the page comes from a run recorded here.

## M1. Ads: first call after a start, against the frontend's 100 ms timeout

- **When / where:** 2026-11-11, Apple M1 Pro, 16 GB, OrbStack (4 GB VM). The image is linux/amd64, so it runs under
  **Rosetta emulation**; a native amd64 node would likely start faster. Treat the cold number as "this machine", not
  "production".
- **What:** `adservice:v0.10.7`, `--memory 300m --memory-swap 300m` (the manifest's limit), `DISABLE_STATS=1
  DISABLE_TRACING=1`, no debugger. Restarted 3 times. After each start, waited for `Ad Service started, listening on
  9555` plus 2 s, then:
  - **cold server:** one driver process sends 20 `GetAds` with empty context keys;
  - **warm server, fresh client:** a second driver process sends 20 more.
  Comparing the two first calls separates the server's warm-up from the client's own connection setup.
- **Command:**
  ```bash
  docs/explorer/run-services.sh drive $(printf 'ads-none %.0s' {1..20})
  ```
- **Raw output (ms per call):**
  ```
  run 1 cold-server: [648.4, 11.9, 8.2, 7.2, 9.2, 7.4, 7.0, 9.6, 8.2, 14.7, 10.3, 8.2, 10.6, 7.1, 5.6, 7.1, 5.8, 6.8, 5.4, 5.2]
  run 1 warm-server: [82.8, 9.3, 7.8, 6.5, 7.2, 8.8, 9.2, 12.8, 7.5, 14.9, 3.9, 5.8, 6.4, 6.3, 4.5, 7.9, 5.7, 5.5, 6.5, 7.5]
  run 2 cold-server: [652.5, 12.8, 9.0, 6.9, 8.2, 12.5, 9.4, 10.8, 9.3, 16.5, 5.6, 6.7, 8.0, 6.8, 4.4, 9.1, 5.7, 7.9, 9.6, 7.9]
  run 2 warm-server: [93.8, 9.1, 7.3, 7.8, 7.5, 8.7, 7.8, 9.3, 6.6, 16.7, 5.3, 6.3, 6.3, 6.7, 6.0, 8.5, 5.1, 6.5, 6.6, 9.1]
  run 3 cold-server: [642.7, 14.1, 6.9, 6.6, 8.5, 11.2, 7.9, 8.6, 10.5, 18.5, 10.5, 7.6, 7.1, 5.6, 7.1, 9.0, 8.4, 6.3, 7.7, 7.5]
  run 3 warm-server: [91.9, 9.4, 10.2, 6.8, 7.8, 9.2, 8.5, 9.1, 8.5, 15.4, 4.7, 6.9, 6.0, 7.0, 5.0, 11.0, 8.5, 7.7, 6.5, 11.6]
  ```
- **Result:** first call on a cold server 643–653 ms; first call on a warm server with a new client 83–94 ms; every
  later call 4–19 ms. The server's own warm-up is therefore about 550 ms, 5× the frontend's 100 ms ad timeout
  (`src/frontend/rpc.go:120`). Memory after the runs: 179 MiB of 300 MiB.
- **Not measured:** the frontend itself (not run here), so "the product page shows no ad" is the code's consequence
  (`chooseAd` logs and returns nil, `handlers.go:527-531`), not an observed page.
- **Corrected by M3:** the ~550 ms is the server's first gRPC call of *any* kind, not GetAds in particular. In
  Kubernetes the readiness probe makes that first call, so this M1 picture (first real call pays it) is plain
  Docker's, without a probe.

## M2. Memory at idle

`docker stats --no-stream`, right after start, same machine: currency 73 MiB / 128, payment 70 MiB / 128,
ads 131 MiB / 300.

All runs below: 2026-11-11, same machine (Apple M1 Pro, OrbStack 4 GB VM, amd64 images under **Rosetta**), memory
limits from the manifests, no debugger attached (`run-services.sh restart …`). The driver is `drive.js` in a
throwaway container on the same Docker network.

## M3. Ads: does a health check warm it up? (Deadlines L3)

- **What:** restart ads cold, wait 2 s after `listening on 9555`, then in one driver process: one
  `grpc.health.v1.Health/Check` (what the manifest's readiness probe sends: `grpc: port: 9555`), then two `GetAds`.
  Three rounds with no CPU limit, three with `--cpus 0.3` (the manifest's `limits.cpu: 300m`).
- **Command:** `docs/explorer/run-services.sh restart ads` (or `CPUS=0.3 … restart ads`), then
  `docs/explorer/run-services.sh drive lab-ads-probe-then-ads`.
- **Raw output:**
  ```
  round 1 {"probeMs":623.490659,"probeStatus":1,"firstGetAdsMs":34.813252,"secondGetAdsMs":7.59506}
  round 2 {"probeMs":554.052071,"probeStatus":1,"firstGetAdsMs":29.538073,"secondGetAdsMs":8.09602}
  round 3 {"probeMs":551.292814,"probeStatus":1,"firstGetAdsMs":27.530776,"secondGetAdsMs":8.461396}
  cpus=0.3 round 1 (start->listening ~17s) {"probeMs":3230.589404,"probeStatus":1,"firstGetAdsMs":377.246136,"secondGetAdsMs":95.286902}
  cpus=0.3 round 2 (start->listening ~16s) {"probeMs":2880.757883,"probeStatus":1,"firstGetAdsMs":276.133277,"secondGetAdsMs":9.34072}
  cpus=0.3 round 3 (start->listening ~17s) {"probeMs":3744.722552,"probeStatus":1,"firstGetAdsMs":282.997785,"secondGetAdsMs":99.708922}
  ```
  (`probeStatus` 1 = SERVING.)
- **Result:**
  - No CPU limit: the health check takes the cold cost (551–623 ms); the first GetAds after it takes 28–35 ms.
  - At the manifest's 300m CPU: start to listening 16–17 s; the first health check **2.9–3.7 s**, past Kubernetes'
    default probe `timeoutSeconds` of 1 s (the manifest sets none); the first GetAds after it 276–377 ms, still past
    the frontend's 100 ms; the second 9–100 ms.
- **Surprise (re-run 3 times each):** the cold cost isn't GetAds' own; any first call pays it. With a readiness
  probe, Kubernetes would pay it before traffic arrives. Without a CPU limit that would fix the dropped ad; at 300m
  under emulation it doesn't, and the first probe itself would time out. Not tested on a real cluster or native amd64.

## M4. Currency: a call with no deadline vs a 100 ms deadline while currency is frozen (Deadlines L0, L1)

- **What:** `docker pause bx-currency`; start one `Convert` with **no deadline** (as checkout's `context.TODO()` call)
  and one with **100 ms** (as the frontend's ads call); unpause 5 s after the 100 ms call returns.
- **Command:** see LABS.md, Deadlines L0. Scenarios `lab-no-deadline` and `lab-deadline-100`.
- **Raw output (3 valid rounds):**
  ```
  round 2 no-deadline:  "ms":5390.831375 "units":"16"
  round 2 deadline-100: "ms":115.710481 "codeName":"DEADLINE_EXCEEDED"
  round 3 no-deadline:  "ms":5377.462107 "units":"16"
  round 3 deadline-100: "ms":115.19673 "codeName":"DEADLINE_EXCEEDED"
  round 4 no-deadline:  "ms":5348.677831 "units":"16"
  round 4 deadline-100: "ms":116.268773 "codeName":"DEADLINE_EXCEEDED"
  ```
  Round 1 is discarded: the shell refused to overwrite the earlier run's files, so it recorded nothing new.
- **Result:** with no deadline the caller waits exactly as long as currency is frozen (5.35–5.39 s, then succeeds).
  With 100 ms it fails in 115–116 ms with `DEADLINE_EXCEEDED`. In a first, broken attempt (pause never undone), a
  no-deadline call was still waiting after **more than 3 minutes**.
- **Lesson:** after a deadline fires, gRPC-js keeps retrying the connection, so the client process didn't exit and
  the script waited on it forever. `drive.js` now calls `process.exit`.

## M5. Currency: the home page's 9 conversions, one after another vs all at once (Chatty pages L0, L2)

- **What:** 20 rounds of the 9 product prices USD → EUR, sequentially (as `handlers.go:84` does) and with
  `Promise.all`. With no CPU limit, and at the manifest's `limits.cpu: 200m` (`CPUS=0.2 … restart currency`).
- **Command:** `docs/explorer/run-services.sh drive lab-fanout`
- **Raw output (ms per round):**
  ```
  no limit  sequential [168.1,24.7,25.7,19.2,16.2,11.7,14.2,51.3,13.2,18.4,14.6,17.5,12,15.2,28.6,14.8,10.8,14.1,12.6,9.7]
            parallel   [23.5,17.2,9.2,10.3,9,8.1,33.1,5.5,5.3,7.1,4.7,4.5,5.8,9.9,6.1,5.8,4.4,5.4,4.5,5.2]
  cpus 0.2  sequential [148.4,100.1,274.5,198.6,93.6,86.1,92.5,148.9,18.1,96.7,15.2,93.8,16.1,12.6,276.8,18.6,15.1,84.3,14.7,12.6]
            parallel   [90.9,18.4,103.6,16.7,10.4,10.3,9.7,8.8,5.2,9.1,76.7,7.9,80.2,8.3,9.1,68.3,5,12.7,73.4,5.4]
  ```
- **Result:** medians, no limit: sequential **15.2 ms**, parallel **6.1 ms**. At 200m: sequential **92.5 ms**,
  parallel **10.4 ms**.
- **Surprise:** at 200m the sequential rounds are either 12–19 ms or 84–277 ms, nothing between. That looks like
  the CPU quota: 200m is 20 ms of CPU per 100 ms period, and a round that runs out waits for the next period. The
  more round trips a page makes, the more likely it crosses a period. (Explanation, not measured directly.)

## M6. Currency: throughput of one container at its manifest CPU (Chatty pages, 10×)

- **What:** `CPUS=0.2 … restart currency`; 1, 4 and 16 concurrent callers send `Convert` for 10 s each.
- **Command:** `CONC=4 DUR=10 docs/explorer/run-services.sh drive lab-flood`
- **Raw output:**
  ```
  {"concurrency":1,"seconds":10,"ok":2588,"errors":0,"perSecond":258.8,"p50":1,"p99":69.8}
  {"concurrency":4,"seconds":10,"ok":6236,"errors":0,"perSecond":623.6,"p50":2.3,"p99":73.3}
  {"concurrency":16,"seconds":10,"ok":8592,"errors":0,"perSecond":859.2,"p50":7.6,"p99":111.3}
  ```
  The first concurrency-4 run printed nothing (no error shown); the line above is its re-run.
- **Result:** one currency container at 200m served **~860 Converts/s** with 16 callers, p99 111 ms; no errors.
  Memory after: 85 MiB of 128.

## M7. Money: how many converted prices have more than cents? (Money L2)

- **What:** the 9 catalog prices converted into each of the frontend's 6 currencies.
- **Command:** `docs/explorer/run-services.sh drive lab-money-sweep`
- **Raw output:**
  ```
  {"conversions":54,"subCent":45,"examples":["USD 19.990000000 -> EUR 17.682441398","USD 18.990000000 -> EUR 16.797877046","USD 109.990000000 -> EUR 97.293233083","USD 89.990000000 -> EUR 79.601946042"]}
  ```
- **Result:** **45 of 54** have digits below the cent: every conversion except USD → USD. The page truncates them
  (`renderMoney`, `handlers.go:608`); checkout adds them up and charges them as they are.

## M8. Currency and payment: a currency with no rate, and the same charge twice (Money L2, Charge-then-ship L0)

- **What:** single requests with `drive.js`, services as started by `run-services.sh` (no CPU limit).
- **Commands:** `docs/explorer/run-services.sh drive convert-ars-item convert-ars-ship charge-ars-zero`;
  `docs/explorer/run-services.sh drive charge`, run twice.
- **Raw output:**
  ```
  convert-ars-item  USD 19.99 -> {"currency_code":"ARS","units":"0","nanos":0}   status OK
  convert-ars-ship  USD 8.99  -> {"currency_code":"ARS","units":"0","nanos":0}   status OK
  charge-ars-zero   {"currency_code":"ARS","units":0,"nanos":0} -> "transaction_id":"56444a05-2859-4779-84f1-c944629b7abe"
  charge (1st)      USD 28.98, 4432-…-0454, 1/2030 -> "transaction_id":"e1fe79b0-1d90-439b-bd14-2f6086ffec11"
  charge (2nd)      the same request              -> "transaction_id":"10a5c47f-407d-48b9-b1c1-0c64902d60d4"
  ```
- **Result:** a currency with no rate converts to 0 with status OK, and payment charges 0. The same Charge request
  twice gives two different transaction ids: nothing makes a retry safe.
