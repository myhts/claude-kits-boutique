#!/usr/bin/env bash
# Shoppers through the real shop (Stage 2b), the way a browser would: the same URLs and form fields as the frontend's
# templates. After every step it saves what each service logged during it, the cart's Redis entry, the HTTP status
# and time, and the page.
#   docs/explorer/run-services.sh shop                  # first (or `shop debug` to stop in currency, payment, ads)
#   docs/explorer/shop-session.sh <scenario> [out-dir]  # out-dir default: a new folder under ${TMPDIR:-/tmp}
# Scenarios:
#   order        home → EUR → product → add 2 Tank Top + 1 Mug → cart → place order → add → empty cart (flows 4–8, 14, 15)
#   amex         a cart paid with a public Amex test number (flow 9)
#   ars          currency ARS, then the same kind of order (flow 10)
#   no-ads       product page with ads paused (`docker pause bx-ads`), then unpaused (flow 11)
#   bad-product  add a product id that doesn't exist, and a quantity of 11 (flow 6)
#   ship-fails   shipping stops after the card is charged, then the shopper tries again (flow 12)
#   race         N shoppers (3rd argument, default 20), each adds a Tank Top, then a Mug and a Watch at the same moment; counts lost items (flow 13)
# Every request goes to 127.0.0.1:8080 only. The card number is the checkout form's own default, without dashes
# (cart.html:168): the frontend's validator rejects the dashed form.
set -euo pipefail
FE=http://127.0.0.1:8080
SCENARIO=${1:-order}
OUT=${2:-$(mktemp -d "${TMPDIR:-/tmp}/shop-$SCENARIO.XXXX")}
mkdir -p "$OUT"; JAR="$OUT/cookies.txt"; : > "$JAR"
SERVICES="frontend checkout cart catalog currency rec shipping payment email ads"
n=0

sid() { awk '$6=="shop_session-id"{print $7}' "${1:-$JAR}" | tail -1; }

step() {   # step <name> <curl args…>
  local name=$1; shift; n=$((n + 1))
  local f; f=$(printf '%s/%02d-%s' "$OUT" "$n" "$name")
  local since; since=$(node -p 'new Date().toISOString()')
  curl -s -b "$JAR" -c "$JAR" -o "$f.html" -D "$f.headers" \
    -w 'status=%{http_code} time=%{time_total}s redirect=%{redirect_url}\n' "$@" > "$f.http"
  { for s in $SERVICES; do
      local l; l=$(docker logs --since "$since" bx-$s 2>&1 | grep -v -E 'grpc.health|health check|/_healthz' || true)
      [[ -n $l ]] && printf '== %s\n%s\n' "$s" "$l"
    done; } > "$f.logs"
  local s; s=$(sid)
  { echo "session=$s"; [[ -n $s ]] && docker exec bx-redis redis-cli --no-raw HGETALL "$s"; } > "$f.redis" 2>&1
  printf '%-14s %s\n' "$name" "$(cat "$f.http")"
}

place_order() {     # place_order <step name> <card number>
  step "$1" -X POST -d email=someone@example.com -d "street_address=1600 Amphitheatre Parkway" -d zip_code=94043 \
    -d "city=Mountain View" -d state=CA -d "country=United States" -d "credit_card_number=$2" \
    -d credit_card_expiration_month=1 -d credit_card_expiration_year=2030 -d credit_card_cvv=672 "$FE/cart/checkout"
}

