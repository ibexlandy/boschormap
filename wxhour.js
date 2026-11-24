/* ---------- Tagesverlauf (Stundenwerte MeteoSchweiz, 4 Tage) ----------
   Die Stundendateien (je ~32 MB, ganze Schweiz) sind blockweise nach Prognosepunkt geordnet. Statt sie ganz zu laden,
   holt die App per HTTP-Range nur die wenigen KB der benötigten Punkte. Ergebnis wird im Gerät gespeichert (offline). */
const WXH_PAR={r:"rre150h0",lo:"rreq10h0",hi:"rreq90h0",p:"rp0003i0",s:"jww003i0",g:"fu3010h1"};
const WXH_DAYS=4;let wxhMem=null;
async function wxhGet(){if(!wxhMem)wxhMem=await metaGet("wxh",null);return wxhMem;}
async function rangeTxt(href,a,b){const r=await fetch(href,{headers:{Range:`bytes=${Math.max(0,a)}-${b}`},cache:"no-store"});if(r.status!==206&&r.status!==200)throw new Error("Stundenwerte: Fehler "+r.status);return r.text();}
/* neuesten Lauf finden, in dem alle Stundenwerte vorhanden sind */
async function wxhRun(){const its=await (await fetch(STAC+"/items?limit=100",{cache:"no-store"})).json();
  for(const it of (its.features||[]).slice().sort((a,b)=>b.id.localeCompare(a.id))){const k=Object.keys(it.assets||{});const runs=[...new Set(k.map(x=>x.split(".")[2]).filter(Boolean))].sort().reverse();
    for(const r of runs){const files={};let ok=true;for(const [n,p] of Object.entries(WXH_PAR)){const key=k.find(x=>x.includes("."+r+".")&&x.includes("."+p+"."));if(!key){ok=false;break;}files[n]={href:it.assets[key].href,size:it.assets[key]["file:size"]||0};}
      if(ok)return {run:r,files};}}
  throw new Error("Zurzeit keine Stundenprognose verfügbar");}
/* Zeilen «id;typ;JJJJMMTThhmm;wert» aus einem Textausschnitt (erste, evtl. angeschnittene Zeile weglassen) */
function wxhLines(t,skipFirst){const L=t.split("\n");if(skipFirst)L.shift();const out=[];for(const l of L){const c=l.split(";");if(c.length<4||!/^\d+$/.test(c[0])||c[2].length<12)continue;out.push([+c[0],c[2],c[3]]);}return out;}
/* Die Stundendateien sind blockweise nach Punkt geordnet, aber NICHT nach Nummer (nur das Symbol ist nach Nummer sortiert).
   Darum einmalig die Reihenfolge der Punkte aus einer Datei lesen (ca. 32 MB, Zeile für Zeile, nichts gespeichert ausser dem Index)
   und danach jede Datei gezielt anspringen. Die Reihenfolge ist bei allen Läufen gleich (geprüft); stimmt sie nicht mehr, wird neu indexiert. */
async function wxhSize(f){if(!f.size){const h=await fetch(f.href,{method:"HEAD",cache:"no-store"});f.size=+h.headers.get("content-length")||0;}if(!f.size)throw new Error("Dateigrösse unbekannt");return f.size;}
async function wxhBuildIndex(f,onProg){const r=await fetch(f.href,{cache:"no-store"});if(!r.ok||!r.body)throw new Error("Index: Fehler "+r.status);const size=await wxhSize(f);
  const rd=r.body.getReader(),dec=new TextDecoder("latin1");let rest="",pos=0,last=-1;const ids=[],off=[];let got=0;
  for(;;){const {done,value}=await rd.read();if(done)break;got+=value.length;onProg&&onProg(got,size);const t=rest+dec.decode(value,{stream:true});let a=0;
    for(;;){const b=t.indexOf("\n",a);if(b<0)break;const sc=t.indexOf(";",a);if(sc>a&&sc<b){const id=+t.slice(a,sc);if(id!==last&&isFinite(id)&&/^\d/.test(t[a])){ids.push(id);off.push(pos);last=id;}}pos+=b-a+1;a=b+1;}
    rest=t.slice(a);}
  return {size,ids,off,t:Date.now()};}
async function wxhIndex(R,onProg){let idx=await metaGet("wxhidx",null);if(idx&&idx.ids&&idx.ids.length>1000&&!idx.bad)return idx;
  idx=await wxhBuildIndex(R.files.r,(g,n)=>onProg&&onProg(g,n));await metaSet("wxhidx",idx);return idx;}
