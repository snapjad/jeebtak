/* Only application assets are cached. Financial data stays in localStorage. */
'use strict';
const CACHE='jeebtak-app-v6';
const ASSETS=['./','./index.html','./styles.css','./core.js','./app.js','./sync.js','./manifest.json','./assets/wallet-hero.svg','./assets/subscriptions.svg','./assets/bills.svg','./assets/salary.svg','./assets/debt.svg','./assets/app-icon.svg','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./assets/readex-0.ttf','./assets/readex-1.ttf','./assets/readex-2.ttf','./assets/readex-3.ttf'];
self.addEventListener('install',event=>{event.waitUntil((async()=>{
  // Bypass HTTP's older script copies. Activate only after the entire offline
  // bundle is present; a failed download must leave the current app available.
  const requests=ASSETS.map(path=>new Request(new URL(path,self.location.href),{cache:'reload'}));
  await (await caches.open(CACHE)).addAll(requests);
  await self.skipWaiting();
})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('jeebtak-app-')&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
  const scope=new URL('./',self.location.href);
  if(!url.pathname.startsWith(scope.pathname))return;
  // Existing pages keep their unsaved forms. The next navigation uses the new
  // complete bundle without waiting for iOS to terminate suspended windows.
  if(event.request.mode==='navigate'){event.respondWith(caches.match(new URL('index.html',scope).href,{cacheName:CACHE}).then(cached=>cached||fetch(event.request)));return;}
  const assetURLs=ASSETS.map(path=>new URL(path,scope).href);
  if(!assetURLs.includes(url.href))return;
  event.respondWith(caches.match(event.request,{cacheName:CACHE}).then(cached=>cached||fetch(event.request)));
});
