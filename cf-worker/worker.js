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
    return json({ error: 'not found' }, 404);
  }
};
