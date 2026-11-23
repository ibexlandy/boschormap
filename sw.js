/* Boschor Map – Service-Worker (Scope /boschormap/). Eigene Cache-Namen «boschormap-…»;
   es werden ausschliesslich eigene Caches gelöscht, nie die von IbexMap auf derselben Herkunft. */
const V="1.6",APP="boschormap-app-v"+V,VIEW="boschormap-view",MAXVIEW=4000;
const SHELL=["./","index.html","app.css","core.js","map.js","gpx.js","app.js","tours.js","offline.js","sync.js","admin.js",
  "manifest.webmanifest","icon-192.png","icon-512.png","icon-maskable-512.png","favicon.png","apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(APP).then(c=>Promise.all(SHELL.map(u=>fetch(u,{cache:"no-store"}).then(r=>{if(r.ok)return c.put(new URL(u,self.registration.scope).href,r);}).catch(()=>{})))).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n.startsWith("boschormap-")&&n!==APP&&n!==VIEW).map(n=>caches.delete(n)))).then(()=>self.clients.claim()));});
/* Offline-Kacheln liegen in IndexedDB «boschormap-tiles» (sicher vor dem Aufräumen anderer Apps) */
let tdbP=null;
function tdb(){if(!tdbP)tdbP=new Promise((res,rej)=>{const r=indexedDB.open("boschormap-tiles",1);r.onupgradeneeded=()=>{const d=r.result;
  if(!d.objectStoreNames.contains("regions"))d.createObjectStore("regions",{keyPath:"id"});if(!d.objectStoreNames.contains("tiles"))d.createObjectStore("tiles",{keyPath:"k"});if(!d.objectStoreNames.contains("names"))d.createObjectStore("names",{keyPath:"id"});};
  r.onsuccess=()=>{const d=r.result;d.onversionchange=()=>{d.close();tdbP=null;};res(d);};r.onerror=()=>{tdbP=null;rej(r.error);};});return tdbP;}
async function offTile(k){try{const d=await tdb();return await new Promise(res=>{const q=d.transaction("tiles").objectStore("tiles").get(k);q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null);});}catch(e){return null;}}
let putN=0;async function trim(){if(++putN%50)return;const c=await caches.open(VIEW);const k=await c.keys();for(let i=0;i<k.length-MAXVIEW;i++)await c.delete(k[i]);}
async function tile(req,u){const m=u.pathname.match(/^\/1\.0\.0\/([^/]+)\/default\/[^/]+\/3857\/(\d+)\/(\d+)\/(\d+)\.(\w+)$/);
  if(m){const t=await offTile(`${m[1]}/${m[2]}/${m[3]}/${m[4]}`);if(t&&t.b)return new Response(t.b,{headers:{"Content-Type":t.b.type||(m[5]==="png"?"image/png":"image/jpeg")}});}
  const c=await caches.open(VIEW);const hit=await c.match(req.url);if(hit)return hit;
  try{const r=await fetch(req.url,{mode:"cors",credentials:"omit"});if(r.ok){c.put(req.url,r.clone());trim();}return r;}catch(e){return Response.error();}}
const appHit=async u=>{try{return await (await caches.open(APP)).match(u);}catch(e){return undefined;}};
self.addEventListener("fetch",e=>{const req=e.request;if(req.method!=="GET")return;const u=new URL(req.url);
  if(u.hostname==="wmts.geo.admin.ch"){if(req.cache==="no-store")return;e.respondWith(tile(req,u));return;}
  if(u.origin!==location.origin||!u.href.startsWith(self.registration.scope))return;
  /* App-Dateien: sofort aus dem Speicher, im Hintergrund frisch holen (neue Versionen kommen über ein neues sw.js) */
  const key=u.origin+u.pathname;const isNav=req.mode==="navigate";
  if(req.cache==="no-store"||req.cache==="reload"){e.respondWith(fetch(req).catch(()=>appHit(key).then(m=>m||Response.error())));return;}
  const net=fetch(key,{cache:"no-cache",credentials:"same-origin"}).then(async r=>{if(r.ok&&!r.redirected){const c=await caches.open(APP);await c.put(key,r.clone());}return r;});
  e.respondWith((async()=>{const hit=await appHit(key)||(isNav?await appHit(self.registration.scope):undefined);if(hit){e.waitUntil(net.catch(()=>{}));return hit;}
    try{return await net;}catch(err){return (await appHit(self.registration.scope))||Response.error();}})());});
