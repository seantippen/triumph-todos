var CACHE_NAME = 'todo-shell-v2';
var API_CACHE = 'todo-api-v1';
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

    // API GET requests: network-first, fall back to cached response when offline
    if (url.pathname.startsWith('/api') && e.request.method === 'GET') {
        e.respondWith(
            fetch(e.request).then(function(response) {
                if (response.ok) {
                    var clone = response.clone();
                    caches.open(API_CACHE).then(function(cache) { cache.put(e.request, clone); });
                }
                return response;
            }).catch(function() {
                return caches.match(e.request);
            })
        );
        return;
    }

    // Non-GET API requests: pass through (no caching for POST/PATCH/DELETE)
    if (url.pathname.startsWith('/api')) return;

    // Shell assets: network-first with cache fallback
    e.respondWith(
        fetch(e.request).then(function(response) {
            if (response.ok) {
                var clone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
            }
            return response;
        }).catch(function() {
            return caches.match(e.request);
        })
    );
});
