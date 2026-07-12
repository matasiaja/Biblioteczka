// Serwerowy proxy do UPCitemdb — omija blokadę CORS na przeglądarkę
// (UPCitemdb odpowiada z Access-Control-Allow-Origin tylko dla własnej domeny,
// więc bezpośrednie zapytanie z appki w przeglądarce zawsze się nie udawało).
export default async (req) => {
  const upc = new URL(req.url).searchParams.get('upc');
  if (!upc) {
    return new Response(JSON.stringify({ error: 'missing upc' }), { status: 400 });
  }
  const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
};
