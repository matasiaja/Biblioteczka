const IMAGE_CACHE = 'biblioteczka-images-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== IMAGE_CACHE).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Okładki (Supabase Storage, TMDb, OMDb, OpenLibrary, Google Books, CoverArtArchive...)
// raz pobrane zostają w pamięci podręcznej i nie są ładowane ponownie przy kolejnych wizytach.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.destination !== 'image') return;

  event.respondWith(
    caches.open(IMAGE_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const response = await fetch(req);
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(req, response.clone());
        }
        return response;
      } catch (err) {
        return cached || Response.error();
      }
    })
  );
});
