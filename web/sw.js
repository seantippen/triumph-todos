var CACHE_NAME = 'todo-shell-v3';
var API_CACHE = 'todo-api-v2';
var SHELL_URLS = ['/', '/index.html'];

self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(SHELL_URLS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(
                names.filter(function(n) { return n !== CACHE_NAME && n !== API_CACHE; })
                     .map(function(n) { return caches.delete(n); })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function(e) {
    var url = new URL(e.request.url);

    // API GET requests: stale-while-revalidate — serve cached instantly, refresh in background
    if (url.pathname.startsWith('/api') && e.request.method === 'GET') {
        // Skip SWR for cache-busted requests (manual refresh)
        if (url.searchParams.has('_t')) {
            e.respondWith(
                fetch(e.request).then(function(response) {
                    if (response.ok) {
                        var clone = response.clone();
                        caches.open(API_CACHE).then(function(cache) {
                            // Store without the cache-buster param so future normal requests hit it
                            var cleanUrl = new URL(e.request.url);
                            cleanUrl.searchParams.delete('_t');
                            cache.put(new Request(cleanUrl.toString()), clone);
                        });
                    }
                    return response;
                }).catch(function() {
                    return caches.match(e.request);
                })
            );
            return;
        }
        e.respondWith(
            caches.open(API_CACHE).then(function(cache) {
                return cache.match(e.request).then(function(cached) {
                    var networkFetch = fetch(e.request).then(function(response) {
                        if (response.ok) {
                            cache.put(e.request, response.clone());
                        }
                        return response;
                    });
                    // Return cached immediately if available, otherwise wait for network
                    return cached || networkFetch;
                });
            })
        );
        return;
    }

    // Non-GET API requests: pass through (no caching for POST/PATCH/DELETE)
    if (url.pathname.startsWith('/api')) return;

    // Shell assets: cache-first with network update (faster shell loads)
    e.respondWith(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.match(e.request).then(function(cached) {
                var networkFetch = fetch(e.request).then(function(response) {
                    if (response.ok) cache.put(e.request, response.clone());
                    return response;
                });
                return cached || networkFetch;
            });
        })
    );
});
