const CACHE_NAME = "rehla-cache-v2";
// مسارات نسبية عمداً (وليست بادئة بـ /) حتى يعمل التطبيق بشكل صحيح
// سواء نُشر على جذر الدومين (Netlify) أو داخل مسار فرعي (GitHub Pages: user.github.io/repo/)
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/variables.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/admin.css",
  "./js/config.js",
  "./js/state.js",
  "./js/supabaseClient.js",
  "./js/auth.js",
  "./js/dashboard.js",
  "./js/journal.js",
  "./js/support.js",
  "./js/app.js",
  "./js/utils/sanitize.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

// تثبيت: تخزين هيكل التطبيق الأساسي (App Shell)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// تفعيل: حذف أي كاش قديم
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// استراتيجية الجلب:
// - أصول ثابتة (CSS/JS/صور) → Cache First
// - طلبات Supabase (بيانات) → Network First مع رجوع للكاش عند انقطاع الاتصال
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.hostname.includes("supabase.co")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
