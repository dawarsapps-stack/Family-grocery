import fs from 'node:fs';

const loaderSource = fs.readFileSync('github-ota-loader.js', 'utf8');
fs.writeFileSync('public/ota-loader.js', loaderSource);

const index = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#f4ece7">
  <meta name="description" content="South America 2026 shared trip companion">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon.svg">
  <title>South America 2026</title>
  <style>
    html,body{margin:0;min-height:100%;background:#f4ece7;color:#291f1b;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .ota-boot{min-height:100vh;display:grid;place-content:center;justify-items:center;gap:12px;padding:24px;text-align:center;box-sizing:border-box}
    .ota-logo{width:54px;height:54px;border-radius:18px;display:grid;place-items:center;background:#c7594f;color:white;font-weight:800;letter-spacing:.04em;box-shadow:0 12px 30px rgba(70,35,25,.15)}
    .ota-boot strong{font-family:Georgia,serif;font-size:24px}.ota-boot span{max-width:340px;color:#776a64;font-size:14px;line-height:1.45}
  </style>
</head>
<body>
  <div id="app"><div class="ota-boot"><div class="ota-logo">SA</div><strong>Opening your trip…</strong><span>Itinerary, bookings, maps and shared changes</span></div></div>
  <script src="/ota-loader.js"></script>
</body>
</html>
`;
fs.writeFileSync('public/index.html', index);

const retiringSw = `self.addEventListener('install',()=>self.skipWaiting());\nself.addEventListener('activate',event=>event.waitUntil((async()=>{try{const names=await caches.keys();await Promise.all(names.map(n=>caches.delete(n)));}catch{}try{await self.registration.unregister();}catch{}try{await self.clients.claim();}catch{}})()));\n`;
fs.writeFileSync('public/sw.js', retiringSw);

console.log('GitHub OTA bootstrap installed; Netlify is now only the stable shell/API host.');
