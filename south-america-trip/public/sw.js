const CACHE='sa-trip-shell-v4';
const ASSETS=['/','/index.html','/styles.css','/app-01.js','/app-02.js','/app-03.js','/app-04.js','/app-05.js','/app-06.js','/app-07.js','/app-08.js','/app-09.js','/manifest.webmanifest','/icon.svg','/trip-meta.json','/days-1.json','/days-2.json','/days-3.json','/days-4.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))));
});