case "$SCENARIO" in
  order)
    step home          "$FE/"
    step set-currency  -X POST -d currency_code=EUR "$FE/setCurrency"
    step product       "$FE/product/66VCHSJNUP"
    step add-tank      -X POST -d product_id=66VCHSJNUP -d quantity=2 "$FE/cart"
    step add-mug       -X POST -d product_id=6E92ZMYYFZ -d quantity=1 "$FE/cart"
    step view-cart     "$FE/cart"
    place_order checkout 4432801561520454
    step add-again     -X POST -d product_id=OLJCESPC7Z -d quantity=1 "$FE/cart"
    step empty-cart    -X POST "$FE/cart/empty" ;;
  amex)
    step home          "$FE/"
    step add-tank      -X POST -d product_id=66VCHSJNUP -d quantity=1 "$FE/cart"
    place_order checkout-amex 378282246310005
    step view-cart     "$FE/cart" ;;
  ars)
    step home          "$FE/"
    step set-currency  -X POST -d currency_code=ARS "$FE/setCurrency"
    step home-ars      "$FE/"
    step add-tank      -X POST -d product_id=66VCHSJNUP -d quantity=2 "$FE/cart"
    step view-cart     "$FE/cart"
    place_order checkout-ars 4432801561520454 ;;
  no-ads)
    step product-warm  "$FE/product/66VCHSJNUP"
    docker pause bx-ads >/dev/null
    step product-paused "$FE/product/66VCHSJNUP"
    docker unpause bx-ads >/dev/null
    step product-after "$FE/product/66VCHSJNUP" ;;
  bad-product)
    step home          "$FE/"
    step add-bogus     -X POST -d product_id=NOSUCHITEM -d quantity=1 "$FE/cart"
    step add-11        -X POST -d product_id=66VCHSJNUP -d quantity=11 "$FE/cart" ;;
  ship-fails)
    # Shipping must fail *after* the charge: checkout asks shipping for a quote before it charges. So payment is frozen
    # (`docker pause`), the order is sent, and once checkout has its quote and is waiting on payment, shipping is
    # stopped and payment let go. Then shipping comes back and the shopper presses Place order again.
    step home          "$FE/"
    step add-tank      -X POST -d product_id=66VCHSJNUP -d quantity=1 "$FE/cart"
    docker pause bx-payment >/dev/null
    t0=$(node -p 'new Date().toISOString()')
    place_order checkout-ship-down 4432801561520454 &
    for _ in $(seq 1 100); do docker logs --since "$t0" bx-shipping 2>&1 | grep -q 'GetQuote\] completed' && break; sleep 0.1; done
    docker stop -t 1 bx-shipping >/dev/null
    docker unpause bx-payment >/dev/null
    wait
    n=$((n + 1))   # the background step counted in its own subshell
    docker start bx-shipping >/dev/null
    for _ in $(seq 1 50); do docker logs bx-shipping 2>&1 | tail -1 | grep -q listening && break; sleep 0.2; done
    step view-cart     "$FE/cart"
    place_order checkout-retry 4432801561520454 ;;
  race)
    trials=${3:-20}; lost=0
    for i in $(seq 1 "$trials"); do
      j="$OUT/race-$i.txt"; : > "$j"
      curl -s -c "$j" -o /dev/null "$FE/"
      curl -s -b "$j" -o /dev/null -X POST -d product_id=66VCHSJNUP -d quantity=1 "$FE/cart"
      curl -s -b "$j" -o /dev/null -w '%{http_code}' -X POST -d product_id=6E92ZMYYFZ -d quantity=1 "$FE/cart" > "$j.a" &
      curl -s -b "$j" -o /dev/null -w '%{http_code}' -X POST -d product_id=1YMWWN1N4O -d quantity=1 "$FE/cart" > "$j.b" &
      wait
      raw=$(docker exec bx-redis redis-cli --no-raw HGET "$(sid "$j")" data)
      items=0; for p in 66VCHSJNUP 6E92ZMYYFZ 1YMWWN1N4O; do [[ $raw == *$p* ]] && items=$((items + 1)); done
      [[ $items -lt 3 ]] && lost=$((lost + 1))
      echo "trial $i: $items of 3 items in the cart · replies $(cat "$j.a") $(cat "$j.b")   $raw" >> "$OUT/race.log"
    done
    echo "race: $lost of $trials carts lost an item (details: $OUT/race.log)" ;;
  *) echo "scenario: order|amex|ars|no-ads|bad-product|ship-fails|race"; exit 1 ;;
esac
echo "out=$OUT"
