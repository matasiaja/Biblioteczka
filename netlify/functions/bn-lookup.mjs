// Serwerowy proxy do katalogu Biblioteki Narodowej (data.bn.org.pl) — omija blokadę CORS.
export default async (req) => {
  const isbn = new URL(req.url).searchParams.get('isbn');
  if (!isbn) {
    return new Response(JSON.stringify({ error: 'missing isbn' }), { status: 400 });
  }
  const res = await fetch(`https://data.bn.org.pl/api/institutions/bibs.json?isbnIssn=${encodeURIComponent(isbn)}&limit=1`);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
};
