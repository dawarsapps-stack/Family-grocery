(() => {
  'use strict';

  const REPO = 'dawarsapps-stack/Family-grocery';
  const BRANCH = 'south-america-ota';
  const OTA_PATH = 'south-america-trip/ota/';
  const SHA_KEY = 'sa-ota-last-good-sha';
  const nativeFetch = window.fetch.bind(window);

  const app = document.getElementById('app');
  const setBoot = (title, detail = '') => {
    if (!app) return;
    app.innerHTML = `<div class="ota-boot"><div class="ota-logo">SA</div><strong>${title}</strong><span>${detail}</span></div>`;
  };

  async function retireOldServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    } catch {}
    try {
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.filter(n => /^sa-v2-|^south-america/i.test(n)).map(n => caches.delete(n)));
      }
    } catch {}
    try {
      Object.defineProperty(navigator.serviceWorker, 'register', {
        configurable: true,
        value: async () => ({ unregister: async () => true })
      });
    } catch {}
  }

  async function latestSha() {
    const url = `https://api.github.com/repos/${REPO}/branches/${BRANCH}?_=${Date.now()}`;
    const r = await nativeFetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!r.ok) throw new Error(`GitHub version check ${r.status}`);
    const json = await r.json();
    const sha = json?.commit?.sha;
    if (!/^[0-9a-f]{40}$/i.test(sha || '')) throw new Error('Invalid OTA version');
    return sha;
  }

  function cdnBase(sha) {
    return `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/${OTA_PATH}`;
  }

  function installAssetFetch(base) {
    window.fetch = function(input, init) {
      try {
        const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
        if (raw) {
          const u = new URL(raw, location.href);
          if (u.origin === location.origin && u.pathname.startsWith('/data/')) {
            const target = `${base}${u.pathname.slice(1)}${u.search}`;
            if (input instanceof Request) {
              const req = new Request(target, input);
              return nativeFetch(req, init);
            }
            return nativeFetch(target, init);
          }
        }
      } catch {}
      return nativeFetch(input, init);
    };
  }

  function addStylesheet(href, id) {
    return new Promise((resolve, reject) => {
      const existing = id && document.getElementById(id);
      if (existing) existing.remove();
      const link = document.createElement('link');
      if (id) link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve(link);
      link.onerror = () => reject(new Error(`Could not load ${href}`));
      document.head.appendChild(link);
    });
  }

  function addScript(src, id) {
    return new Promise((resolve, reject) => {
      if (id && document.getElementById(id)) return resolve();
      const s = document.createElement('script');
      if (id) s.id = id;
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function loadVersion(sha) {
    const base = cdnBase(sha);
    window.__SA_OTA__ = { sha, base, branch: BRANCH };
    installAssetFetch(base);

    await Promise.all([
      addStylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'leaflet-css'),
      addStylesheet(`${base}styles.css`, 'sa-ota-css')
    ]);
    await addScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet-js');
    await import(`${base}app.js`);
    localStorage.setItem(SHA_KEY, sha);
    document.documentElement.dataset.otaVersion = sha.slice(0, 7);
  }

  async function loadLocalFallback(reason) {
    console.warn('South America OTA fallback:', reason);
    window.fetch = nativeFetch;
    window.__SA_OTA__ = { fallback: true };
    setBoot('Opening saved trip…', 'Using the built-in copy because the live update service is unavailable.');
    try {
      await Promise.all([
        addStylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'leaflet-css'),
        addStylesheet('/styles.css', 'sa-ota-css')
      ]);
      await addScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'leaflet-js');
      await import(`./app.js?fallback=1`);
    } catch (e) {
      setBoot('Could not open the trip', 'Check your connection and refresh. Your shared trip data has not been deleted.');
      throw e;
    }
  }

  async function boot() {
    setBoot('Updating your trip…', 'Checking for the latest itinerary and app changes');
    await retireOldServiceWorkers();

    const lastGood = localStorage.getItem(SHA_KEY) || '';
    let latest = '';
    try { latest = await latestSha(); } catch (e) { console.warn(e); }

    const candidates = [...new Set([latest, lastGood].filter(x => /^[0-9a-f]{40}$/i.test(x)))];
    for (const sha of candidates) {
      try {
        await loadVersion(sha);
        return;
      } catch (e) {
        console.warn(`OTA ${sha.slice(0, 7)} failed`, e);
        window.fetch = nativeFetch;
      }
    }
    await loadLocalFallback('No OTA version could be loaded');
  }

  boot().catch(err => console.error('South America OTA boot failed', err));
})();