/* Zeilen des Punkts aus einem Textausschnitt sammeln */
function wxhCollect(L,id,until,rows,lastRef){for(const r of L){if(r[0]!==id)continue;if(r[1]>=until)return true;if(r[1]<=lastRef.v)continue;lastRef.v=r[1];rows.push(r);}return false;}
/* Datei nach Nummer sortiert (Symbol): binäre Suche */
async function wxhSorted(f,id,until){const size=await wxhSize(f);let a=0,b=size;
  for(let n=0;n<24&&b-a>24000;n++){const m=Math.floor((a+b)/2);const L=wxhLines(await rangeTxt(f.href,m,m+400),true);if(!L.length)break;if(L[0][0]<id)a=m;else b=m;}
  const rows=[],lr={v:""};let pos=a;for(let g=0;g<12;g++){const t=await rangeTxt(f.href,pos,pos+24000);const L=wxhLines(t,pos>0);const end=wxhCollect(L,id,until,rows,lr);
    if(end||(L.length&&L[L.length-1][0]>id)||t.length<24000)break;pos+=23000;}
  return rows;}
/* Datei in Index-Reihenfolge: Stelle aus dem Index (auf die Dateigrösse umgerechnet), dann anhand der Reihenfolge nachjustieren */
async function wxhIndexed(f,idx,rank,id,until){const size=await wxhSize(f);const k=rank.get(id);if(k==null)return [];
  let est=Math.floor(idx.off[k]*size/idx.size);const W=16000;
  for(let g=0;g<10;g++){const a=Math.max(0,est-W),t=await rangeTxt(f.href,a,a+2*W+12000);const L=wxhLines(t,a>0);if(!L.length)break;
    const first=rank.get(L[0][0]),lastR=rank.get(L[L.length-1][0]);const has=L.some(r=>r[0]===id);
    if(has&&(L[0][0]!==id||a===0)){/* Blockanfang liegt im Fenster: ab dort lesen */const rows=[],lr={v:""};let end=wxhCollect(L,id,until,rows,lr);let pos=a+t.length-1000;
      for(let h=0;h<10&&!end&&L[L.length-1][0]===id;h++){const t2=await rangeTxt(f.href,pos,pos+24000);const L2=wxhLines(t2,true);end=wxhCollect(L2,id,until,rows,lr);if(!L2.length||L2[L2.length-1][0]!==id)break;pos+=23000;}
      return rows;}
    if(has||first==null||first>=k)est-=W;else if(lastR==null||lastR<k)est+=Math.max(W,Math.floor((k-lastR)*(size/idx.ids.length)));else break;}
  throw new Error("Index passt nicht");}
/* Prognosepunkt für einen Ort: nächster Punkt (bis 10 km), bei Höhenangabe auch nach Höhe gewichtet */
function wxhPointFor(meta,lat,lon,h){let best=null,bs=1e9;for(const p of meta.p){const d=distM(lat,lon,p[3],p[4])/1000;if(d>10)continue;const s=d+(h?Math.abs(p[2]-h)/150:0);if(s<bs){bs=s;best=p;}}return best;}
/* Orte, für die Stundenwerte geladen werden: alle eigenen Orte, Touren (höchster Punkt bzw. Mitte), Zuhause, Standort */
function wxhTargets(meta,extra){const set=new Map();const add=(lat,lon,h)=>{if(lat==null)return;const p=wxhPointFor(meta,lat,lon,h);if(p)set.set(p[0],p);};
  for(const p of S.points)if(!p.del)add(p.lat,p.lon,p.hoehe);
  for(const t of S.tours)if(!t.del&&t.bbox){add((t.bbox[0]+t.bbox[2])/2,(t.bbox[1]+t.bbox[3])/2,t.emax);}
  if(S.settings.home)add(S.settings.home.lat,S.settings.home.lon,null);if(S.me)add(S.me.lat,S.me.lon,null);for(const e of extra||[])add(e.lat,e.lon,e.h);
  return [...set.values()];}
