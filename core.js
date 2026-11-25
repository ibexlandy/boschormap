/* BoschorMap – Grundlagen: Hilfsfunktionen, Speicher (IndexedDB), Koordinaten, Konstanten */
"use strict";
const APP_VERSION="3.3";
const LSP="bm_";            /* eigenes localStorage-Präfix – getrennt von IbexMap auf derselben Herkunft */
const DBN="boschormap",TDBN="boschormap-tiles";

const $=(s,r)=>(r||document).querySelector(s),$$=(s,r)=>[...(r||document).querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const ls=(k,v)=>{try{if(v===undefined)return localStorage.getItem(LSP+k);if(v===null)localStorage.removeItem(LSP+k);else localStorage.setItem(LSP+k,String(v));}catch(e){return null;}};
const lsJ=(k,d)=>{try{const v=ls(k);return v?JSON.parse(v):d;}catch(e){return d;}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fmtN=(n,d=0)=>{if(n==null||!isFinite(n))return "–";const s=Number(n).toFixed(d);const [a,b]=s.split(".");return a.replace(/\B(?=(\d{3})+(?!\d))/g,"'")+(b?"."+b:"");};
const fmtKm=m=>m==null?"–":(m>=10000?fmtN(m/1000,1):fmtN(m/1000,2))+" km";
const fmtHm=m=>m==null?"–":fmtN(m)+" m";
const fmtDur=s=>{if(s==null||!isFinite(s))return "–";s=Math.round(s/60);const h=Math.floor(s/60),m=s%60;return h?`${h} h ${String(m).padStart(2,"0")}`:`${m} min`;};
/* Besuchsdatum: leer = früherer Besuch ohne bekanntes Datum */
const fmtVisit=d=>d?fmtDate(d):"früher";
const fmtDate=d=>{if(!d)return "";const m=String(d).match(/^(\d{4})-(\d\d)-(\d\d)/);return m?`${+m[3]}.${+m[2]}.${m[1]}`:String(d);};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
const fmtDT=t=>{const d=new Date(t);return `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;};
const MB=b=>b<1e6?fmtN(b/1024)+" KB":fmtN(b/1048576,1)+" MB";

/* ---------- Geometrie ---------- */
const RAD=Math.PI/180;
function distM(a1,o1,a2,o2){const dA=(a2-a1)*RAD,dO=(o2-o1)*RAD;const s=Math.sin(dA/2)**2+Math.cos(a1*RAD)*Math.cos(a2*RAD)*Math.sin(dO/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(s)));}
/* Abstand Punkt–Strecke in Metern (lokal eben, genügt für kurze Abschnitte) */
function distSeg(la,lo,a1,o1,a2,o2){const k=Math.cos(la*RAD)*111320,K=110540;const px=(lo-o1)*k,py=(la-a1)*K,vx=(o2-o1)*k,vy=(a2-a1)*K;const L=vx*vx+vy*vy;
  let t=L?(px*vx+py*vy)/L:0;t=Math.max(0,Math.min(1,t));return Math.hypot(px-t*vx,py-t*vy);}
/* kleinster Abstand eines Punkts zu einer Linie [[lat,lon,…],…] */
function distLine(la,lo,line){let b=Infinity;for(let i=1;i<line.length;i++){const p=line[i-1],q=line[i];
  if(Math.abs(p[0]-la)>0.05&&Math.abs(q[0]-la)>0.05)continue;const d=distSeg(la,lo,p[0],p[1],q[0],q[1]);if(d<b)b=d;}return b;}
function bboxOf(line){let s=90,w=180,n=-90,e=-180;for(const p of line){if(p[0]<s)s=p[0];if(p[0]>n)n=p[0];if(p[1]<w)w=p[1];if(p[1]>e)e=p[1];}return [s,w,n,e];}
/* Linie vereinfachen (Douglas-Peucker, Toleranz in Metern) – nur für die Anzeige */
function simplify(line,tol){if(line.length<3)return line.slice();const keep=new Uint8Array(line.length);keep[0]=keep[line.length-1]=1;const st=[[0,line.length-1]];
  while(st.length){const [a,b]=st.pop();let md=0,mi=-1;for(let i=a+1;i<b;i++){const d=distSeg(line[i][0],line[i][1],line[a][0],line[a][1],line[b][0],line[b][1]);if(d>md){md=d;mi=i;}}
    if(md>tol&&mi>0){keep[mi]=1;st.push([a,mi],[mi,b]);}}return line.filter((p,i)=>keep[i]);}
/* WGS84 ↔ LV95 (Näherungsformeln von swisstopo, Genauigkeit rund 1 m) */
function toLV95(lat,lon){const p=(lat*3600-169028.66)/10000,l=(lon*3600-26782.5)/10000;
  return [2600072.37+211455.93*l-10938.51*l*p-0.36*l*p*p-44.54*l*l*l, 1200147.07+308807.95*p+3745.25*l*l+76.63*p*p-194.56*l*l*p+119.79*p*p*p];}
function fromLV95(E,N){const y=(E-2600000)/1e6,x=(N-1200000)/1e6;
  const l=2.6779094+4.728982*y+0.791484*y*x+0.1306*y*x*x-0.0436*y*y*y,p=16.9023892+3.238272*x-0.270978*y*y-0.002528*x*x-0.0447*y*y*x-0.0140*x*x*x;return [p*100/36,l*100/36];}
function pip(lat,lon,poly){/* Punkt in Polygon (GeoJSON-Ring [lon,lat]) */let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
  if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
function inGeom(lat,lon,g){if(!g)return false;const polys=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:[];
  for(const P of polys){if(pip(lat,lon,P[0])){let hole=false;for(let k=1;k<P.length;k++)if(pip(lat,lon,P[k]))hole=true;if(!hole)return true;}}return false;}

/* ---------- IndexedDB ---------- */
function idbOpen(name,ver,up){return new Promise((res,rej)=>{const r=indexedDB.open(name,ver);r.onupgradeneeded=()=>up(r.result);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);r.onblocked=()=>rej(new Error("Speicher blockiert – andere Boschor-Map-Fenster schliessen"));});}
let _db=null,_tdb=null;
async function db(){if(!_db)_db=await idbOpen(DBN,1,d=>{for(const s of ["points","photos","tours","lines","raw","meta"])if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:"id"});});return _db;}
async function tdb(){if(!_tdb)_tdb=await idbOpen(TDBN,1,d=>{if(!d.objectStoreNames.contains("regions"))d.createObjectStore("regions",{keyPath:"id"});
  if(!d.objectStoreNames.contains("tiles"))d.createObjectStore("tiles",{keyPath:"k"});if(!d.objectStoreNames.contains("names"))d.createObjectStore("names",{keyPath:"id"});});return _tdb;}
const rq=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
async function getAll(st,D){const d=D||await db();return rq(d.transaction(st).objectStore(st).getAll());}
async function getOne(st,id,D){const d=D||await db();return rq(d.transaction(st).objectStore(st).get(id));}
async function put(st,v,D){const d=D||await db();return new Promise((res,rej)=>{const t=d.transaction(st,"readwrite");t.objectStore(st).put(v);t.oncomplete=()=>res(v);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error("Speichern abgebrochen (Speicher voll?)"));});}
async function putMany(st,arr,D){if(!arr.length)return;const d=D||await db();return new Promise((res,rej)=>{const t=d.transaction(st,"readwrite");const s=t.objectStore(st);for(const v of arr)s.put(v);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error("Speichern abgebrochen (Speicher voll?)"));});}
async function del(st,id,D){const d=D||await db();return new Promise((res,rej)=>{const t=d.transaction(st,"readwrite");t.objectStore(st).delete(id);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}
async function getKeys(st,D){const d=D||await db();return rq(d.transaction(st).objectStore(st).getAllKeys());}
async function metaGet(id,def){try{const v=await getOne("meta",id);return v?v.v:def;}catch(e){return def;}}
async function metaSet(id,v){return put("meta",{id,v});}

/* ---------- Kompression (für Drive und Sicherung) ---------- */
async function gzip(str){if(typeof CompressionStream==="undefined")return new Blob([str]);return new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).blob();}
async function gunzip(blob){const b=new Uint8Array(await blob.slice(0,2).arrayBuffer());if(b[0]===0x1f&&b[1]===0x8b&&typeof DecompressionStream!=="undefined")return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();return blob.text();}

/* ---------- Karten (swisstopo, geprüft an den WMTS-Capabilities 3857 vom 23.11.2026) ---------- */
const WMTS="https://wmts.geo.admin.ch/1.0.0/{L}/default/current/3857/{z}/{x}/{y}.{F}";
const CH_BOUNDS=[45.75,5.85,47.85,10.55];
const BASES={
  lk:{n:"Landeskarte",id:"ch.swisstopo.pixelkarte-farbe",f:"jpeg",max:19,kb:28},
  winter:{n:"Winterkarte",id:"ch.swisstopo.pixelkarte-farbe-winter",f:"jpeg",max:19,kb:26},
  lb:{n:"Luftbild",id:"ch.swisstopo.swissimage",f:"jpeg",max:20,kb:32}};
const OVERLAYS={
  hang:{n:"Hangneigung über 30°",ids:["ch.swisstopo.hangneigung-ueber_30"],max:17,op:0.6,kb:6,from:11},
  wild:{n:"Wildruhezonen & Jagdbanngebiete",ids:["ch.bafu.wrz-wildruhezonen_portal","ch.bafu.wrz-jagdbanngebiete_select"],max:18,op:0.7,kb:3,from:9},
  hsh:{n:"Alpweiden mit Herdenschutzhunden",ids:["ch.bafu.alpweiden-herdenschutzhunde"],max:17,op:0.6,kb:2,from:9},
  auen:{n:"Alpine Auen ausserhalb Bundesinventar",ids:["ch.bafu.auen-ausserhalb_bundesinventar_alpin"],max:17,op:0.6,kb:2,from:10},
  ski:{n:"Skitourenrouten",ids:["ch.swisstopo-karto.skitouren"],max:17,op:0.9,kb:3,from:11},
  wander:{n:"Wanderwege",ids:["ch.swisstopo.swisstlm3d-wanderwege"],max:18,op:0.9,kb:3,from:11},
  velo:{n:"Velorouten",ids:["ch.astra.veloland"],max:18,op:0.85,kb:2,from:8},
  mtb:{n:"Mountainbike-Routen",ids:["ch.astra.mountainbikeland"],max:18,op:0.85,kb:2,from:8}};
const layerUrl=(id,f)=>WMTS.replace("{L}",id).replace("{F}",f||"png");

/* ---------- Kategorien und Tourarten ---------- */
const CATS={
  gipfel:{n:"Gipfel",c:"#6b3f24",c2:"#c0784a"},huette:{n:"Hütte",c:"#a02c1c",c2:"#ef6a45"},pass:{n:"Pass",c:"#33507a",c2:"#6f98cf"},
  see:{n:"See",c:"#0b5f99",c2:"#35b3ea"},ort:{n:"Schöner Ort",c:"#1f6b3a",c2:"#5cc07a"},start:{n:"Start / Parkplatz",c:"#2b3946",c2:"#6d8191"}};
const CRIT={huette:[["schoen","Wie schön"],["gemuetlich","Wie gemütlich"]],ort:[["schoen","Wie schön"]],see:[["schoen","Wie schön"]],gipfel:[["schoen","Aussicht / wie schön"]],pass:[["schoen","Wie schön"]],start:[]};
const ARTS={
  skitour:{n:"Skitour",c:"#1565c0",prof:null,wprof:"hiking-mountain",ski:true,t:{vf:4,vu:400,vd:1500}},
  wandern:{n:"Wanderung",c:"#d32f2f",prof:"hiking-mountain",t:{vf:4.2,vu:400,vd:800}},
  hochtour:{n:"Hochtour",c:"#7b1fa2",prof:"hiking-mountain",t:{vf:3.5,vu:350,vd:600}},
  winterhochtour:{n:"Winterhochtour",c:"#283593",prof:null,wprof:"hiking-mountain",ski:true,t:{vf:3.5,vu:330,vd:1000}},
  gravel:{n:"Gravel",c:"#ef6c00",bike:true,prof:"gravel",t:{vf:20,vu:700,vd:2500}},
  bike:{n:"Bike (Enduro)",c:"#2e7d32",bike:true,prof:"mtb",t:{vf:14,vu:550,vd:1500}}};
const TOUR_CRIT=[["streng","Wie streng"],["schoen","Wie schön"]];
const SCALES={wandern:["T1","T2","T3","T4","T5","T6"],hochtour:["L","WS","ZS","S","SS","AS"],winterhochtour:["L","WS","ZS","S","SS","AS"],
  skitour:["L","WS","ZS","S","SS","AS"],bike:["S0","S1","S2","S3","S4","S5"],gravel:["leicht","mittel","schwer"]};
const DEFAULT_CHECK={
  skitour:["LVS-Gerät (Batterie geprüft)","Schaufel","Sonde","Felle","Harscheisen","Helm","Erste Hilfe","Handy geladen","Lawinenbulletin gelesen"],
  wandern:["Wanderschuhe","Regenjacke","Wasser","Sonnenschutz","Erste Hilfe","Handy geladen"],
  hochtour:["Gurt","Seil","Steigeisen","Pickel","Helm","Eisschrauben","Prusik/Reepschnüre","Erste Hilfe","Hütte reserviert?"],
  winterhochtour:["LVS-Gerät","Schaufel","Sonde","Gurt","Seil","Steigeisen","Pickel","Helm","Erste Hilfe"],
  gravel:["Helm","Ersatzschlauch","Pumpe","Multitool","Licht","Wasser"],
  bike:["Helm","Protektoren","Ersatzschlauch","Pumpe","Multitool","Erste Hilfe"]};

/* ---------- Höhendienst geo.admin.ch (swissALTI3D) ---------- */
async function heightAt(lat,lon){const [E,N]=toLV95(lat,lon);const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),8000);
  try{const r=await fetch(`https://api3.geo.admin.ch/rest/services/height?easting=${E.toFixed(1)}&northing=${N.toFixed(1)}&sr=2056`,{signal:ctl.signal});
    if(!r.ok)return null;const j=await r.json();const h=parseFloat(j.height);return isFinite(h)&&h>0?Math.round(h):null;}catch(e){return null;}finally{clearTimeout(tm);}}
/* Höhenprofil einer Linie: [[lat,lon]] → [{d,h,lat,lon}] (eine Abfrage, bis 200 Punkte) */
async function profileOf(line,n){const pts=line.length>600?simplify(line,15):line;const coords=pts.map(p=>toLV95(p[0],p[1]).map(v=>Math.round(v*10)/10));
  const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),15000);
  try{const r=await fetch(`https://api3.geo.admin.ch/rest/services/profile.json?sr=2056&nb_points=${n||200}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"LineString",coordinates:coords}),signal:ctl.signal});
    if(!r.ok)throw new Error("Höhendienst: Fehler "+r.status);const j=await r.json();
    return j.map(p=>{const ll=fromLV95(p.easting,p.northing);return {d:p.dist,h:p.alts.COMB!=null?p.alts.COMB:p.alts.DTM25,lat:ll[0],lon:ll[1]};});}finally{clearTimeout(tm);}}
