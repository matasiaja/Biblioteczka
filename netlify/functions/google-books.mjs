// Serwerowy proxy do Google Books — klucz API trzymany po stronie serwera (zmienna
// środowiskowa GOOGLE_BOOKS_API_KEY na Netlify), żeby nie był widoczny w publicznym kodzie repo.
// Google Books API bywa chwilowo niestabilne (503) — próbujemy dwukrotnie zanim się poddamy.
export default async (req) => {
  const isbn = new URL(req.url).searchParams.get('isbn');
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };
  if (!isbn) {
    return new Response(JSON.stringify({ error: 'missing isbn' }), { status: 400, headers: cors });
  }
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', `isbn:${isbn}`);
  if (key) url.searchParams.set('key', key);

  let res, body;
  for (let attempt = 0; attempt < 2; attempt++){
    res = await fetch(url.toString());
    body = await res.text();
    if (res.status < 500) break;
    if (attempt === 0) await new Promise(r => setTimeout(r, 600));
  }
  return new Response(body, { status: res.status, headers: cors });
};