/* Laden (bei «Aktualisieren» oder für einen einzelnen Punkt sofort) */
async function fetchHourly(pts,onProg){if(!pts.length)return wxhGet();const R=await wxhRun();let cur=await wxhGet();
  if(!cur||cur.run!==R.run)cur={run:R.run,t:Date.now(),pts:{}};
  const d=new Date();const end=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()+WXH_DAYS+1));const until=end.toISOString().replace(/[-:T]/g,"").slice(0,12);
  const todo=pts.filter(p=>!(cur.pts[p[0]]&&cur.pts[p[0]].r&&cur.pts[p[0]].g));if(!todo.length)return cur;
  const idx=await wxhIndex(R,(g,n)=>progress("Tagesverlauf vorbereiten (einmalig)",Math.round(g/1048576),Math.round(n/1048576),"Reihenfolge der Prognosepunkte · MB"));
  const rank=new Map(idx.ids.map((x,i)=>[x,i]));let bad=0;
  todo.sort((a,b)=>(rank.get(a[0])||0)-(rank.get(b[0])||0));let done=0;
  const utc=s=>Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8),+s.slice(8,10),+s.slice(10,12));
  /* jede Grösse mit eigener Startzeit (Niederschlag ab 22 Uhr UTC, Symbol/Wahrscheinlichkeit ab Mitternacht) */
  const work=async p=>{const out={};await Promise.all(Object.entries(R.files).map(async([n,f])=>{let rows=[];try{rows=n==="s"?await wxhSorted(f,p[0],until):await wxhIndexed(f,idx,rank,p[0],until);}catch(e){bad++;}if(!rows.length)return;
      out[n]={t0:utc(rows[0][1]),v:rows.map(r=>{const v=parseFloat(r[2]);return isFinite(v)?Math.round(v*10)/10:null;})};}));
    if(Object.keys(out).length)cur.pts[p[0]]=out;done++;onProg&&onProg(done,todo.length);};
  /* mehrere Punkte gleichzeitig, aber massvoll */
  const q=todo.slice();await Promise.all([...Array(Math.min(3,q.length))].map(async()=>{while(q.length)await work(q.shift());}));
  if(bad>todo.length){idx.bad=1;await metaSet("wxhidx",idx);}
  cur.t=Date.now();wxhMem=cur;await metaSet("wxh",cur);return cur;}
async function fetchHourlyAll(){const meta=await getWxMeta();if(!meta)return;const pts=wxhTargets(meta);if(!pts.length)return;
  await fetchHourly(pts,(i,n)=>progress("Tagesverlauf laden",i,n,`${n} Prognosepunkte · MeteoSchweiz`));}
/* Werte eines Tages (lokale Zeit) für einen Prognosepunkt */
function wxhDay(h,date){if(!h)return null;const [y,m,dd]=date.split("-").map(Number);const a=new Date(y,m-1,dd).getTime();const out=[];
  const val=(k,t)=>{const x=h[k];if(!x)return null;const i=Math.round((t-x.t0)/3600e3);return i>=0&&i<x.v.length?x.v[i]:null;};
  for(let i=0;i<24;i++){const t=a+i*3600e3;const o={t,r:val("r",t),lo:val("lo",t),hi:val("hi",t),p:val("p",t),s:val("s",t),g:val("g",t)};if(o.r!=null||o.s!=null)out.push(o);}
  return out.length>=6?out:null;}
/* Sonnenauf- und -untergang (NOAA-Näherung, auf wenige Minuten genau) */
function sunTimes(date,lat,lon){const [y,m,d]=date.split("-").map(Number);const N=Math.floor((Date.UTC(y,m-1,d)-Date.UTC(y,0,0))/864e5);const g=2*Math.PI/365*(N-1);
  const eq=229.18*(0.000075+0.001868*Math.cos(g)-0.032077*Math.sin(g)-0.014615*Math.cos(2*g)-0.040849*Math.sin(2*g));
  const dec=0.006918-0.399912*Math.cos(g)+0.070257*Math.sin(g)-0.006758*Math.cos(2*g)+0.000907*Math.sin(2*g)-0.002697*Math.cos(3*g)+0.00148*Math.sin(3*g);
  const ha=Math.acos(Math.cos(90.833*RAD)/(Math.cos(lat*RAD)*Math.cos(dec))-Math.tan(lat*RAD)*Math.tan(dec))/RAD;if(!isFinite(ha))return null;
  const noon=720-4*lon-eq;const base=Date.UTC(y,m-1,d);return {up:base+(noon-4*ha)*60000,down:base+(noon+4*ha)*60000};}
