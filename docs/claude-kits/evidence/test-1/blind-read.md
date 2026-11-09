# Blind read of the run-1 draft maps (2026-11-09)

A fresh general-purpose agent (Opus) read the three maps labelled X, Y, Z, against a clean checkout of the copy at
`c7cb6d5b`, with no explorer output in it. Key, revealed after: **X = Sonnet, Y = Haiku, Z = Opus** (`draft-map-<arm>.md` in this folder).
Claims marked ✓ were checked again in the code afterwards.

**Ranking:** Z (Opus), then Y (Haiku), then X (Sonnet). **Clearly worse? No.** None would mislead a newcomer about how
a request moves through the system.

**X (Sonnet):** concise; the ASCII diagram gives the fastest picture; honest about gaps; the only one to notice that
the load generator never schedules `empty_cart` or `logout` (locustfile.py:83-88 ✓). Slips: says the cart's
Health.Check fails when Redis is down, but `Ping()` always returns true (RedisCartStore.cs:106-111 ✓); "Health.Watch
is Unimplemented in several" is misleading, since the Go services register grpc-go's health server; the checkout
sequence leaves out the shipping-cost Convert (checkoutservice/main.go:302 ✓); the product page leaves out
GetSupportedCurrencies; a diagram note sits under the wrong column; few flows have an entry file:line.

**Y (Haiku):** the most accurate checkout sequence (including the shipping Convert), entry refs for every flow,
consistent optional tags, the only one with the optional packaging HTTP call (packaging_info.go:54). Slips: the
load-generator arrow lists `/cart/empty` and `/logout`, which aren't scheduled; says 24 boxes and 5 optional where its
table has 23 and 7; "cart store down" leaves out the product page and add-to-cart; overstates the missing idempotency
(a retry after success finds an empty cart; only concurrent submits double-charge); Phase 0 notes are noise.

**Z (Opus):** the most useful structure (orchestrating against leaf lanes, solid against dashed edges, counts that
match), the best flows (20, all with entry points: the ads timeout degrading the page, 422 on bad input, logout leaving
the cart in Redis), and catches the always-true `Ping()`. Slips: the checkout order hides the per-item Convert and
misses the shipping Convert; says the GCP metadata box is "env-gated, off in base", but `loadDeploymentDetails` runs
from `init` unconditionally (deployment_details.go:19 ✓); leaves out the packaging service; tables only, no diagram.
