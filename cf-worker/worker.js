// Biblioteczka — funkcje proxy (Cloudflare Worker)
// Zastępuje wcześniejsze funkcje Netlify: upc-lookup, bn-lookup, omdb, google-books.
// Sekrety (OMDB_API_KEY, GOOGLE_BOOKS_API_KEY) trzymane w Cloudflare (wrangler secret), nie w kodzie.

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

function json(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: CORS });
}

async function handleUpcLookup(url) {
  const upc = url.searchParams.get('upc');
  if (!upc) return json({ error: 'missing upc' }, 400);
  const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`);
  return json(await res.text(), res.status);
}

async function handleBnLookup(url) {
  const isbn = url.searchParams.get('isbn');
  if (!isbn) return json({ error: 'missing isbn' }, 400);
  const res = await fetch(`https://data.bn.org.pl/api/institutions/bibs.json?isbnIssn=${encodeURIComponent(isbn)}&limit=1`);
  return json(await res.text(), res.status);
}

async function handleOmdb(url, env) {
  const key = env.OMDB_API_KEY;
  if (!key) return json({ Response: 'False', Error: 'OMDB_API_KEY not configured' });
  const omdbUrl = new URL('https://www.omdbapi.com/');
  omdbUrl.searchParams.set('apikey', key);
  for (const p of ['t', 's', 'i', 'type']) {
    const v = url.searchParams.get(p);
    if (v) omdbUrl.searchParams.set(p, v);
  }
  const res = await fetch(omdbUrl.toString());
  return json(await res.text(), res.status);
}

async function handleGoogleBooks(url, env) {
  const isbn = url.searchParams.get('isbn');
  if (!isbn) return json({ error: 'missing isbn' }, 400);
  const key = env.GOOGLE_BOOKS_API_KEY;
  const gbUrl = new URL('https://www.googleapis.com/books/v1/volumes');
  gbUrl.searchParams.set('q', `isbn:${isbn}`);
  if (key) gbUrl.searchParams.set('key', key);

  let res, body;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(gbUrl.toString());
    body = await res.text();
    if (res.status < 500) break;
    if (attempt === 0) await new Promise(r => setTimeout(r, 600));
  }
  return json(body, res.status);
}

async function handleTmdb(url, env) {
  const key = env.TMDB_API_KEY;
  if (!key) return json({ success: false, status_message: 'TMDB_API_KEY not configured' });
  // s=tytuł -> wyszukiwanie; i=id filmu -> szczegóły
  const id = url.searchParams.get('i');
  const tmdbUrl = new URL(id
    ? `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}`
    : `https://api.themoviedb.org/3/search/movie`);
  tmdbUrl.searchParams.set('api_key', key);
  tmdbUrl.searchParams.set('language', 'pl-PL');
  const q = url.searchParams.get('s');
  if (q) tmdbUrl.searchParams.set('query', q);
  if (id) tmdbUrl.searchParams.set('append_to_response', 'credits');
  const res = await fetch(tmdbUrl.toString());
  return json(await res.text(), res.status);
}

// ---------------- Wyceny rynkowe (CEX + eBay) ----------------
// Zwracają zwykłe obiekty (nie Response) — dzięki temu handleMarketPrice() i cron
// (scheduled(), na dole pliku) mogą je wołać bezpośrednio, bez sztucznego
// opakowywania w fetch/Response.

// CEX (webuy.com) — nieoficjalne, ale publiczne (bez klucza) API po kodzie kreskowym.
// Ceny w GBP (sklep brytyjski) — celowo nie przeliczamy na inną walutę.
async function cexLookup(barcode) {
  try {
    const res = await fetch(`https://wss2.cex.uk.webuy.io/v3/boxes/${encodeURIComponent(barcode)}/detail`);
    if (!res.ok) return { found: false, source: 'CEX' };
    const data = await res.json();
    const box = data?.response?.data?.boxDetails?.[0];
    if (!box) return { found: false, source: 'CEX' };
    return {
      found: true,
      source: 'CEX',
      name: box.boxName || '',
      sellPrice: box.sellPrice ?? null,   // za tyle CEX sprzedaje — najlepszy odpowiednik "ceny rynkowej"
      cashPrice: box.cashPrice ?? null,   // za tyle CEX skupuje gotówką — dolna granica wartości odsprzedaży
      exchangePrice: box.exchangePrice ?? null,
      currency: 'GBP'
    };
  } catch (e) {
    return { found: false, source: 'CEX', error: String(e) };
  }
}

// eBay Browse API — token aplikacyjny (client_credentials, bez logowania użytkownika)
// cache'owany w pamięci Workera na czas życia izolatu, żeby nie pytać o token przy
// każdym pojedynczym wyszukiwaniu w paczce crona.
let ebayTokenCache = { token: null, expiresAt: 0 };
async function getEbayToken(env) {
  if (ebayTokenCache.token && Date.now() < ebayTokenCache.expiresAt) return ebayTokenCache.token;
  const creds = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${creds}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('eBay token error: ' + JSON.stringify(data));
  ebayTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return ebayTokenCache.token;
}