/* Fenster «Tagesverlauf» */
async function dayPanel(pid,date,lat,lon,name){let h=(await wxhGet()||{pts:{}}).pts[pid];
  if(!h&&navigator.onLine){const meta=await getWxMeta();const p=meta&&meta.p.find(x=>x[0]===pid);if(p){progress("Tagesverlauf laden",0,0,"MeteoSchweiz");try{const c=await fetchHourly([p]);h=c.pts[pid];}catch(e){toast(e.message,4000);}finally{progressDone();}}}
  const rows=wxhDay(h,date);const dt=new Date(date+"T12:00");const tStand=(await wxhGet()||{}).t;const st=sunTimes(date,lat,lon);
  openPanel(()=>({title:`Verlauf ${WD[dt.getDay()]} ${dt.getDate()}.${dt.getMonth()+1}.`,icon:`<svg><use href="#i-clock"/></svg>`,html:!rows?`<div class="note">${navigator.onLine?"Für diesen Tag gibt es keine Stundenwerte (nur die nächsten 4 Tage).":"Noch keine Stundenwerte gespeichert – mit Netz «Bulletin & Wetter › Jetzt aktualisieren»."}</div>`:`
    <p class="muted small" style="margin:0 0 6px">${esc(name||"")}${st?` · Sonne ${fmtClock(st.up)} – ${fmtClock(st.down)}`:""}</p>
    <div class="wxh3">${rows.filter(r=>new Date(r.t).getHours()%3===0).map(r=>`<div><small>${String(new Date(r.t).getHours()).padStart(2,"0")}</small>${r.s?wxIcon(r.s,28):""}<b>${r.p!=null?fmtN(r.p)+"%":""}</b></div>`).join("")}</div>
    <div class="card" style="padding:8px"><canvas class="prof" id="wxhC" style="height:190px"></canvas></div>
    <p class="muted small">Säulen: Niederschlag der jeweils vorangehenden Stunde (mm), Strich = Bandbreite (8 von 10 Fällen). Prozent: Niederschlagswahrscheinlichkeit für die 3 Stunden. Linie: Windböen (km/h). Gelb: Tageslicht.<br>Quelle: MeteoSchweiz (lokale Prognose ${tStand?fmtDT(tStand):"–"}).</p>`,
    after(P){if(rows)drawWxh($("#wxhC",P),rows,st);}}));}
function drawWxh(cv,rows,st){const dpr=Math.min(2,devicePixelRatio||1);const W=cv.clientWidth||320,H=cv.clientHeight||190;cv.width=W*dpr;cv.height=H*dpr;const c=cv.getContext("2d");c.scale(dpr,dpr);
  const L=30,R=34,T=18,B=20;const t0=new Date(rows[0].t);t0.setHours(0,0,0,0);const a=t0.getTime(),X=t=>L+(W-L-R)*(t-a)/864e5;
  const rmax=Math.max(1,...rows.map(r=>Math.max(r.hi||0,r.r||0)));const stp=[0.25,0.5,1,2,2.5,5,10,20].find(x=>x*4>=rmax)||Math.ceil(rmax/40)*10;const rm=stp*4;const Y=v=>T+(H-T-B)*(1-v/rm);
  const gmax=Math.max(20,Math.ceil(Math.max(...rows.map(r=>r.g||0))/20)*20);const YG=v=>T+(H-T-B)*(1-v/gmax);
  if(st){c.fillStyle="rgba(242,177,0,.10)";c.fillRect(X(st.up),T,X(st.down)-X(st.up),H-T-B);}
  c.font="10px system-ui";c.fillStyle="#62707d";c.strokeStyle="#dde3e8";c.lineWidth=1;
  for(let k=0;k<=4;k++){const v=rm*k/4,y=Y(v);c.beginPath();c.moveTo(L,y);c.lineTo(W-R,y);c.stroke();c.fillText(fmtN(v,v%1?1:0),2,y+3);c.fillText(fmtN(gmax*k/4),W-R+4,y+3);}
  for(let hh=0;hh<=24;hh+=3){const x=X(a+hh*3600e3);c.fillText(String(hh).padStart(2,"0"),x-6,H-5);}
  c.fillStyle="#1e88e5";c.fillText("mm",2,10);c.fillStyle="#7e57c2";c.fillText("Böen km/h",W-R-30,10);c.fillStyle="#62707d";
  const bw=Math.max(3,(W-L-R)/24*0.62);
  for(const r of rows){const x=X(r.t-1800e3);if(r.r>0){c.fillStyle="#1e88e5";c.fillRect(x-bw/2,Y(r.r),bw,Y(0)-Y(r.r));}
    if(r.hi!=null&&r.hi>0.05){c.strokeStyle="#0d47a1";c.lineWidth=1.3;c.beginPath();c.moveTo(x,Y(r.lo||0));c.lineTo(x,Y(r.hi));c.moveTo(x-bw/3,Y(r.hi));c.lineTo(x+bw/3,Y(r.hi));c.stroke();}}
  c.beginPath();let f=true;for(const r of rows){if(r.g==null)continue;const x=X(r.t),y=YG(r.g);f?c.moveTo(x,y):c.lineTo(x,y);f=false;}c.strokeStyle="#7e57c2";c.lineWidth=2;c.stroke();
  const now=Date.now();if(now>a&&now<a+864e5){c.strokeStyle="#c8102e";c.lineWidth=1;c.beginPath();c.moveTo(X(now),T);c.lineTo(X(now),H-B);c.stroke();}}
/* Antippen einer Tageskachel (überall, wo das Wetter steht) */
document.addEventListener("click",e=>{const b=e.target.closest("[data-wxd]");if(!b)return;const [pid,date,lat,lon]=b.dataset.wxd.split("|");dayPanel(+pid,date,+lat,+lon,b.dataset.wxn||"");});
