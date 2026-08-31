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

// Kursy walut (Frankfurter — darmowe, bez klucza, dane referencyjne EBC, aktualizowane
// w dni robocze) — do przeliczania cen zakupu z różnych krajów na jedną walutę bazową
// (GBP) przy sumowaniu wartości kolekcji w appce. Frankfurter nie ustawia nagłówków CORS,
// stąd zwykły proxy jak reszta źródeł w tym pliku.
async function handleFxRates(url) {
  const base = url.searchParams.get('base') || 'GBP';
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}`);
  return json(await res.text(), res.status);
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

// Discogs — oficjalne, darmowe API (bez klucza, tylko nagłówek User-Agent) z realnymi
// danymi rynkowymi kolekcjonerskiego rynku płyt: najniższa aktualna cena ofertowa i liczba
// ofert dla KONKRETNEGO wydania (release_id — ten sam, który zapisujemy przy skanowaniu
// kodu płyty, patrz lookupBarcodeGeneral()/attachDiscogsReleaseId() w index.html).
async function discogsLookup(releaseId) {
  try {
    const res = await fetch(`https://api.discogs.com/marketplace/stats/${encodeURIComponent(releaseId)}`, {
      headers: { 'User-Agent': 'Biblioteczka/1.0' }
    });
    if (!res.ok) return { found: false, source: 'Discogs' };
    const data = await res.json();
    if (data.blocked_from_sale || !data.lowest_price) return { found: false, source: 'Discogs' };
    return {
      found: true,
      source: 'Discogs',
      lowestPrice: data.lowest_price.value,
      currency: data.lowest_price.currency,
      numForSale: data.num_for_sale ?? null
    };
  } catch (e) {
    return { found: false, source: 'Discogs', error: String(e) };
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

async function handleDiscogsPrice(url) {
  const releaseId = url.searchParams.get('release_id');
  if (!releaseId) return json({ error: 'missing release_id' }, 400);
  return json(await discogsLookup(releaseId));
}

// Punkt wejścia używany przez appkę (przycisk "Sprawdź cenę teraz") — jedno zapytanie
// zamiast osobnych wywołań z klienta.
async function handleMarketPrice(url, env) {
  const barcode = url.searchParams.get('barcode');
  const q = url.searchParams.get('q');
  const discogsReleaseId = url.searchParams.get('discogs_release_id');
  const results = [];
  if (barcode) {
    const r = await cexLookup(barcode);
    if (r.found) results.push(r);
  }
  if (discogsReleaseId) {
    const r = await discogsLookup(discogsReleaseId);
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
  const selectUrl = `${supaUrl}/rest/v1/items?select=id,barcode,title,creator,type,status,discogs_release_id`
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
    if (item.discogs_release_id) {
      const r = await discogsLookup(item.discogs_release_id);
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

// ---------------- Cotygodniowy raport mailowy (cron: poniedziałki 8:00 UTC) ----------------
// Ta sama logika co bestMarketPrice()/computePortfolioPerformance() w index.html (Ustawienia
// → Statystyki → "Wycena portfela"), tylko po stronie Workera — żeby raport pokazywał
// dokładnie to, co user widzi w appce, bez utrzymywania dwóch osobnych definicji "co jest
// najlepszą ceną" w dwóch miejscach naraz nie da się uniknąć (brak współdzielonego modułu
// między przeglądarką a Workerem), więc trzymaj te dwie kopie zsynchronizowane przy zmianach.
function bestMarketPriceServer(item) {
  const prices = item.market_prices || [];
  const cex = prices.find(p => p.source === 'CEX' && p.sellPrice != null);
  if (cex) return { value: cex.sellPrice, currency: cex.currency };
  const discogs = prices.find(p => p.source === 'Discogs' && p.lowestPrice != null);
  if (discogs) return { value: discogs.lowestPrice, currency: discogs.currency };
  const ebay = prices.find(p => p.source === 'eBay' && p.median != null);
  if (ebay) return { value: ebay.median, currency: ebay.currency };
  return null;
}

function convertToGBPServer(amount, currency, rates) {
  if (amount == null || !currency) return null;
  if (currency === 'GBP') return amount;
  const rate = rates && rates[currency];
  if (!rate) return null;
  return amount / rate;
}

function computePortfolioPerformanceServer(items, rates) {
  const rows = [];
  let totalPurchaseGBP = 0, totalMarketGBP = 0;
  for (const i of items) {
    if (i.purchase_price == null) continue;
    const purchaseGBP = convertToGBPServer(i.purchase_price, i.purchase_currency, rates);
    if (purchaseGBP == null) continue;
    const best = bestMarketPriceServer(i);
    if (!best) continue;
    const marketGBP = convertToGBPServer(best.value, best.currency, rates);
    if (marketGBP == null) continue;
    const changeAbs = marketGBP - purchaseGBP;
    const changePct = purchaseGBP > 0 ? (changeAbs / purchaseGBP) * 100 : 0;
    rows.push({ title: i.title, purchaseGBP, marketGBP, changeAbs, changePct });
    totalPurchaseGBP += purchaseGBP;
    totalMarketGBP += marketGBP;
  }
  rows.sort((a, b) => b.changePct - a.changePct);
  const gainers = rows.filter(r => r.changePct > 0);
  const losers = rows.filter(r => r.changePct < 0).reverse();
  return { rows, gainers, losers, totalPurchaseGBP, totalMarketGBP };
}

function escapeHtmlServer(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function perfRowHtmlServer(r) {
  const up = r.changePct >= 0;
  const color = up ? '#3DDC84' : '#FF4D4D';
  return `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #333844;">${escapeHtmlServer(r.title)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #333844;white-space:nowrap;">£${r.purchaseGBP.toFixed(2)} → £${r.marketGBP.toFixed(2)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #333844;white-space:nowrap;font-weight:700;color:${color};">${up ? '▲' : '▼'} ${up ? '+' : ''}${r.changePct.toFixed(1)}%</td>
  </tr>`;
}

async function sendWeeklyReportEmail(env) {
  const supaUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    console.log('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured — pomijam raport mailowy');
    return;
  }
  if (!env.RESEND_API_KEY || !env.REPORT_EMAIL_TO) {
    console.log('RESEND_API_KEY/REPORT_EMAIL_TO not configured — pomijam raport mailowy');
    return;
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const itemsRes = await fetch(
    `${supaUrl}/rest/v1/items?select=title,purchase_price,purchase_currency,market_prices&status=eq.owned`,
    { headers }
  );
  const items = await itemsRes.json();
  if (!Array.isArray(items)) {
    console.log('nieoczekiwana odpowiedź Supabase przy raporcie mailowym', items);
    return;
  }
  const fxRes = await fetch('https://api.frankfurter.dev/v1/latest?base=GBP');
  const fxData = await fxRes.json();
  const rates = fxData.rates || {};

  const perf = computePortfolioPerformanceServer(items, rates);
  const changeAbs = perf.totalMarketGBP - perf.totalPurchaseGBP;
  const changePct = perf.totalPurchaseGBP > 0 ? (changeAbs / perf.totalPurchaseGBP) * 100 : 0;
  const changeColor = changeAbs >= 0 ? '#3DDC84' : '#FF4D4D';

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#1A1D23;">
      <h2 style="margin-bottom:4px;">📈 Biblioteczka — cotygodniowy raport wyceny</h2>
      <p style="color:#6B7280;margin-top:0;">${perf.rows.length} pozycji z ceną zakupu i sprawdzoną wyceną rynkową.</p>
      <div style="background:#F3F4F7;border-radius:12px;padding:16px;margin-bottom:20px;">
        <table style="width:100%;"><tr>
          <td><div style="color:#6B7280;font-size:12px;">Zainwestowano</div><div style="font-size:20px;font-weight:700;">£${perf.totalPurchaseGBP.toFixed(2)}</div></td>
          <td style="text-align:right;"><div style="color:#6B7280;font-size:12px;">Aktualna wycena</div><div style="font-size:20px;font-weight:700;">£${perf.totalMarketGBP.toFixed(2)}</div></td>
        </tr></table>
        <div style="margin-top:10px;font-size:17px;font-weight:700;color:${changeColor};">${changeAbs >= 0 ? '▲' : '▼'} £${Math.abs(changeAbs).toFixed(2)} (${changeAbs >= 0 ? '+' : ''}${changePct.toFixed(1)}%)</div>
      </div>
      <h3 style="color:#16875A;">🟢 Wzrosty (${perf.gainers.length})</h3>
      ${perf.gainers.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;">${perf.gainers.map(perfRowHtmlServer).join('')}</table>` : '<p style="color:#6B7280;">Brak.</p>'}
      <h3 style="color:#D6303F;margin-top:24px;">🔴 Spadki (${perf.losers.length})</h3>
      ${perf.losers.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;">${perf.losers.map(perfRowHtmlServer).join('')}</table>` : '<p style="color:#6B7280;">Brak.</p>'}
      <p style="color:#9AA0AC;font-size:12px;margin-top:24px;">Wygenerowano automatycznie przez Biblioteczkę. Ceny liczone wg CEX/Discogs/eBay, przeliczone na GBP wg dzisiejszego kursu (Frankfurter/EBC).</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'Biblioteczka <onboarding@resend.dev>',
      to: env.REPORT_EMAIL_TO,
      subject: `📈 Biblioteczka: ${perf.gainers.length} w górę, ${perf.losers.length} w dół — raport tygodniowy`,
      html
    })
  });
  if (!res.ok) {
    console.log('Błąd wysyłki raportu mailowego przez Resend', res.status, await res.text());
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
    if (url.pathname.endsWith('/fx-rates')) return handleFxRates(url);
    if (url.pathname.endsWith('/discogs-price')) return handleDiscogsPrice(url);
    // Ręczne wywołanie raportu tygodniowego — do testowania bez czekania do poniedziałku.
    // Wysyła zawsze na REPORT_EMAIL_TO (Twój własny e-mail), więc brak dodatkowej
    // autoryzacji jest tu niegroźny — najwyżej ktoś sprawi, że dostaniesz maila.
    if (url.pathname.endsWith('/send-report-now')) {
      await sendWeeklyReportEmail(env);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  },
  // Dwa harmonogramy (patrz wrangler.toml [triggers]), rozróżniane po event.cron:
  // - "0 3 * * *"  — cykliczne odświeżanie wycen całej kolekcji, kawałek po kawałku
  // - "0 8 * * 1"  — cotygodniowy raport mailowy z wynikiem (poniedziałki rano)
  async scheduled(event, env, ctx) {
    if (event.cron === '0 8 * * 1') {
      ctx.waitUntil(sendWeeklyReportEmail(env));
    } else {
      ctx.waitUntil(refreshMarketPrices(env));
    }
  }
};
