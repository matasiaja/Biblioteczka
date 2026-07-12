// Serwerowy proxy do Google Books — klucz API trzymany po stronie serwera (zmienna
// środowiskowa GOOGLE_BOOKS_API_KEY na Netlify), żeby nie był widoczny w publicznym kodzie repo.
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
  const res = await fetch(url.toString());
  const body = await res.text();
  return new Response(body, { status: res.status, headers: cors });
};
