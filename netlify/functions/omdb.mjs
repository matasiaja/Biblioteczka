// Serwerowy proxy do OMDb — klucz API trzymany po stronie serwera (zmienna środowiskowa
// OMDB_API_KEY na Netlify), żeby nie był widoczny w publicznym kodzie repo.
export default async (req) => {
  const url = new URL(req.url);
  const key = process.env.OMDB_API_KEY;
  const cors = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };
  if (!key) {
    return new Response(JSON.stringify({ Response: 'False', Error: 'OMDB_API_KEY not configured' }), { status: 200, headers: cors });
  }
  const omdbUrl = new URL('https://www.omdbapi.com/');
  omdbUrl.searchParams.set('apikey', key);
  for (const p of ['t', 's', 'i', 'type']) {
    const v = url.searchParams.get(p);
    if (v) omdbUrl.searchParams.set(p, v);
  }
  const res = await fetch(omdbUrl.toString());
  const body = await res.text();
  return new Response(body, { status: res.status, headers: cors });
};
