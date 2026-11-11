// Drives currency, payment and ads over gRPC with the repo's own demo.proto.
// Runs inside a throwaway container from the currency image (it has @grpc/grpc-js and @grpc/proto-loader).
// Usage: node drive.js <scenario> ; scenarios listed at the bottom. With no names: every scenario except shop-*.
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const def = loader.loadSync('/protos/demo.proto', { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
const hs = grpc.loadPackageDefinition(def).hipstershop;
const cred = grpc.credentials.createInsecure();
const currency = new hs.CurrencyService(process.env.CURRENCY || 'bx-currency:7000', cred);
const payment = new hs.PaymentService(process.env.PAYMENT || 'bx-payment:50051', cred);
const ads = new hs.AdService(process.env.ADS || 'bx-ads:9555', cred);
// The rest of the shop (Stage 2b, `run-services.sh shop`): reached by name on the bx-boutique network.
const cart = new hs.CartService('bx-cart:7070', cred);
const catalog = new hs.ProductCatalogService('bx-catalog:3550', cred);
const shipping = new hs.ShippingService('bx-shipping:50051', cred);
const checkout = new hs.CheckoutService('bx-checkout:5050', cred);
const rec = new hs.RecommendationService('bx-rec:8080', cred);
const email = new hs.EmailService('bx-email:8080', cred);

const call = (client, method, req, deadlineMs = 60000) => new Promise((resolve) => {
  const t0 = process.hrtime.bigint();
  const opts = deadlineMs === Infinity ? {} : { deadline: Date.now() + deadlineMs };
  client[method](req, opts, (err, res) => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    resolve(err ? { method, req, ms, error: { code: err.code, codeName: grpc.status[err.code], details: err.details } }
                : { method, req, ms, response: res });
  });
});
const card = (n, m, y) => ({ credit_card_number: n, credit_card_cvv: 123, credit_card_expiration_month: m, credit_card_expiration_year: y });
const usd = (units, nanos) => ({ currency_code: 'USD', units, nanos });

const scenarios = {
  currencies: () => call(currency, 'getSupportedCurrencies', {}),
  convert: () => call(currency, 'convert', { from: usd(19, 990000000), to_code: 'EUR' }),
  'convert-jpy': () => call(currency, 'convert', { from: usd(19, 990000000), to_code: 'JPY' }),
  'convert-bad': () => call(currency, 'convert', { from: usd(19, 990000000), to_code: 'XXX' }),
  charge: () => call(payment, 'charge', { amount: usd(28, 980000000), credit_card: card('4432-8015-6152-0454', 1, 2030) }),
  'charge-expired': () => call(payment, 'charge', { amount: usd(28, 980000000), credit_card: card('4432-8015-6152-0454', 1, 2020) }),
  'charge-amex': () => call(payment, 'charge', { amount: usd(28, 980000000), credit_card: card('378282246310005', 1, 2030) }),
  'charge-invalid': () => call(payment, 'charge', { amount: usd(28, 980000000), credit_card: card('4111111111111112', 1, 2030) }),
  'convert-ars-item': () => call(currency, 'convert', { from: usd(19, 990000000), to_code: 'ARS' }),
  'convert-ars-ship': () => call(currency, 'convert', { from: usd(8, 990000000), to_code: 'ARS' }),
  'charge-ars-zero': () => call(payment, 'charge', { amount: { currency_code: 'ARS', units: 0, nanos: 0 }, credit_card: card('4432-8015-6152-0454', 1, 2030) }),
  // What the frontend sends for the home page in the default currency (rpc.go:78: no-op conversions are not skipped).
  'home-convert-usd': () => call(currency, 'convert', { from: usd(18, 990000000), to_code: 'USD' }),
  // What the product page for the Tank Top (66VCHSJNUP, categories clothing+tops) sends, shopper currency EUR.
  'product-convert-eur': () => call(currency, 'convert', { from: usd(18, 990000000), to_code: 'EUR' }),
  'product-ads': () => call(ads, 'getAds', { context_keys: ['clothing', 'tops'] }),
  // What checkout sends for a cart of 2 x Tank Top (18.99) + 1 x Mug (8.99), shopper currency EUR, then the charge.
  // The total is added up here the way checkout does it (main.go:243-250: shipping + price x quantity, in units/nanos).
  'checkout-eur': async () => {
    const tank = await call(currency, 'convert', { from: usd(18, 990000000), to_code: 'EUR' });
    const mug = await call(currency, 'convert', { from: usd(8, 990000000), to_code: 'EUR' });
    const ship = await call(currency, 'convert', { from: usd(8, 990000000), to_code: 'EUR' });
    const m = (r) => BigInt(r.response.units) * 1000000000n + BigInt(r.response.nanos);
    const totalN = m(ship) + 2n * m(tank) + m(mug);
    const total = { currency_code: 'EUR', units: Number(totalN / 1000000000n), nanos: Number(totalN % 1000000000n) };
    const charge = await call(payment, 'charge', { amount: total, credit_card: card('4432-8015-6152-0454', 1, 2030) });
    return { steps: [tank, mug, ship, { computedTotal: total }, charge] };
  },
  // ---- labs (docs/explorer/LABS.md). Load stays on the bx-boutique Docker network.
  // Deadlines L0: no deadline at all, like checkout's Convert (context.TODO()). Pair with `docker pause bx-currency`.
  'lab-no-deadline': () => call(currency, 'convert', { from: usd(18, 990000000), to_code: 'EUR' }, Infinity),
  // Deadlines L1: a 100 ms per-call deadline, like the frontend's call to ads.
  'lab-deadline-100': () => call(currency, 'convert', { from: usd(18, 990000000), to_code: 'EUR' }, 100),
  // Deadlines L3: does a health check (what a readiness probe sends) warm GetAds up? Run right after an ads restart.
  'lab-ads-probe-then-ads': async () => {
    const hdef = loader.loadSync('/usr/src/app/proto/grpc/health/v1/health.proto', { keepCase: true });
    const health = new (grpc.loadPackageDefinition(hdef).grpc.health.v1.Health)(process.env.ADS || 'bx-ads:9555', cred);
    const probe = await call(health, 'check', { service: '' });
    const first = await call(ads, 'getAds', { context_keys: [] });
    const second = await call(ads, 'getAds', { context_keys: [] });
    return { probeMs: probe.ms, probeStatus: probe.response?.status ?? probe.error, firstGetAdsMs: first.ms, secondGetAdsMs: second.ms };
  },
  // Chatty pages: the home page's 9 Converts, one after another (as handlers.go:84 does) vs all at once. 20 rounds.
  'lab-fanout': async () => {
    const prices = [[19, 990000000], [18, 990000000], [109, 990000000], [89, 990000000], [24, 990000000], [18, 990000000], [18, 490000000], [5, 490000000], [8, 990000000]];
    const one = (p) => call(currency, 'convert', { from: usd(p[0], p[1]), to_code: 'EUR' });
    const seq = [], par = [];
    for (let r = 0; r < 20; r++) {
      let t0 = process.hrtime.bigint(); for (const p of prices) await one(p); seq.push(Number(process.hrtime.bigint() - t0) / 1e6);
      t0 = process.hrtime.bigint(); await Promise.all(prices.map(one)); par.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    return { rounds: 20, sequentialMedianMs: med(seq), parallelMedianMs: med(par), sequential: seq.map((x) => +x.toFixed(1)), parallel: par.map((x) => +x.toFixed(1)) };
  },
  // Chatty pages, 10x: how many Converts per second can one currency container serve? CONC callers for DUR seconds.
  'lab-flood': async () => {
    const conc = Number(process.env.CONC || 4), dur = Number(process.env.DUR || 10) * 1000, lat = [];
    let errors = 0; const end = Date.now() + dur;
    await Promise.all(Array.from({ length: conc }, async () => {
      while (Date.now() < end) { const r = await call(currency, 'convert', { from: usd(18, 990000000), to_code: 'EUR' }, 5000); if (r.error) errors++; else lat.push(r.ms); }
    }));
    lat.sort((a, b) => a - b);
    const q = (p) => +lat[Math.min(lat.length - 1, Math.floor(p * lat.length))].toFixed(1);
    return { concurrency: conc, seconds: dur / 1000, ok: lat.length, errors, perSecond: +(lat.length / (dur / 1000)).toFixed(1), p50: q(0.5), p99: q(0.99) };
  },
  // Money: every product in each of the frontend's 6 currencies. How many prices have more than cents?
  'lab-money-sweep': async () => {
    const prices = [[19, 990000000], [18, 990000000], [109, 990000000], [89, 990000000], [24, 990000000], [18, 990000000], [18, 490000000], [5, 490000000], [8, 990000000]];
    const out = { conversions: 0, subCent: 0, examples: [] };
    for (const cur of ['USD', 'EUR', 'CAD', 'JPY', 'GBP', 'TRY']) for (const p of prices) {
      const r = await call(currency, 'convert', { from: usd(p[0], p[1]), to_code: cur });
      out.conversions++;
      if (r.response.nanos % 10000000 !== 0) { out.subCent++; if (out.examples.length < 4) out.examples.push(`USD ${p[0]}.${String(p[1]).padStart(9, '0')} -> ${cur} ${r.response.units}.${String(r.response.nanos).padStart(9, '0')}`); }
    }
    return out;
  },
  'ads-ctx': () => call(ads, 'getAds', { context_keys: ['clothing'] }),
  'ads-none': () => call(ads, 'getAds', { context_keys: [] }),
  'ads-unknown': () => call(ads, 'getAds', { context_keys: ['no-such-category'] }),
  // ---- the rest of the shop (Stage 2b, needs `run-services.sh shop`). Catalog, shipping and recommendation log little
  // or nothing per request, so these send what the frontend and checkout send and show the reply.
  'shop-catalog-list': async () => { const r = await call(catalog, 'listProducts', {}); return { ms: r.ms, count: r.response.products.length, ids: r.response.products.map((p) => p.id) }; },
  'shop-catalog-get': () => call(catalog, 'getProduct', { id: '66VCHSJNUP' }),
  'shop-catalog-missing': () => call(catalog, 'getProduct', { id: 'NOSUCHITEM' }),
  'shop-rec': () => call(rec, 'listRecommendations', { user_id: 'drive', product_ids: ['66VCHSJNUP'] }),
  'shop-ship-quote': () => call(shipping, 'getQuote', { address: { street_address: '1600 Amphitheatre Parkway', city: 'Mountain View', state: 'CA', country: 'United States', zip_code: 94043 }, items: [{ product_id: '66VCHSJNUP', quantity: 2 }, { product_id: '6E92ZMYYFZ', quantity: 1 }] }),
  'shop-ship-quote-empty': () => call(shipping, 'getQuote', { address: { street_address: '1600 Amphitheatre Parkway', city: 'Mountain View', state: 'CA', country: 'United States', zip_code: 94043 }, items: [] }),
  'shop-ship-order': () => call(shipping, 'shipOrder', { address: { street_address: '1600 Amphitheatre Parkway', city: 'Mountain View', state: 'CA', country: 'United States', zip_code: 94043 }, items: [{ product_id: '66VCHSJNUP', quantity: 2 }] }),
  'shop-cart-get': () => call(cart, 'getCart', { user_id: process.env.SESSION || 'drive-no-such-user' }),
};

(async () => {
  const names = process.argv.slice(2);
  for (const n of (names.length ? names : Object.keys(scenarios).filter((k) => !k.startsWith('shop-')))) {
    console.log(JSON.stringify({ scenario: n, ...(await scenarios[n]()) }));
  }
  // Exit explicitly: after a deadline fires, gRPC keeps retrying the connection and would keep the process alive.
  process.exit(0);
})();
