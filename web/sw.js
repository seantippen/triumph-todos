var CACHE_NAME = 'todo-shell-v1';
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
                names.filter(function(n) { return n !== CACHE_NAME; })
                     .map(function(n) { return caches.delete(n); })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function(e) {
    var url = new URL(e.request.url);
    // Only cache GET requests for shell assets, let API calls pass through
    if (e.request.method !== 'GET' || url.pathname.startsWith('/api')) return;

    e.respondWith(
        fetch(e.request).then(function(response) {
            // Update cache with fresh copy
            if (response.ok) {
                var clone = response.clone();
                caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
            }
            return response;
        }).catch(function() {
            // Fallback to cache when offline
            return caches.match(e.request);
        })
    );
});