// Uwaga: to ceny AKTYWNYCH ofert (Browse API), nie faktycznie sprzedanych — dostęp do
// historii sprzedanych ofert (Marketplace Insights API) wymaga specjalnej zgody eBay
// Partner Network, niedostępnej dla zwykłego konta deweloperskiego. To przybliżenie
// "za ile inni teraz sprzedają", nie prawdziwa cena rynkowa transakcji.
async function ebayLookup(q, env) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
    return { found: false, source: 'eBay', error: 'EBAY_CLIENT_ID/EBAY_CLIENT_SECRET not configured' };
  }
  try {
    const token = await getEbayToken(env);
    const marketplace = env.EBAY_MARKETPLACE_ID || 'EBAY_DE';
    const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('limit', '30');
    const res = await fetch(searchUrl.toString(), {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketplace }
    });
    const data = await res.json();
    const prices = (data.itemSummaries || []).map(i => parseFloat(i.price?.value)).filter(n => !isNaN(n));
    if (!prices.length) return { found: false, source: 'eBay' };
    prices.sort((a, b) => a - b);
    return {
      found: true,
      source: 'eBay',
      low: prices[0],
      high: prices[prices.length - 1],
      median: prices[Math.floor(prices.length / 2)],
      count: prices.length,
      currency: data.itemSummaries[0]?.price?.currency || 'EUR'
    };
  } catch (e) {
    return { found: false, source: 'eBay', error: String(e) };
  }
}

async function handleCexPrice(url) {
  const barcode = url.searchParams.get('barcode');
  if (!barcode) return json({ error: 'missing barcode' }, 400);
  return json(await cexLookup(barcode));
}

async function handleEbayPrice(url, env) {
  const q = url.searchParams.get('q');
  if (!q) return json({ error: 'missing q' }, 400);
  return json(await ebayLookup(q, env));
}

// Punkt wejścia używany przez appkę (przycisk "Sprawdź cenę teraz") — jedno zapytanie
// zamiast dwóch osobnych wywołań z klienta.
async function handleMarketPrice(url, env) {
  const barcode = url.searchParams.get('barcode');
  const q = url.searchParams.get('q');
  const results = [];
  if (barcode) {
    const r = await cexLookup(barcode);
    if (r.found) results.push(r);
  }
  if (q) {
    const r = await ebayLookup(q, env);
    if (r.found) results.push(r);
  }
  return json({ results, checked_at: new Date().toISOString() });
}

// ---------------- Cykliczne odświeżanie wycen (cron) ----------------
// Worker sam po sobie nie ma sesji użytkownika, więc do odczytu/zapisu w Supabase
// używa klucza service_role (env.SUPABASE_SERVICE_ROLE_KEY) — omija RLS, dlatego
// klucz musi zostać sekretem Workera (wrangler secret put), nigdy w index.html.
// Paczka 30 pozycji dziennie (najdawniej sprawdzane najpierw) — przy kolekcji do
// ok. 200 pozycji daje to pełny cykl odświeżenia w ok. tydzień, bez ryzyka
// przekroczenia czasu wykonania Workera albo limitów CEX/eBay w jednym uruchomieniu.
const PRICE_REFRESH_BATCH_SIZE = 30;

async function refreshMarketPrices(env) {
  const supaUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    console.log('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured — pomijam cykliczne odświeżanie cen');
    return;
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const selectUrl = `${supaUrl}/rest/v1/items?select=id,barcode,title,creator,type,status`
    + `&status=eq.owned&order=market_price_updated_at.asc.nullsfirst&limit=${PRICE_REFRESH_BATCH_SIZE}`;
  const itemsRes = await fetch(selectUrl, { headers });
  const items = await itemsRes.json();
  if (!Array.isArray(items)) {
    console.log('nieoczekiwana odpowiedź Supabase przy odświeżaniu cen', items);
    return;
  }
  for (const item of items) {
    const results = [];
    if (item.barcode && ['movie', 'music', 'videogame'].includes(item.type)) {
      const r = await cexLookup(item.barcode);
      if (r.found) results.push(r);
    }
    if (item.title) {
      const q = [item.title, item.creator].filter(Boolean).join(' ');
      const r = await ebayLookup(q, env);
      if (r.found) results.push(r);
    }
    const now = new Date().toISOString();
    await fetch(`${supaUrl}/rest/v1/items?id=eq.${item.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ market_prices: results, market_price_updated_at: now })
    });
    if (results.length) {
      await fetch(`${supaUrl}/rest/v1/price_history`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ item_id: item.id, market_prices: results, checked_at: now })
      });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (url.pathname.endsWith('/upc-lookup')) return handleUpcLookup(url);
    if (url.pathname.endsWith('/bn-lookup')) return handleBnLookup(url);
    if (url.pathname.endsWith('/omdb')) return handleOmdb(url, env);
    if (url.pathname.endsWith('/google-books')) return handleGoogleBooks(url, env);
    if (url.pathname.endsWith('/tmdb')) return handleTmdb(url, env);
    if (url.pathname.endsWith('/cex-price')) return handleCexPrice(url);
    if (url.pathname.endsWith('/ebay-price')) return handleEbayPrice(url, env);
    if (url.pathname.endsWith('/market-price')) return handleMarketPrice(url, env);
    return json({ error: 'not found' }, 404);
  },
  // Cron trigger (patrz wrangler.toml [triggers]) — cykliczne odświeżanie wycen całej
  // kolekcji w tle, kawałek po kawałku (PRICE_REFRESH_BATCH_SIZE dziennie).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshMarketPrices(env));
  }
};
