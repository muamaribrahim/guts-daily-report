/* =================================================================
   GUTS SERVICE WORKER (OFFLINE BRAIN)
   ================================================================= */
const CACHE_NAME = 'guts-erp-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './script.js',
    './manifest.json',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap'
];

// 1. INSTALL: Cache semua file penting
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching App Shell');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. ACTIVATE: Hapus cache lama jika ada update versi
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[SW] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
});

// 3. FETCH: Intercept semua request internet
self.addEventListener('fetch', (e) => {
    // Abaikan request ke Google Script (API) karena itu data dinamis
    if (e.request.url.includes('script.google.com')) {
        return; 
    }

    e.respondWith(
        caches.match(e.request).then((response) => {
            // Jika ada di cache, pakai cache (OFFLINE MODE)
            // Jika tidak, download dari internet
            return response || fetch(e.request);
        })
    );

});
