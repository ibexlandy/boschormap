/* BoschorMap – Oberfläche: Karte, Orte, Panels, Suche, Menü */
"use strict";
const S={points:[],tours:[],settings:{},photos:new Map(),heat:!!localStorage.getItem("bm_heat")};
let map=null,baseLayer=null,ovLayers={},meMk=null,watchId=null,selTour=null,selPoint=null,tempMk=null;
const markers=new Map();

/* ---------- Meldungen und Fortschritt ---------- */
let _tt=0;function toast(m,ms){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove("show"),ms||2600);}
function progress(title,n,N,sub){const p=$("#prog");p.hidden=false;$("#progT").textContent=title;$("#progB").style.width=(N?Math.round(n/N*100):0)+"%";$("#progS").textContent=sub||(N?`${fmtN(n)} von ${fmtN(N)}`:"");}
function progressDone(){$("#prog").hidden=true;}

/* ---------- Einstellungen ---------- */
function settingsDefault(){return {checklists:JSON.parse(JSON.stringify(DEFAULT_CHECK)),checkState:{},tempo:{},tempoLearn:true,tempoFactor:{},home:null,base:"lk",ov:{},showDone:true,showIdeas:true,showPts:true,mod:0};}
async function loadSettings(){const s=await metaGet("settings",null);S.settings=Object.assign(settingsDefault(),s||{});}
async function saveSettings(sync){S.settings.mod=Date.now();await metaSet("settings",S.settings);if(sync!==false)markDirty();}
/* Ansicht (Karte, Ebenen) nur pro Gerät */
function viewPrefs(){return lsJ("view",{base:"lk",ov:{},showDone:true,showIdeas:true,showPts:true});}
function saveViewPrefs(v){ls("view",JSON.stringify(v));}

/* ---------- Panels (unten auf dem Handy, rechts am PC) ---------- */
const nav=[];
function openPanel(fn,o){nav.push({fn,o:o||{}});renderPanel();const sh=$("#sheet");sh.classList.add("open");sh.setAttribute("aria-hidden","false");document.body.classList.add("so");
  try{if(!(history.state&&history.state.bm))history.pushState({bm:1},"");}catch(e){}}
function replacePanel(fn,o){if(!nav.length)return openPanel(fn,o);nav[nav.length-1]={fn,o:o||{}};renderPanel();}
function panelBack(){nav.pop();if(!nav.length)return closePanel();renderPanel();}
function closePanel(fromPop){nav.length=0;ls("openItem",null);clearTemp();if(S._steep||S._chk){S._steep=null;S._chk=null;map.render();}const sh=$("#sheet");sh.classList.remove("open","half");sh.setAttribute("aria-hidden","true");document.body.classList.remove("so");$("#panel").innerHTML="";
  $$("#bar button").forEach(b=>b.classList.remove("on"));
  if(selTour&&!planState){selTour=null;map.render();removeProfDot();}if(selPoint){selPoint=null;refreshMarkers();}}
window.addEventListener("popstate",()=>{if($(".pbig")){closeGallery();try{history.pushState({bm:1},"");}catch(e){}return;}
  if(!nav.length)return;if(nav.length>1){nav.pop();renderPanel();try{history.pushState({bm:1},"");}catch(e){}}else closePanel(true);});
async function renderPanel(){const top=nav[nav.length-1];if(!top)return;const P=$("#panel");let r;const keep=top.o.keepScroll?[...$$("input,textarea",P)].filter(e=>e.dataset.ed&&e.id&&e.type!=="file"&&e.type!=="checkbox"&&e.value!==e.defaultValue).map(e=>[e.id,e.value]):[];const fid=top.o.keepScroll&&document.activeElement&&P.contains(document.activeElement)?document.activeElement.id:null;try{r=await top.fn();}catch(e){console.error(e);r={title:"Fehler",html:`<div class="card">${esc(e.message)}</div>`};}
  if(nav[nav.length-1]!==top)return;const half=!!(top.o.half||r.half)&&ls("sheetFull")!=="1";$("#sheet").classList.toggle("half",half);$("#sheet").classList.toggle("canhalf",!!(top.o.half||r.half));
  P.innerHTML=`${top.o.half||r.half?`<button class="grab" aria-label="${half?"Grösser":"Kleiner"}"><i></i></button>`:""}<div class="ph">${nav.length>1?`<button class="ib" data-hdr="back" aria-label="Zurück"><svg><use href="#i-back"/></svg></button>`:""}<h2>${r.icon||""}<span>${esc(r.title||"")}</span></h2>${r.tools||""}<button class="ib" data-hdr="close" aria-label="Schliessen"><svg><use href="#i-close"/></svg></button></div><div class="pb">${r.html||""}</div>${r.foot?`<div class="pfoot">${r.foot}</div>`:""}`;
  P.querySelector('[data-hdr="close"]').onclick=()=>r.onClose?r.onClose():closePanel();const gb=P.querySelector(".grab");
  if(gb){const tog=()=>{const full=$("#sheet").classList.toggle("half")===false;ls("sheetFull",full?"1":"0");gb.setAttribute("aria-label",full?"Kleiner":"Grösser");};gb.onclick=tog;
    let y0=null;gb.addEventListener("pointerdown",e=>{y0=e.clientY;});gb.addEventListener("pointerup",e=>{if(y0==null)return;const dy=e.clientY-y0;y0=null;const isHalf=$("#sheet").classList.contains("half");
      if(dy<-25&&isHalf)tog();else if(dy>25&&!isHalf)tog();});}const bb=P.querySelector('[data-hdr="back"]');if(bb)bb.onclick=panelBack;
  if(!top.o.keepScroll)P.scrollTop=0;bindStars(P);if(r.after)try{await r.after(P);}catch(e){console.error(e);toast(e.message);}
  for(const [id,v] of keep){const e=P.querySelector("#"+CSS.escape(id));if(e&&e.value===e.defaultValue){e.value=v;e.dataset.ed="1";}}if(fid){const e=P.querySelector("#"+CSS.escape(fid));if(e)try{e.focus({preventScroll:true});}catch(x){}}}
function refreshPanel(){if(nav.length){nav[nav.length-1].o.keepScroll=true;renderPanel().then(()=>{if(nav.length)nav[nav.length-1].o.keepScroll=false;});}}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$(".pbig")&&nav.length&&!e.target.closest("input,textarea"))panelBack();});

/* Höhe, die ein halbes Panel auf dem Handy über der Karte belegt */
const sheetPad=()=>innerWidth<900?Math.round(($("#mapWrap").clientHeight)*(ls("sheetFull")==="1"?0.2:0.62)):0;
const sheetPadR=()=>innerWidth>=900?510:0;
/* ---------- Sterne ---------- */
function starsHTML(v,key,ro){v=+v||0;let s=`<span class="stars${ro?" ro":""}"${key?` data-stars="${key}"`:""}>`;for(let i=1;i<=5;i++)s+=ro?`<svg class="${i<=v?"on":""}" style="color:${i<=v?"#e0a100":"#c9ced3"}"><use href="#i-star"/></svg>`:`<button type="button" class="${i<=v?"on":""}" data-v="${i}" aria-label="${i} Sterne"><svg><use href="#i-star"/></svg></button>`;return s+"</span>";}
function bindStars(root){$$("[data-stars]",root).forEach(w=>{w.querySelectorAll("button").forEach(b=>b.onclick=()=>{const cur=+w.dataset.val||$$("button.on",w).length;let v=+b.dataset.v;if(v===cur)v=0;w.dataset.val=v;
  w.querySelectorAll("button").forEach(x=>x.classList.toggle("on",+x.dataset.v<=v));w.dispatchEvent(new CustomEvent("stars",{detail:v,bubbles:true}));});});}
const starVal=(root,key)=>{const w=$(`[data-stars="${key}"]`,root);return w?(+w.dataset.val||$$("button.on",w).length):0;};

/* ---------- Symbole ---------- */
const catSvg=c=>`<svg><use href="#c-${c}"/></svg>`;
const catBg=k=>`linear-gradient(145deg,${k.c2||k.c} 0%,${k.c} 78%)`;
function catIc(c,extra){const k=CATS[c]||CATS.ort;return `<span class="ic cat" style="background:${catBg(k)}">${catSvg(c)}</span>`;}
const artIc=a=>`<span class="ic" style="background:${(ARTS[a]||ARTS.wandern).c}"><svg><use href="#i-route"/></svg></span>`;
const pointDone=p=>p.cat==="gipfel"&&(p.visits||[]).length>0;

/* ---------- Karte ---------- */
/* Kartendarstellung: auto (fein nur bei hoher Pixeldichte), fein, normal – alte Ein/Aus-Einstellung wird übernommen */
const hdMode=v=>v.hd===false?"normal":v.hd===true||v.hd==null?"auto":v.hd;
function initMap(){const v=viewPrefs();map=new BMap.Map($("#map"),{minZoom:7,maxZoom:20,bounds:CH_BOUNDS});map.setHD(hdMode(v));
  const lv=lsJ("lastview",null);if(lv&&isFinite(lv.lat))map.setView(lv.lat,lv.lon,lv.z);else map.setView(46.75,8.2,8);
  setBase(v.base||"lk");for(const k in OVERLAYS)if(v.ov&&v.ov[k])setOverlay(k,true);
  map.addDrawer(drawTours);map.addDrawer(drawMisc);map.addDrawer(drawSteep);map.addDrawer(drawCheck);map.addDrawer(drawHeat);
  map.on("moveend",()=>{const c=map.getCenter();ls("lastview",JSON.stringify({lat:+c.lat.toFixed(5),lon:+c.lon.toFixed(5),z:Math.round(map.z*4)/4}));});
  const zInd=()=>{const e=$("#zInd");if(e)e.textContent="Zoom "+Math.round(map.z);};zInd();
  map.on("move",()=>{$("#map").classList.toggle("zl",map.z>=13);zInd();});
  map.on("click",onMapClick);map.on("markerclick",onMarkerClick);map.on("longpress",onLongPress);
  $("#bZin").onclick=()=>map.zoomAnim(Math.round(map.z)+1);$("#bZout").onclick=()=>map.zoomAnim(Math.round(map.z)-1);
  $("#bLayers").onclick=()=>openPanel(layersPanel);$("#bLoc").onclick=toggleLocate;$("#bCam").onclick=tripCam;$("#bAdd").onclick=startPlace;}
function setBase(k){const b=BASES[k]||BASES.lk;if(baseLayer)map.removeLayer(baseLayer);
  baseLayer=map.addLayer(new BMap.TileLayer({url:layerUrl(b.id,b.f),max:b.max,min:7,z:1,bounds:CH_BOUNDS}));const v=viewPrefs();v.base=k;saveViewPrefs(v);}
function setOverlay(k,on){const o=OVERLAYS[k];if(ovLayers[k]){ovLayers[k].forEach(l=>map.removeLayer(l));delete ovLayers[k];}if(!o)return;
  if(on)ovLayers[k]=o.ids.map((id,i)=>map.addLayer(new BMap.TileLayer({url:layerUrl(id,"png"),max:o.max,min:7,hideBelow:o.from,z:10+Object.keys(OVERLAYS).indexOf(k)*2+i,opacity:o.op,bounds:CH_BOUNDS})));
  const v=viewPrefs();v.ov=v.ov||{};v.ov[k]=!!on;saveViewPrefs(v);}
function layersPanel(){const v=viewPrefs();
  return {title:"Karten und Ebenen",icon:`<svg><use href="#i-layers"/></svg>`,html:`
   <div class="card"><h3>Grundkarte</h3><div class="lgrid">${Object.entries(BASES).map(([k,b])=>`<button class="lopt${v.base===k?" on":""}" data-base="${k}">${b.n}</button>`).join("")}</div></div>
   <div class="card"><h3>Ebenen</h3>${Object.entries(OVERLAYS).map(([k,o])=>`<label class="tg"><span>${o.n}<br><small class="muted">ab Zoom ${o.from}</small></span><span class="sw2"><input type="checkbox" data-ov="${k}"${v.ov&&v.ov[k]?" checked":""}><i></i></span></label>`).join("")}</div>
   <div class="card"><h3>Anzeigen</h3>
    <label class="tg"><span>Gemachte Touren</span><span class="sw2"><input type="checkbox" data-show="showDone"${v.showDone!==false?" checked":""}><i></i></span></label>
    <label class="tg"><span>Tourideen (gestrichelt)</span><span class="sw2"><input type="checkbox" data-show="showIdeas"${v.showIdeas!==false?" checked":""}><i></i></span></label>
    <label class="tg"><span>Orte und Gipfel</span><span class="sw2"><input type="checkbox" data-show="showPts"${v.showPts!==false?" checked":""}><i></i></span></label>
    </div>
   <div class="card"><h3>Kartendarstellung</h3><div class="lgrid">${[["auto","Automatisch"],["fein","Fein"],["normal","Normal"]].map(([k,n])=>`<button class="lopt${hdMode(v)===k?" on":""}" data-hd="${k}">${n}</button>`).join("")}</div>
    <p class="muted small" style="margin:8px 0 0">Fein: eine Zoomstufe feinere Karte in halber Grösse – mehr Details, kleinere Schrift (wie swisstopo-App), etwas mehr Daten. Automatisch: fein auf dem Handy, normal am PC.</p></div>
   <p class="muted small">Karten und Ebenen: © swisstopo, BAFU, ASTRA (geo.admin.ch)</p>`,
   after(P){$$("[data-base]",P).forEach(b=>b.onclick=()=>{setBase(b.dataset.base);refreshPanel();});
     $$("[data-ov]",P).forEach(c=>c.onchange=()=>setOverlay(c.dataset.ov,c.checked));
     $$("[data-show]",P).forEach(c=>c.onchange=()=>{const v=viewPrefs();v[c.dataset.show]=c.checked;saveViewPrefs(v);refreshMarkers();map.render();});
     $$("[data-hd]",P).forEach(b=>b.onclick=()=>{const v=viewPrefs();v.hd=b.dataset.hd;saveViewPrefs(v);map.setHD(v.hd);refreshPanel();});}};}

/* Touren zeichnen: vereinfachte Linie je nach Zoom, Farbe nach Art, Ideen gestrichelt */
function tourDisp(t){return t.disp||[];}
function visibleTours(){const v=viewPrefs();return S.tours.filter(t=>!t.del&&t.disp&&t.disp.length>1&&((t.status==="idee")?v.showIdeas!==false:v.showDone!==false)||(selTour&&t.id===selTour&&!t.del));}
/* Steile Abschnitte (ab 30°) der gewählten Tour bzw. Planung */
function drawSteep(c,m){if(!S._steep)return;c.lineCap="round";c.lineJoin="round";for(const r of S._steep){c.beginPath();r.pts.forEach((q,i)=>{const p=m.project(q[0],q[1]);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});
  c.strokeStyle="#fff";c.lineWidth=10;c.stroke();c.strokeStyle=r.c;c.lineWidth=6;c.stroke();}}
function drawTours(c,m){const pk=!!(planState||placing);if(m.el.classList.contains("pick")!==pk)m.el.classList.toggle("pick",pk);if(tpmFor&&tpmFor!==selTour)setTimeout(clearTourPhotoMarks,0);const b=m.getBounds();const sel=selTour;const z=m.z;
  const list=visibleTours();list.sort((a,b2)=>(a.id===sel)-(b2.id===sel));
  for(const t of list){const bb=t.bbox;if(!bb||bb[2]<b[0]||bb[0]>b[2]||bb[3]<b[1]||bb[1]>b[3])continue;const isSel=t.id===sel;
    const L=(isSel&&S._selLine)?S._selLine:t.disp;const step=z<10?4:z<12?2:1;
    c.beginPath();for(let i=0;i<L.length;i+=(i===L.length-1?1:step)){const p=m.project(L[i][0],L[i][1]);if(i)c.lineTo(p.x,p.y);else c.moveTo(p.x,p.y);}
    const lp=m.project(L[L.length-1][0],L[L.length-1][1]);c.lineTo(lp.x,lp.y);
    c.lineJoin="round";c.lineCap="round";c.setLineDash([]);c.strokeStyle="rgba(255,255,255,.9)";c.lineWidth=isSel?9:5.5;c.stroke();
    c.strokeStyle=(ARTS[t.art]||ARTS.wandern).c;c.lineWidth=isSel?5.5:3;if(t.status==="idee")c.setLineDash([9,7]);c.stroke();c.setLineDash([]);
    if(z>=11||isSel){const s=m.project(L[0][0],L[0][1]);dot(c,s.x,s.y,isSel?7:5,"#2e7d32");dot(c,lp.x,lp.y,isSel?7:5,"#c8102e");}}}
function dot(c,x,y,r,col){c.beginPath();c.arc(x,y,r,0,7);c.fillStyle="#fff";c.fill();c.beginPath();c.arc(x,y,r-2,0,7);c.fillStyle=col;c.fill();}
let miscDraw=[];function drawMisc(c,m){for(const f of miscDraw)f(c,m);}
function hitTour(x,y){let best=null;for(const t of visibleTours()){const bb=t.bbox;const ll=map.unproject(x,y);if(!bb)continue;const pad=0.01*Math.pow(2,13-map.z);
    if(ll.lat<bb[0]-pad||ll.lat>bb[2]+pad||ll.lon<bb[1]-pad||ll.lon>bb[3]+pad)continue;const L=t.disp;let prev=map.project(L[0][0],L[0][1]);
    for(let i=1;i<L.length;i++){const p=map.project(L[i][0],L[i][1]);const d=segPx(x,y,prev,p);if(d<14&&(!best||d<best.d))best={t,d};prev=p;}}return best&&best.t;}
function segPx(x,y,a,b){const vx=b.x-a.x,vy=b.y-a.y,L=vx*vx+vy*vy;let t=L?((x-a.x)*vx+(y-a.y)*vy)/L:0;t=Math.max(0,Math.min(1,t));return Math.hypot(x-a.x-t*vx,y-a.y-t*vy);}
function onMapClick(e){if(placing)return;if(planState)return planClick(e);if(regionSel){if(regionSel.shape==="poly")polyClick(e);return;}const t=hitTour(e.x,e.y);if(t){showTour(t.id);return;}
  if(nav.length&&$("#sheet").classList.contains("half")){const a=document.activeElement;
    if(a&&$("#panel").contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){a.blur();return;}
    if(panelDirty()){toast("Eingabe noch nicht gespeichert – mit ✕ schliessen");return;}closePanel();}}
/* Eingabefelder im Fenster, die geändert, aber noch nicht gespeichert sind */
function panelDirty(){return [...$$("#panel input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),#panel textarea")].some(e=>e.dataset.ed&&e.id&&e.value!==e.defaultValue&&e.id!=="sq"&&e.id!=="pq");}
document.addEventListener("input",e=>{const t=e.target;if(t&&t.closest&&t.closest("#panel")&&t.dataset)t.dataset.ed="1";},true);
function onMarkerClick(e){const mk=e.marker;if(regionSel){if(regionSel.shape==="poly"&&!mk.pv)polyClick(e);return;}if(planState&&mk.pid){const p=S.points.find(x=>x.id===mk.pid);if(p)return planClick({lat:p.lat,lon:p.lon,pid:p.id});}
  if(mk.onClick)return mk.onClick(e);if(mk.pid)showPoint(mk.pid);}
function onLongPress(e){if(planState||placing||regionSel)return;const lat=e.lat,lon=e.lon;setTemp(lat,lon);
  openPanel(async()=>({title:"Ort auf der Karte",half:true,html:`<div class="card"><div class="muted">${lat.toFixed(5)}, ${lon.toFixed(5)} · <span id="lpH">Höhe …</span></div></div>
    <div class="btns"><button class="btn pri" id="lpP"><svg><use href="#i-pin"/></svg>Punkt hier setzen</button><button class="btn" id="lpR"><svg><use href="#i-flag"/></svg>Tour von hier planen</button>
    <button class="btn" id="lpW"><svg><use href="#i-sun"/></svg>Wetter & Bulletin</button></div>
    <div class="card" style="margin-top:10px"><h3>Auf der Karte</h3><div id="lpN" class="muted">Namen werden gesucht …</div></div>`,
    async after(P){$("#lpP",P).onclick=()=>{clearTemp();newPoint(lat,lon);};
      namesAt(lat,lon,e.x,e.y).then(L=>{const el=$("#lpN",P);if(!el||!P.contains(el))return;
        if(!L.length){el.innerHTML=navigator.onLine?"Kein Name in der Nähe dieser Stelle.":"Ohne Netz nur in gespeicherten Offline-Regionen.";return;}
        el.innerHTML=L.map((n,i)=>{const own=S.points.find(p=>!p.del&&distM(p.lat,p.lon,n.lat,n.lon)<60);
          return `<button class="li" data-nm="${i}">${catIc(n.cat)}<span class="t"><b>${esc(n.name)}</b><small>${esc(kindTxt(n.kind))}${own?" · schon erfasst":` · als ${CATS[n.cat].n} übernehmen`}</small></span></button>`;}).join("");
        $$("[data-nm]",el).forEach(b=>b.onclick=()=>{const n=L[+b.dataset.nm];const own=S.points.find(p=>!p.del&&distM(p.lat,p.lon,n.lat,n.lon)<60);clearTemp();
          if(own)return showPoint(own.id);nav.pop();newPoint(n.lat,n.lon,{name:n.name,cat:n.cat});});});$("#lpR",P).onclick=()=>{clearTemp();closePanel();startPlan({start:[lat,lon]});};
      $("#lpW",P).onclick=()=>openPanel(()=>conditionsPanel(lat,lon,null,"Ort auf der Karte"));
      const h=await heightAt(lat,lon);const el=$("#lpH",P);if(el)el.textContent=h?fmtN(h)+" m ü. M.":"Höhe nur online";}}));}
const kindTxt=k=>String(k||"").replace(/ue/g,"ü").replace(/oe/g,"ö").replace(/ae/g,"ä").replace(/Ue/g,"Ü");
/* Namen (swissNAMES3D) an einer Stelle der Karte: online bei swisstopo, offline aus den gespeicherten Regionen */
/* Hütten in allen Landessprachen erkennen */
const HUT_RE=/h(ü|ue)tte|biwak|cabane|capanna|unterkunft|rifugio|bivacco|refuge|chamanna|berghaus|berggasthaus/;
function nameCat(kind,name){const k=(kind+" "+name).toLowerCase();return HUT_RE.test(k)?"huette":/gipfel|hügel|huegel|kuppe|horn\b|piz\b/.test(k)?"gipfel":/pass\b|passo|col\b/.test(kind.toLowerCase())?"pass":/\bsee\b|lej\b|lac\b|lago\b/.test(k)||/see$/i.test(kind)?"see":"ort";}
async function namesAt(lat,lon,x,y){const tolPx=28;const mpp=40075016*Math.cos(lat*RAD)/map.S;const rad=Math.max(25,tolPx*mpp);const out=[];
  if(navigator.onLine){try{const [E,N]=toLV95(lat,lon);const a=map.unproject(0,map.h),b=map.unproject(map.w,0);const [E0,N0]=toLV95(a.lat,a.lon),[E1,N1]=toLV95(b.lat,b.lon);
      const ext=[E0,N0,E1,N1].map(v=>Math.round(v)).join(",");
      const u=`https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryPoint&geometry=${E.toFixed(1)},${N.toFixed(1)}&imageDisplay=${Math.round(map.w)},${Math.round(map.h)},96&mapExtent=${ext}&tolerance=${tolPx}&layers=all:ch.swisstopo.swissnames3d&sr=2056&returnGeometry=true&geometryFormat=geojson&limit=12&lang=de`;
      const r=await fetch(u);if(r.ok){const j=await r.json();for(const f of j.results||[]){const at=f.attributes||f.properties||{};if(!at.name)continue;let ll=null;const g=f.geometry;
        if(g&&g.type==="Point")ll=fromLV95(g.coordinates[0],g.coordinates[1]);else if(g&&g.type==="MultiPoint")ll=fromLV95(g.coordinates[0][0],g.coordinates[0][1]);else if(f.bbox)ll=fromLV95((f.bbox[0]+f.bbox[2])/2,(f.bbox[1]+f.bbox[3])/2);if(!ll)continue;
        out.push({name:at.name,kind:at.objektart||"",lat:ll[0],lon:ll[1],area:!!(g&&/Polygon|Line/.test(g.type))});}}}catch(e){}}
  if(!out.length){const L=await searchOfflineNames("");for(const n of (namesCache||[]))if(distM(lat,lon,n.lat,n.lon)<rad*1.5)out.push({name:n.name,kind:n.kind,lat:n.lat,lon:n.lon});}
  const seen=new Set();return out.map(n=>Object.assign(n,{cat:nameCat(n.kind,n.name),d:distM(lat,lon,n.lat,n.lon)})).filter(n=>{const k=n.name+"|"+n.kind;if(seen.has(k))return false;seen.add(k);return true;})
    .sort((a,b)=>(a.area-b.area)||a.d-b.d).slice(0,6);}
function setTemp(lat,lon){clearTemp();tempMk=map.addMarker({lat,lon,cls:"tmp",anchor:[18,46],html:`<svg viewBox="0 0 36 48"><ellipse class="tsh" cx="18" cy="46" rx="6" ry="2"/><path d="M18 45C18 45 3 28 3 17a15 15 0 0 1 30 0c0 11-15 28-15 28z" fill="#c8102e" stroke="#7d0a1c" stroke-width="1.5"/><circle cx="18" cy="17" r="5.5" fill="#fff"/></svg>`,z:50});}
/* Punkt so anfliegen, dass er mitten im sichtbaren Kartenteil liegt (nicht unter dem Fenster) */
function sheetCover(){const sh=$("#sheet");if(innerWidth>=900||!sh||!sh.classList.contains("open"))return 0;const p=$("#panel");return p?Math.min(p.offsetHeight,$("#mapWrap").clientHeight*0.8):0;}
function focusAt(lat,lon,z){z=z??map.z;const S=256*Math.pow(2,z);map.flyTo(BMap.yLat(BMap.latY(lat)+sheetCover()/2/S),BMap.xLon(BMap.lonX(lon)+sheetPadR()/2/S),z);}
function clearTemp(){if(tempMk){map.removeMarker(tempMk);tempMk=null;}}

/* ---------- Punkte auf der Karte ---------- */
function markerHTML(p){const k=CATS[p.cat]||CATS.ort;const st=(p.visits||[]).length?" done":p.cat==="gipfel"?" open":"";
  return `<div class="mk ${p.cat}${st}${selPoint===p.id?" sel":""}" style="background:${catBg(k)};--c:${k.c}">${catSvg(p.cat)}</div>${p.name||p.hoehe?`<div class="mkl" style="--c:${k.c}">${esc(p.name||"")}${p.hoehe?`<b>${fmtN(p.hoehe)}</b>`:""}</div>`:""}`;}
function refreshMarkers(){const v=viewPrefs();for(const m of markers.values())map.removeMarker(m);markers.clear();if(v.showPts===false)return;
  for(const p of S.points){if(p.del)continue;const m=map.addMarker({lat:p.lat,lon:p.lon,anchor:[15,15],html:markerHTML(p),z:p.cat==="gipfel"?3:2});m.pid=p.id;markers.set(p.id,m);}}

/* ---------- Standort (ohne Aufzeichnung) ---------- */
let locFirst=false,meAcc=null;
function toggleLocate(){if(watchId!=null){navigator.geolocation.clearWatch(watchId);watchId=null;$("#bLoc").classList.remove("on");$("#bCam").hidden=true;if(meMk){map.removeMarker(meMk);meMk=null;}meAcc=null;map.render();return;}
  if(!navigator.geolocation)return toast("Standort nicht verfügbar");$("#bLoc").classList.add("on");$("#bCam").hidden=false;locFirst=true;
  watchId=navigator.geolocation.watchPosition(pos=>{const {latitude:la,longitude:lo,accuracy:ac}=pos.coords;S.me={lat:la,lon:lo};
    if(!meMk)meMk=map.addMarker({lat:la,lon:lo,cls:"",anchor:[9,9],html:`<div class="me"></div>`,z:40});else map.moveMarker(meMk,la,lo);meAcc={la,lo,ac};map.render();
    if(locFirst){locFirst=false;map.flyTo(la,lo,Math.max(map.z,14));}},err=>{toast("Standort: "+(err.code===1?"keine Berechtigung":"nicht gefunden"));toggleLocate();},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});}
miscDraw.push((c,m)=>{if(!meAcc)return;const p=m.project(meAcc.la,meAcc.lo);const r=meAcc.ac/(40075016*Math.cos(meAcc.la*RAD)/m.S);if(r<6)return;c.beginPath();c.arc(p.x,p.y,r,0,7);c.fillStyle="rgba(30,136,229,.12)";c.fill();c.strokeStyle="rgba(30,136,229,.5)";c.lineWidth=1;c.stroke();});

/* ---------- Punkt setzen (Fadenkreuz) ---------- */
let placing=false;
function startPlace(){if(planState)return toast("Zuerst die Planung beenden");closePanel();placing=true;$("#cross").hidden=false;map.render();
  modebar(`<b class="grow">Karte unter das Kreuz schieben</b><button class="btn sm" id="mbX">Abbrechen</button><button class="btn sm pri" id="mbOk">Punkt hier setzen</button>`);
  $("#mbX").onclick=endPlace;$("#mbOk").onclick=()=>{const c=map.getCenter();endPlace();newPoint(c.lat,c.lon);};}
function endPlace(){placing=false;$("#cross").hidden=true;modebar(null);map.render();}
function modebar(html){const mb=$("#modebar");if(!html){mb.hidden=true;mb.innerHTML="";return;}mb.innerHTML=html;mb.hidden=false;}

/* ---------- Punkte: anlegen, anzeigen, bearbeiten ---------- */
async function savePoint(p){p.mod=Date.now();await put("points",p);const i=S.points.findIndex(x=>x.id===p.id);if(i<0)S.points.push(p);else S.points[i]=p;markDirty();refreshMarkers();}
async function newPoint(lat,lon,pre){const p=Object.assign({id:uid(),cat:"gipfel",name:"",lat,lon,hoehe:null,hq:"",visits:[],photos:[],note:"",rate:{},created:Date.now()},pre||{});
  openPanel(()=>editPointPanel(p,true));
  if(p.hoehe==null){const h=await heightAt(lat,lon);if(h!=null){p.hoehe=h;p.hq="swisstopo";const el=$("#fH");if(el&&!el.value){el.value=h;el.defaultValue=String(h);const q=$("#fHq");if(q)q.textContent="automatisch (swisstopo)";}}}}
/* Entfernte Kategorien (z. B. «Start / Parkplatz») werden zu «Schöner Ort» */
function fixCats(){const ch=[];for(const p of S.points)if(!CATS[p.cat]){p.cat="ort";p.mod=Date.now();ch.push(p);}if(ch.length)putMany("points",ch).catch(()=>{});}
function editPointPanel(p,isNew){return {title:isNew?"Neuer Ort":"Ort bearbeiten",icon:catIc(p.cat),html:`
  <div class="card"><label class="f">Kategorie</label><div class="chips" id="fCats">${Object.entries(CATS).map(([k,c])=>`<button class="chip${p.cat===k?" on":""}" data-c="${k}">${c.n}</button>`).join("")}</div>
   <label class="f">Name</label><input class="inp" id="fName" value="${esc(p.name)}" placeholder="z. B. Piz Palü" autocomplete="off">
   ${isNew?"":`<label class="f">Höhe (M.ü.M.) <span class="muted small" id="fHq">${p.hq==="swisstopo"?"automatisch (swisstopo)":p.hoehe!=null?"von Hand":"wird automatisch geholt (online)"}</span></label>`}
   <input class="inp" id="fH" inputmode="numeric" value="${p.hoehe!=null?p.hoehe:""}"${isNew?" hidden":""} aria-label="Höhe in M.ü.M.">
   <label class="f">Notiz</label><textarea class="inp" id="fNote">${esc(p.note)}</textarea></div>
  <div class="card"><h3>Bewertung</h3><div class="crit"><span>Gesamt</span>${starsHTML((p.rate||{}).gesamt,"gesamt")}</div><div id="fCrit"></div></div>
  ${isNew&&p.cat==="gipfel"?`<label class="tg card"><span>Besucht</span><span class="sw2"><input type="checkbox" id="fVis"><i></i></span></label>`:""}
  <button class="btn pri full" id="fSave"><svg><use href="#i-check"/></svg>Speichern</button>`,
  after(P){const crit=()=>{const c=$("#fCats .on",P).dataset.c;$("#fCrit",P).innerHTML=(CRIT[c]||[]).map(([k,n])=>`<div class="crit"><span>${n}</span>${starsHTML((p.rate||{})[k],k)}</div>`).join("");bindStars($("#fCrit",P));};
    crit();$$("#fCats .chip",P).forEach(b=>b.onclick=()=>{$$("#fCats .chip",P).forEach(x=>x.classList.remove("on"));b.classList.add("on");crit();});
    if(isNew)setTimeout(()=>{const n=$("#fName",P);if(n&&P.contains(n))n.focus();},250);
    $("#fH",P).oninput=()=>{const q=$("#fHq",P);if(q)q.textContent="von Hand";};
    $("#fSave",P).onclick=async()=>{p.cat=$("#fCats .on",P).dataset.c;p.name=$("#fName",P).value.trim()||CATS[p.cat].n;const h=parseFloat($("#fH",P).value);
      if(isFinite(h)){if(h!==p.hoehe)p.hq=$("#fHq",P).textContent.startsWith("auto")?"swisstopo":"hand";p.hoehe=Math.round(h);}else p.hoehe=null;
      p.note=$("#fNote",P).value.trim();p.rate={gesamt:starVal(P,"gesamt")};for(const [k] of (CRIT[p.cat]||[]))p.rate[k]=starVal(P,k);
      const vis=$("#fVis",P);if(vis&&vis.checked)p.visits=[{d:today(),note:""}];
      await savePoint(p);toast("Gespeichert");if(isNew){nav.pop();showPoint(p.id,true);}else panelBack();};}};}
async function addPointPhotos(p,fl){let n=0,bad=0;
  for(const x of fl){progress("Fotos speichern",n,fl.length);try{const id=await storePhoto(x,p.id);p.photos=(p.photos||[]).concat(id);n++;}catch(e){bad++;}}
  progressDone();if(n)await savePoint(p);toast(bad?`${n} gespeichert, ${bad} nicht lesbar (Format HEIF? In der Samsung-Kamera «Bilder mit hoher Effizienz» ausschalten)`:`${n} Foto${n>1?"s":""} gespeichert`,bad?7000:2500);}
/* Zuletzt offener Ort / offene Tour merken – Ziel für Fotos, die aus der Galerie per «Teilen» kommen */
function rememberOpen(k,id){ls("openItem",JSON.stringify({k,id,t:Date.now()}));}
function recentOpen(){try{const o=JSON.parse(ls("openItem")||"null");if(!o||Date.now()-o.t>3600e3)return null;
  const it=o.k==="p"?S.points.find(x=>x.id===o.id&&!x.del):S.tours.find(x=>x.id===o.id&&!x.del);return it?{k:o.k,it}:null;}catch(e){return null;}}
function showPoint(id,replace){rememberOpen("p",id);const p=S.points.find(x=>x.id===id);if(!p)return;selPoint=id;refreshMarkers();
  const fn=()=>pointPanel(id);if(replace&&nav.length)replacePanel(fn,{half:true});else openPanel(fn,{half:true});
  const pp=map.project(p.lat,p.lon);if(pp.x<40||pp.y<40||pp.x>map.w-40-sheetPadR()||pp.y>map.h-sheetPad()-30){const z=Math.max(map.z,13);const S=256*Math.pow(2,z);map.flyTo(BMap.yLat(BMap.latY(p.lat)+sheetPad()/2/S),BMap.xLon(BMap.lonX(p.lon)+sheetPadR()/2/S),z);}}
async function pointPanel(id){const p=S.points.find(x=>x.id===id);if(p)rememberOpen("p",id);if(!p)return {title:"Ort",html:`<div class="empty">Nicht gefunden</div>`};
  if(p.hoehe==null&&navigator.onLine){heightAt(p.lat,p.lon).then(h=>{if(h!=null){p.hoehe=h;p.hq="swisstopo";savePoint(p).then(refreshPanel);}});}
  const k=CATS[p.cat]||CATS.ort;const vis=(p.visits||[]).slice().sort((a,b)=>String(b.d).localeCompare(String(a.d)));
  const near=S.tours.filter(t=>!t.del&&t.bbox&&p.lat>t.bbox[0]-0.01&&p.lat<t.bbox[2]+0.01&&p.lon>t.bbox[1]-0.01&&p.lon<t.bbox[3]+0.01&&distLine(p.lat,p.lon,t.disp)<150).slice(0,8);
  const ph=p.photos||[];
  const wx=await weatherAt(p.lat,p.lon,p.hoehe).catch(()=>null);const wd=wx&&wx.days.find(d=>d.date===today());
  return {title:p.name||k.n,icon:catIc(p.cat),half:true,tools:wd&&wd.sy?`<button class="ib wxb" id="pWxTop" aria-label="Wetter heute: ${esc(wxText(wd.sy))}" title="Wetter heute: ${esc(wxText(wd.sy))} – antippen für Prognose und Bulletin">${wxIcon(wd.sy,28)}</button>`:"",html:`
   <div class="card"><div class="row"><span class="tag">${k.n}</span>${p.cat==="gipfel"?`<span class="tag" style="background:${vis.length?"#e8f5e9":"#fff3e0"};color:${vis.length?"#2e7d32":"#b26a00"}">${vis.length?`schon oben (${vis.length}×)`:"noch offen"}</span>`:""}
    <span class="grow"></span><b>${p.hoehe!=null?fmtN(p.hoehe)+" M.ü.M.":""}</b></div>
    ${(p.rate||{}).gesamt?`<div class="crit"><span>Gesamt</span>${starsHTML(p.rate.gesamt,"",1)}</div>`:""}
    ${(CRIT[p.cat]||[]).filter(([c])=>(p.rate||{})[c]).map(([c,n])=>`<div class="crit"><span class="muted">${n}</span>${starsHTML(p.rate[c],"",1)}</div>`).join("")}
    ${p.note?`<p style="white-space:pre-wrap;margin:8px 0 0">${esc(p.note)}</p>`:""}</div>
   ${ph.length?`<div class="card"><div class="thumbs" id="pThumbs">${ph.map((x,i)=>`<img data-i="${i}" alt="">`).join("")}</div></div>`:""}
   <div class="card"><h3>Besuche</h3>${vis.length?vis.map(v=>`<div class="visit"><b style="min-width:84px"${v.d?"":' class="muted" title="Datum unbekannt"'}>${fmtVisit(v.d)}</b><span class="grow">${esc(v.note||"")}${v.tour?` <a href="#" data-tour="${v.tour}">Tour</a>`:""}</span><button class="ib" data-delv="${esc(v.d)}|${esc(v.note||"")}" aria-label="Besuch löschen" style="width:32px;height:32px"><svg style="width:16px;height:16px"><use href="#i-trash"/></svg></button></div>`).join(""):`<div class="muted">Noch keine Besuche eingetragen.</div>`}
    <div class="row" style="margin-top:8px"><input type="date" class="inp" id="vD" value="${today()}" style="width:150px"><input class="inp grow" id="vN" placeholder="kurze Notiz" enterkeyhint="done"><button class="btn" id="vAdd"><svg><use href="#i-plus"/></svg>Besuch</button></div>${vis.some(v=>!v.d)?"":`<button class="lnk" id="vOld" style="margin-top:6px"><svg><use href="#i-clock"/></svg>Früher schon hier – Datum unbekannt</button>`}</div>
   ${near.length?`<div class="card"><h3>Touren hier</h3>${near.map(t=>`<button class="li" data-tour="${t.id}"><span class="sw" style="background:${ARTS[t.art].c}"></span><span class="t"><b>${esc(t.name)}</b><small>${t.status==="idee"?"Idee":fmtDate(t.date)} · ${fmtKm(t.dist)}</small></span></button>`).join("")}</div>`:""}
   <div class="btns"><button class="btn" id="pEd"><svg><use href="#i-edit"/></svg>Bearbeiten</button><button class="btn" id="pPh"><svg><use href="#i-cam"/></svg>Foto</button>
    <button class="btn" id="pPl"><svg><use href="#i-flag"/></svg>Tour planen</button><button class="btn" id="pWx"><svg><use href="#i-sun"/></svg>Wetter & Bulletin</button>
    <button class="btn red" id="pDel"><svg><use href="#i-trash"/></svg>Löschen</button></div>
   <p class="muted small">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</p>`,
   async after(P){if(ph.length){const ims=$$("#pThumbs img",P);for(let i=0;i<ph.length;i++){thumbURL(ph[i]).then(u=>{ims[i].src=u;});ims[i].onclick=()=>showGallery(ph,i);}}
     $("#pEd",P).onclick=()=>openPanel(()=>editPointPanel(p,false));
     $("#pPh",P).onclick=()=>{const f=$("#fPtPhoto");f.onchange=async()=>{const fl=[...f.files];f.value="";if(!fl.length)return;await addPointPhotos(p,fl);refreshPanel();};f.click();};
     $("#pPl",P).onclick=()=>{closePanel();startPlan({start:[p.lat,p.lon],pid:p.id});};
     $("#pWx",P).onclick=()=>openPanel(()=>conditionsPanel(p.lat,p.lon,p.hoehe,p.name));if($("#pWxTop",P))$("#pWxTop",P).onclick=$("#pWx",P).onclick;
     $("#pDel",P).onclick=async()=>{if(!confirm(`«${p.name}» löschen? (bleibt 30 Tage im Papierkorb)`))return;p.del=Date.now();await savePoint(p);closePanel();toast("Gelöscht – im Papierkorb");};
     $("#vAdd",P).onclick=async()=>{const d=$("#vD",P).value;if(!d)return toast("Datum wählen");p.visits=(p.visits||[]).concat({d,note:$("#vN",P).value.trim()});$("#vN",P).value="";$("#vN",P).defaultValue="";$("#vD",P).value=$("#vD",P).defaultValue;await savePoint(p);toast("Besuch gespeichert");refreshPanel();};
     if($("#vOld",P))$("#vOld",P).onclick=async()=>{p.visits=(p.visits||[]).concat({d:"",note:$("#vN",P).value.trim()});$("#vN",P).value="";$("#vN",P).defaultValue="";await savePoint(p);toast("Früherer Besuch gespeichert");refreshPanel();};
     $("#vN",P).onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("#vAdd",P).click();}};
     $$("[data-delv]",P).forEach(b=>b.onclick=async()=>{const [d,n]=b.dataset.delv.split("|");if(!confirm(d?"Besuch vom "+fmtDate(d)+" löschen?":"Früheren Besuch (ohne Datum) löschen?"))return;
       const i=p.visits.findIndex(v=>v.d===d&&(v.note||"")===n);if(i>=0)p.visits.splice(i,1);await savePoint(p);refreshPanel();});
     $$("[data-tour]",P).forEach(b=>b.onclick=e=>{e.preventDefault();showTour(b.dataset.tour);});}};}

/* ---------- Orte-Liste ---------- */
let ptFilter={cat:"",state:"",q:"",sort:"name"};
function pointsPanel(){const pts=S.points.filter(p=>!p.del);
  let L=pts.filter(p=>(!ptFilter.cat||p.cat===ptFilter.cat)&&(!ptFilter.state||(ptFilter.state==="oben"?pointDone(p):p.cat==="gipfel"&&!pointDone(p)))&&(!ptFilter.q||(p.name+" "+(p.note||"")).toLowerCase().includes(ptFilter.q.toLowerCase())));
  const c=map.getCenter();const lastV=p=>(p.visits||[]).map(v=>v.d).sort().pop()||"";
  const so={name:(a,b)=>(a.name||"").localeCompare(b.name||"","de"),hoehe:(a,b)=>(b.hoehe||0)-(a.hoehe||0),rate:(a,b)=>((b.rate||{}).gesamt||0)-((a.rate||{}).gesamt||0),
    nah:(a,b)=>distM(c.lat,c.lon,a.lat,a.lon)-distM(c.lat,c.lon,b.lat,b.lon),besuch:(a,b)=>lastV(b).localeCompare(lastV(a))};L.sort(so[ptFilter.sort]||so.name);
  const nG=pts.filter(p=>p.cat==="gipfel"),nO=nG.filter(pointDone).length;
  return {title:"Orte und Gipfel",icon:`<svg><use href="#i-list"/></svg>`,html:`
   <div class="kv" style="margin-bottom:10px"><div><b>${fmtN(pts.length)}</b><small>Orte</small></div><div><b>${fmtN(nO)}</b><small>Gipfel oben</small></div><div><b>${fmtN(nG.length-nO)}</b><small>Gipfel offen</small></div></div>
   <div class="chips"><button class="chip${!ptFilter.cat?" on":""}" data-cat="">Alle</button>${Object.entries(CATS).map(([k,v])=>`<button class="chip${ptFilter.cat===k?" on":""}" data-cat="${k}">${v.n}</button>`).join("")}</div>
   ${ptFilter.cat==="gipfel"?`<div class="chips"><button class="chip${!ptFilter.state?" on":""}" data-st="">Alle Gipfel</button><button class="chip${ptFilter.state==="oben"?" on":""}" data-st="oben">Schon oben</button><button class="chip${ptFilter.state==="offen"?" on":""}" data-st="offen">Noch offen</button></div>`:""}
   <div class="row" style="margin-bottom:8px"><input class="inp grow" id="pq" placeholder="Filtern …" value="${esc(ptFilter.q)}"><select class="inp" id="psort" style="width:auto">${[["name","Name"],["hoehe","Höhe"],["rate","Bewertung"],["nah","Nähe Karte"],["besuch","Letzter Besuch"]].map(([k,n])=>`<option value="${k}"${ptFilter.sort===k?" selected":""}>${n}</option>`).join("")}</select></div>
   <div id="plist">${L.slice(0,400).map(p=>`<button class="li" data-id="${p.id}">${catIc(p.cat)}<span class="t"><b>${esc(p.name||CATS[p.cat].n)}</b><small>${p.hoehe!=null?fmtN(p.hoehe)+" m · ":""}${p.cat==="gipfel"?(pointDone(p)?`oben ${(p.visits||[]).length}× · zuletzt ${fmtVisit(lastV(p))}`:"noch offen"):CATS[p.cat].n}</small></span>${(p.rate||{}).gesamt?starsHTML(p.rate.gesamt,"",1):""}</button>`).join("")||`<div class="empty">Keine Orte. Mit dem roten Knopf auf der Karte oder lange drücken einen Ort setzen.</div>`}</div>`,
   after(P){$$("[data-cat]",P).forEach(b=>b.onclick=()=>{ptFilter.cat=b.dataset.cat;ptFilter.state="";refreshPanel();});
     $$("[data-st]",P).forEach(b=>b.onclick=()=>{ptFilter.state=b.dataset.st;refreshPanel();});
     $("#psort",P).onchange=e=>{ptFilter.sort=e.target.value;refreshPanel();};
     let tm;$("#pq",P).oninput=e=>{clearTimeout(tm);tm=setTimeout(()=>{ptFilter.q=e.target.value;refreshPanel();setTimeout(()=>{const q=$("#pq");if(q){q.focus();q.setSelectionRange(q.value.length,q.value.length);}},30);},300);};
     $$("#plist .li",P).forEach(b=>b.onclick=()=>showPoint(b.dataset.id));}};}

/* ---------- Fotos ---------- */
function resizeImg(file,max,q){return new Promise((res,rej)=>{const img=new Image();const u=URL.createObjectURL(file);
  img.onload=()=>{let w=img.naturalWidth,h=img.naturalHeight;const s=Math.min(1,max/Math.max(w,h));w=Math.round(w*s);h=Math.round(h*s);
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;cv.getContext("2d").drawImage(img,0,0,w,h);URL.revokeObjectURL(u);cv.toBlob(b=>b?res(b):rej(new Error("Bild")),"image/jpeg",q);};
  img.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("Bild konnte nicht gelesen werden"));};img.src=u;});}
async function storePhoto(file,pid,info){const blob=await resizeImg(file,1600,0.8);const thumb=await resizeImg(blob,320,0.7);
  const ph={id:uid(),pid,blob,thumb,t:(info&&info.time)||file.lastModified||Date.now(),lat:info&&info.ll?info.ll[0]:null,lon:info&&info.ll?info.ll[1]:null,mod:Date.now()};await put("photos",ph);return ph.id;}
const thumbs=new Map();
async function thumbURL(id){if(thumbs.has(id))return thumbs.get(id);const p=await getOne("photos",id);if(!p)return "";const u=URL.createObjectURL(p.thumb||p.blob);thumbs.set(id,u);
  if(thumbs.size>200){const k=thumbs.keys().next().value;URL.revokeObjectURL(thumbs.get(k));thumbs.delete(k);}return u;}
/* Vollbild: blättern (wischen, Pfeile), zoomen (zwei Finger, Mausrad, Doppeltipp) */
let galClose=null;function closeGallery(){if(galClose)galClose();}
async function showGallery(ids,start,go_){ids=(ids||[]).filter(Boolean);if(!ids.length)return;let i=Math.max(0,Math.min(start||0,ids.length-1)),url="";
  const w=document.createElement("div");w.className="pbig";
  w.innerHTML=`<img draggable="false" alt=""><div class="gcnt"></div><div class="gcap"></div>${ids.length>1?`<button class="gnav gp" aria-label="Vorheriges">‹</button><button class="gnav gn" aria-label="Nächstes">›</button>`:""}<button class="pbx" aria-label="Schliessen">✕</button>`;
  document.body.appendChild(w);const img=w.querySelector("img");let s=1,tx=0,ty=0;
  const ap=()=>{img.style.transform=`translate(${tx}px,${ty}px) scale(${s})`;w.classList.toggle("zoomed",s>1.01);};const reset=()=>{s=1;tx=0;ty=0;ap();};
  const show=async()=>{reset();w.querySelector(".gcnt").textContent=ids.length>1?`${i+1} / ${ids.length}`:"";w.querySelector(".gcap").textContent=go_&&go_.cap?go_.cap(i)||"":"";try{const ph=await getOne("photos",ids[i]);if(url)URL.revokeObjectURL(url);url=ph&&ph.blob?URL.createObjectURL(ph.blob):"";img.src=url;}catch(e){}};
  const go=d=>{if(ids.length<2)return;i=(i+d+ids.length)%ids.length;show();};
  const key=e=>{if(e.key==="ArrowRight")go(1);else if(e.key==="ArrowLeft")go(-1);else if(e.key==="Escape")galClose();};document.addEventListener("keydown",key);
  galClose=()=>{document.removeEventListener("keydown",key);if(url)URL.revokeObjectURL(url);w.remove();galClose=null;};
  w.querySelector(".pbx").onclick=e=>{e.stopPropagation();galClose();};
  const gp=w.querySelector(".gp"),gn=w.querySelector(".gn");if(gp){gp.onclick=e=>{e.stopPropagation();go(-1);};gn.onclick=e=>{e.stopPropagation();go(1);};}
  const zoomAt=(ns,cx,cy)=>{ns=Math.max(1,Math.min(5,ns));const r=w.getBoundingClientRect(),ox=cx-r.width/2,oy=cy-r.height/2;tx=ox-(ox-tx)*ns/s;ty=oy-(oy-ty)*ns/s;s=ns;if(s<=1.01){s=1;tx=0;ty=0;}ap();};
  w.addEventListener("wheel",e=>{e.preventDefault();zoomAt(s*(e.deltaY<0?1.2:1/1.2),e.clientX,e.clientY);},{passive:false});
  const P=new Map();let st=null,lastTap=0,moved=false;
  w.addEventListener("pointerdown",e=>{if(e.target.closest("button"))return;w.setPointerCapture(e.pointerId);P.set(e.pointerId,{x:e.clientX,y:e.clientY});moved=false;
    const a=[...P.values()];st=a.length===2?{d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),s,cx:(a[0].x+a[1].x)/2,cy:(a[0].y+a[1].y)/2}:{x:e.clientX,y:e.clientY,tx,ty};});
  w.addEventListener("pointermove",e=>{if(!P.has(e.pointerId))return;P.set(e.pointerId,{x:e.clientX,y:e.clientY});const a=[...P.values()];
    if(a.length===2&&st&&st.d){zoomAt(st.s*Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)/st.d,st.cx,st.cy);moved=true;return;}
    if(a.length===1&&st&&st.x!==undefined){const dx=e.clientX-st.x,dy=e.clientY-st.y;if(Math.abs(dx)+Math.abs(dy)>8)moved=true;if(s>1){tx=st.tx+dx;ty=st.ty+dy;ap();}else img.style.transform=`translateX(${dx}px)`;}});
  const up=e=>{if(!P.has(e.pointerId))return;const one=P.size===1;P.delete(e.pointerId);
    if(one&&st&&st.x!==undefined){const dx=e.clientX-st.x;if(!moved){const now=Date.now();if(now-lastTap<320){lastTap=0;if(s>1)reset();else zoomAt(2.5,e.clientX,e.clientY);}else lastTap=now;}
      else if(s===1){if(Math.abs(dx)>60)go(dx<0?1:-1);else ap();}}st=null;if(P.size===1){const a=[...P.values()][0];st={x:a.x,y:a.y,tx,ty};moved=true;}};
  w.addEventListener("pointerup",up);w.addEventListener("pointercancel",up);show();}

/* ---------- Suche: eigene Orte und Touren, gespeicherte Namen (offline), geo.admin (online) ---------- */
const normS=x=>String(x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
/* Koordinaten erkennen: LV95 (2'600'000 / 1'200'000), LV03 (600000 / 200000), WGS84 dezimal (46.5, 8.1) oder Grad/Minuten/Sekunden */
function parseCoord(s){const r=parseCoord1(s);if(r||!/\d\.\d{3}(?!\d)/.test(s))return r;return parseCoord1(s.replace(/(\d)\.(?=\d{3}(?!\d))/g,"$1"));}
/* Punkt als Tausendertrenner (706.700 / 257.508) wird nur versucht, wenn die Lesart als Dezimalzahl nichts ergibt */
function parseCoord1(s){const t=s.replace(/[’'`´]/g,"").trim();
  const dms=[...t.matchAll(/(\d{1,2})\s*°\s*(?:(\d{1,2}(?:\.\d+)?)\s*[′']?\s*(?:(\d{1,2}(?:\.\d+)?)\s*["″]?)?)?\s*([NSEOW])?/gi)];
  let a,b;if(dms.length>=2){const v=m=>+m[1]+(+(m[2]||0))/60+(+(m[3]||0))/3600;a=v(dms[0]);b=v(dms[1]);}
  else{const n=t.match(/^[NE]?\s*(-?\d+(?:\.\d+)?)\s*[,;/\s]\s*[NE]?\s*(-?\d+(?:\.\d+)?)\s*$/i);if(!n)return null;a=+n[1];b=+n[2];}
  const ok=(la,lo)=>la>45.6&&la<48&&lo>5.7&&lo<10.7;
  const lv=(E,N)=>{const [la,lo]=fromLV95(E,N);return ok(la,lo)?{lat:la,lon:lo,label:`LV95 ${fmtN(Math.round(E))} / ${fmtN(Math.round(N))}`}:null;};
  if(a>2e6&&b>1e6&&a<3e6&&b<2e6)return lv(a,b);if(b>2e6&&a>1e6&&b<3e6&&a<2e6)return lv(b,a);
  if(a>4e5&&a<9e5&&b>4e4&&b<4e5)return lv(a+2e6,b+1e6);if(b>4e5&&b<9e5&&a>4e4&&a<4e5)return lv(b+2e6,a+1e6);
  const w=(la,lo)=>{const [E,N]=toLV95(la,lo);return {lat:la,lon:lo,label:`LV95 ${fmtN(Math.round(E))} / ${fmtN(Math.round(N))}`};};if(ok(a,b))return w(a,b);if(ok(b,a))return w(b,a);return null;}
function searchPanel(){return {title:"Suchen",icon:`<svg><use href="#i-search"/></svg>`,html:`<input class="inp" id="sq" placeholder="Gipfel, Hütte, Ort, Tour, Notiz, Koordinate …" autocomplete="off" enterkeyhint="search"><div id="sres" style="margin-top:10px"></div>`,
  after(P){const q=$("#sq",P);setTimeout(()=>q.focus(),200);let tm,seq=0;
    q.oninput=()=>{clearTimeout(tm);tm=setTimeout(async()=>{const s=q.value.trim();const my=++seq;const out=$("#sres",P);if(s.length<2){out.innerHTML="";return;}const lo=s.toLowerCase();
      const nq=normS(s);const hit=x=>x&&normS(x).includes(nq);
      const snip=(x,src)=>{const n=normS(x),i=n.indexOf(nq);if(i<0)return "";const a=Math.max(0,i-30),e=Math.min(x.length,i+nq.length+40);
        return `<span class="snip">${src}: ${a?"…":""}${esc(x.slice(a,i))}<mark>${esc(x.slice(i,i+nq.length))}</mark>${esc(x.slice(i+nq.length,e))}${e<x.length?"…":""}</span>`;};
      const own=[];for(const p of S.points){if(p.del)continue;let sn="";if(hit(p.name))sn=" ";else if(hit(p.note))sn=snip(p.note,"Beschreibung");else{const v=(p.visits||[]).find(v=>hit(v.note));if(v)sn=snip(v.note,"Gipfelbuch "+fmtVisit(v.d));}
        if(sn)own.push([p,sn]);if(own.length>=25)break;}
      const tr=[];for(const t of S.tours){if(t.del)continue;let sn="";if(hit(t.name))sn=" ";else if(hit(t.note))sn=snip(t.note,"Notiz");if(sn)tr.push([t,sn]);if(tr.length>=15)break;}
      const co=parseCoord(s);
      let html=(co?`<button class="li" data-ll="${co.lat},${co.lon}" data-nm="${esc(co.label)}" data-kind="Koordinate"><span class="ic" style="background:#24507a"><svg><use href="#i-locate"/></svg></span><span class="t"><b>${esc(co.label)}</b><small>Koordinate · ${co.lat.toFixed(5)}, ${co.lon.toFixed(5)}</small></span></button>`:"")+
        own.map(([p,sn])=>`<button class="li" data-p="${p.id}">${catIc(p.cat)}<span class="t"><b>${esc(p.name)}</b><small>Mein Ort${p.hoehe?" · "+fmtN(p.hoehe)+" m":""}</small>${sn.trim()?sn:""}</span></button>`).join("")+
        tr.map(([t,sn])=>`<button class="li" data-t="${t.id}">${artIc(t.art)}<span class="t"><b>${esc(t.name)}</b><small>${t.status==="idee"?"Touridee":"Tour "+fmtDate(t.date)}</small>${sn.trim()?sn:""}</span></button>`).join("");
      out.innerHTML=html+`<div id="snames"></div>`;bindRes(out);if(co)return;
      const names=await searchOfflineNames(lo);if(my!==seq)return;const seen=new Set();
      let nh=names.slice(0,25).map(n=>{seen.add(n.name+"|"+Math.round(n.lat*100));return resRow(n,"offline gespeichert");}).join("");
      if(navigator.onLine){try{const r=await fetch(`https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(s)}&type=locations&sr=4326&limit=20&lang=de`);const j=await r.json();if(my!==seq)return;
        for(const x of j.results||[]){const a=x.attrs;const label=(a.label||"").replace(/<[^>]+>/g,"");const m=label.match(/^(.*?)\s{2,}|^/);const n={name:label,lat:a.lat,lon:a.lon,kind:a.origin};
          if(seen.has(label+"|"+Math.round(a.lat*100)))continue;nh+=resRow(n,"geo.admin.ch");}}catch(e){}}
      const sn=$("#snames",P);if(sn){sn.innerHTML=nh?`<h3 class="muted small" style="margin:10px 0 6px">KARTE / ORTSNAMEN</h3>`+nh:(navigator.onLine?"":`<p class="muted small">Offline: gesucht wird in eigenen Orten, Touren und den Namen gespeicherter Regionen.</p>`);bindRes(sn);}},250);};
    function resRow(n,src){return `<button class="li" data-ll="${n.lat},${n.lon}" data-nm="${esc(n.name)}" data-kind="${esc(n.kind||"")}" data-h="${n.h||""}"><span class="ic" style="background:#8a8f94"><svg><use href="#i-pin"/></svg></span><span class="t"><b>${esc(n.name)}</b><small>${esc(n.kind?n.kind+" · ":"")}${src}</small></span></button>`;}
    function bindRes(el){$$("[data-p]",el).forEach(b=>b.onclick=()=>showPoint(b.dataset.p));$$("[data-t]",el).forEach(b=>b.onclick=()=>showTour(b.dataset.t));
      $$("[data-ll]",el).forEach(b=>b.onclick=()=>{const [la,lo]=b.dataset.ll.split(",").map(Number);const fz=Math.max(map.z,14);setTemp(la,lo);
        const nm=b.dataset.nm.replace(/^(Alpiner Gipfel|Gipfel|Hauptgipfel|Huegel|Hügel|Pass|See|Huette|Hütte|Alpine Huette|Ort)\s+/,"").replace(/\s*\([A-Z]{2}\).*$/,"");
        const kind=(b.dataset.nm+" "+b.dataset.kind).toLowerCase();const cat=HUT_RE.test(kind)?"huette":/gipfel|huegel|hügel|grat|horn/.test(kind)?"gipfel":/pass/.test(kind)?"pass":/see\b/.test(kind)?"see":"ort";
        const sub=b.dataset.nm!==nm?b.dataset.nm:(b.dataset.kind||"");
        replacePanel(()=>({title:nm,half:true,html:`${sub?`<p class="muted small" style="margin:0 0 10px">${esc(sub)}</p>`:""}<div class="btn3"><button class="btn pri" id="srP"><svg><use href="#i-pin"/></svg>Speichern</button><button class="btn" id="srR"><svg><use href="#i-flag"/></svg>Planen</button><button class="btn" id="srW"><svg><use href="#i-sun"/></svg>Wetter</button></div>`,
          after(P2){requestAnimationFrame(()=>focusAt(la,lo,fz));$("#srP",P2).title=`Als ${CATS[cat].n} übernehmen`;$("#srP",P2).onclick=()=>{clearTemp();newPoint(la,lo,{name:nm,cat});};$("#srR",P2).onclick=()=>{clearTemp();closePanel();startPlan({end:[la,lo]});};
            $("#srW",P2).onclick=()=>openPanel(()=>conditionsPanel(la,lo,null,nm));}}));});}
    q.onkeydown=e=>{if(e.key==="Enter")q.blur();};}};}

/* ---------- Menü ---------- */
function morePanel(){const it=(id,ic,t,s)=>`<button class="li" data-m="${id}"><span class="ic" style="background:var(--nacht)"><svg><use href="#${ic}"/></svg></span><span class="t"><b>${t}</b><small>${s}</small></span></button>`;
  return {title:"Mehr",icon:`<svg><use href="#i-more"/></svg>`,html:`
   <h4 class="mgrp">Hinzufügen</h4>
   ${it("gpx","i-gpx","GPX importieren","Touren aus der Suunto-App, auch mehrere auf einmal")}
   ${it("photos","i-cam","Fotos als Orte","Fotos mit Aufnahmeort als Orte erfassen")}
   ${it("tcam","i-camgo","Foto unterwegs","Für die laufende Tour – kommt beim GPX-Import auf die Route")}
   <h4 class="mgrp">Unterwegs</h4>
   ${it("regions","i-down","Offline-Regionen","Karten für unterwegs ohne Netz speichern")}
   ${it("cond","i-snow","Lawinenbulletin & Wetter","Für unterwegs speichern (SLF, MeteoSchweiz)")}
   ${it("check","i-check","Checklisten","Pro Sportart, zum Abhaken")}
   <h4 class="mgrp">Rückblick</h4>
   ${it("book","i-book","Gipfelbuch","Alle bestiegenen Gipfel, Jahre, Höhenmeter")}
   ${it("heat","i-heat",S.heat?"Heatmap ausblenden":"Heatmap zeigen","Wo du überall unterwegs warst")}
   ${it("tempo","i-gauge","Persönliches Tempo","Aus deinen Touren gelernt, pro Sportart")}
   <h4 class="mgrp">Daten & Einstellungen</h4>
   ${it("admin","i-table","Verwaltung (Tabelle)","Alle Orte und Touren bearbeiten, am PC")}
   ${it("drive","i-sync","Google Drive","Abgleich zwischen PC, Handys und Tablet")}
   ${it("data","i-box","Daten und Sicherung","Sicherung als Datei, Papierkorb, Export")}
   ${it("settings","i-edit","Einstellungen","Zuhause, Speicher, App-Version")}
   ${it("info","i-info","Quellen und Hinweise","swisstopo, SLF, MeteoSchweiz, BRouter")}`,
   after(P){$$("[data-m]",P).forEach(b=>b.onclick=()=>{const m=b.dataset.m;
     if(m==="gpx")$("#fGpx").click();else if(m==="photos")openPanel(photoImportStart);else if(m==="tcam")tripCam();else if(m==="regions")openPanel(regionsPanel);else if(m==="cond")openPanel(condCenterPanel);
     else if(m==="book")openPanel(gipfelbuchPanel);else if(m==="heat"){S.heat=!S.heat;ls("heat",S.heat?"1":"");closePanel();map.render();toast(S.heat?"Heatmap: alle gemachten Touren":"Heatmap aus");}
     else if(m==="tempo")openPanel(tempoPanel);else if(m==="check")openPanel(()=>checklistPanel());else if(m==="admin")showAdmin();else if(m==="drive")openPanel(drivePanel);
     else if(m==="data")openPanel(dataPanel);else if(m==="settings")openPanel(settingsPanel);else if(m==="info")openPanel(infoPanel);});}};}
function infoPanel(){return {title:"Quellen und Hinweise",html:`<div class="card"><p><b>Karten:</b> © swisstopo (Landeskarte, Winterkarte, SWISSIMAGE, Hangneigung, Skitouren- und Wanderwege), © BAFU (Wildruhezonen, Jagdbanngebiete), © ASTRA / SchweizMobil (Velo- und Mountainbike-Routen) – über geo.admin.ch.</p>
   <p><b>Höhen und Namen:</b> © swisstopo (swissALTI3D, swissNAMES3D).</p><p><b>Lawinenbulletin:</b> WSL-Institut für Schnee- und Lawinenforschung SLF, <a href="https://www.slf.ch" target="_blank" rel="noopener">www.slf.ch</a> (CC BY 4.0).</p>
   <p><b>Wetter:</b> Quelle: MeteoSchweiz (Open Data).</p><p><b>Wegführung beim Planen:</b> BRouter (brouter.de), Daten © OpenStreetMap-Mitwirkende.</p></div>
   <div class="note">Bulletin und Wetter in der App sind eine Hilfe für unterwegs. Massgebend sind immer die aktuellen Angaben von SLF und MeteoSchweiz sowie die eigene Beurteilung vor Ort.</div>`};}
function settingsPanel(){const h=S.settings.home;return {title:"Einstellungen",html:`
  <div class="card"><h3>Zuhause</h3><p class="muted">Für «Ideen»: Entfernung der Tourideen ab zu Hause.</p><div class="muted">${h?`${esc(h.name||"gesetzt")} (${h.lat.toFixed(4)}, ${h.lon.toFixed(4)})`:"noch nicht gesetzt"}</div>
   <div class="btns" style="margin-top:8px"><button class="btn" id="sHomeMap">Kartenmitte als Zuhause</button>${S.me?`<button class="btn" id="sHomeMe">Standort als Zuhause</button>`:""}</div></div>
  <div class="card"><h3>Speicher</h3><div id="sStor" class="muted">wird berechnet …</div><div class="btns" style="margin-top:8px"><button class="btn" id="sPersist">Dauerhaft speichern anfragen</button></div></div>
  <div class="card"><h3>App-Version</h3><p>BoschorMap v${APP_VERSION}</p><button class="btn" id="sUpd"><svg><use href="#i-sync"/></svg>Nach Update suchen</button></div>`,
  async after(P){$("#sHomeMap",P).onclick=async()=>{const c=map.getCenter();S.settings.home={lat:c.lat,lon:c.lon,name:"Kartenmitte"};await saveSettings();refreshPanel();};
    const hm=$("#sHomeMe",P);if(hm)hm.onclick=async()=>{S.settings.home={lat:S.me.lat,lon:S.me.lon,name:"Standort"};await saveSettings();refreshPanel();};
    $("#sPersist",P).onclick=async()=>{const ok=navigator.storage&&navigator.storage.persist?await navigator.storage.persist():false;toast(ok?"Speicher wird dauerhaft behalten":"Der Browser hat abgelehnt – bei installierter App meist automatisch");refreshPanel();};
    $("#sUpd",P).onclick=checkUpdate;
    try{const e=await navigator.storage.estimate();const per=navigator.storage.persisted?await navigator.storage.persisted():false;
      $("#sStor",P).innerHTML=`Belegt: <b>${MB(e.usage||0)}</b> von ca. ${MB(e.quota||0)} (gemeinsam für ibexlandy.github.io)<br>${per?"Dauerhaft gespeichert ✓":"Nicht als dauerhaft markiert"}`;}catch(e){}}};}

/* ---------- Bedingungen (Bulletin + Wetter) für einen Ort ---------- */
async function conditionsPanel(lat,lon,h,name,opt={}){const b=opt.noBul?null:await bulletinAt(lat,lon);const w=await weatherAt(lat,lon,h);
  let st=null;try{const m=await smnStations();if(m)st=pickStations(m.s,lat,lon,h);}catch(e){}const nc=await nowCached();
  const td=w&&w.days.find(d=>d.date===today());const tIc=td&&td.sy?wxIcon(td.sy,30):`<svg><use href="#i-sun"/></svg>`;
  return {title:name||"Bedingungen",icon:tIc,tools:`<button class="ib" id="cUpdTop" aria-label="Aktualisieren" title="${opt.noBul?"Wetter und Messwerte":"Wetter, Messwerte und Bulletin"} aktualisieren"><svg><use href="#i-sync"/></svg></button>`,html:weatherHTML(w)+`<div id="nowBox">${nowHTML(st,nc,!!(st&&navigator.onLine))}</div>`+(opt.noBul?"":bulletinHTML(b,h))+`<div class="btns"><button class="btn" id="cUpd"><svg><use href="#i-sync"/></svg>Jetzt aktualisieren</button>
   <a class="btn" href="https://www.meteoschweiz.admin.ch/#tab=forecast-map" target="_blank" rel="noopener">MeteoSchweiz</a>${opt.noBul?"":`<a class="btn" href="https://www.slf.ch/de/lawinenbulletin-und-schneesituation/" target="_blank" rel="noopener">SLF</a>`}</div>`,
   async after(P){const upd=async()=>{if(!navigator.onLine)return toast("Kein Internet");const t=$("#cUpdTop",P);if(t)t.classList.add("spin");try{await fetchConditions();}finally{refreshPanel();}};$("#cUpd",P).onclick=upd;$("#cUpdTop",P).onclick=upd;bindBulletin(P);
     if(navigator.onLine){try{if(!st){const m=await smnStations();st=m?pickStations(m.s,lat,lon,h):[];}const c=await fetchNowFor(st);const box=$("#nowBox",P);if(box&&P.contains(box))box.innerHTML=nowHTML(st,c,false);}catch(e){const box=$("#nowBox",P);if(box)box.innerHTML=nowHTML(st,nc,false);}}}};}

/* ---------- Start ---------- */
async function bootApp(){if(gdPopupReturn())return;
  $("#ver").textContent="v"+APP_VERSION;
  try{await db();}catch(e){document.body.innerHTML=`<p style="padding:20px">Speicher kann nicht geöffnet werden: ${esc(e.message)}</p>`;return;}
  initMap();
  await loadSettings();
  const [pts,tours]=await Promise.all([getAll("points"),getAll("tours")]);
  const cut=Date.now()-30*864e5;S.points=pts.filter(p=>!(p.del&&p.del<cut&&p.mod<cut));S.tours=tours;fixCats();
  refreshMarkers();map.render();
  $$("#bar button").forEach(b=>b.onclick=()=>{const g=b.dataset.go;if(planState&&g!=="plan")return toast("Zuerst die Planung beenden oder speichern");
    closePanel();$$("#bar button").forEach(x=>x.classList.toggle("on",x===b));
    if(g==="points")openPanel(pointsPanel);else if(g==="tours")openPanel(toursPanel);else if(g==="plan")planEntry();else if(g==="weekend")openPanel(weekendPanel);else if(g==="more")openPanel(morePanel);});
  $("#bSearch").onclick=()=>{closePanel();openPanel(searchPanel);};
  $("#fGpx").onchange=e=>{const fl=[...e.target.files];e.target.value="";if(fl.length)importGPX(fl);};
  const shared=/[?&]share=/.test(location.search);
  bootOffline();gdBoot();swInit();handleShared();
  if(!shared&&!ls("intro")&&!S.points.length&&!S.tours.length)setTimeout(()=>{if(!nav.length)openPanel(introPanel);},500);
  if("launchQueue" in window)try{launchQueue.setConsumer(async p=>{if(!p.files||!p.files.length)return;const fs=await Promise.all(p.files.map(h=>h.getFile()));routeIncoming(fs);});}catch(e){}
  if(location.search.includes("admin"))showAdmin();
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persisted().then(p=>{if(!p)navigator.storage.persist();});}catch(e){}}

/* ---------- Geteilte oder geöffnete Dateien: GPX → Touren-Import, Fotos → Foto-Import ---------- */
/* Einstieg beim ersten Start */
function introPanel(){const it=(id,ic,t,d)=>`<button class="li" data-in="${id}"><span class="ic" style="background:var(--nacht)"><svg><use href="#${ic}"/></svg></span><span class="t"><b>${t}</b><small>${d}</small></span></button>`;
  return {title:"Willkommen",icon:`<svg><use href="#i-flag"/></svg>`,html:`<p class="muted" style="margin-top:0">Deine Touren, Gipfel und Ideen in der Schweiz – auf der Landeskarte, auch ohne Netz. So fängst du an:</p>
   <div class="intro">${it("gpx","i-gpx","Tour aus Suunto importieren","In der Suunto-App «GPX exportieren» und an BoschorMap teilen – oder hier eine GPX-Datei wählen")}
   ${it("pin","i-pin","Gipfel oder Hütte setzen","Roter Knopf rechts, oder lange auf die Karte drücken – der Name wird erkannt")}
   ${it("plan","i-flag","Tour planen","Art wählen, Punkte antippen – die Linie folgt Wegen bzw. Skirouten")}
   ${it("off","i-down","Region offline speichern","Karten fürs Gebiet deiner nächsten Tour aufs Gerät laden")}</div>
   <button class="btn pri full" id="inGo" style="margin-top:12px">Los geht's</button>`,
   onClose:()=>{ls("intro","1");closePanel();},
   after(P){$("#inGo",P).onclick=()=>{ls("intro","1");closePanel();};
     $$("[data-in]",P).forEach(b=>b.onclick=()=>{ls("intro","1");const k=b.dataset.in;closePanel();if(k==="gpx")$("#fGpx").click();else if(k==="pin")startPlace();else if(k==="plan")startPlan({});else if(k==="off")startRegionSelect();});}};}
async function handleShared(){if(!/[?&]share=/.test(location.search))return;history.replaceState(null,"",location.pathname);
  let files=[];try{const c=await caches.open("boschormap-share");for(const k of await c.keys()){const r=await c.match(k);const b=await r.blob();
      files.push(new File([b],decodeURIComponent(r.headers.get("x-name")||"datei"),{type:b.type,lastModified:+r.headers.get("x-mod")||Date.now()}));await c.delete(k);}}catch(e){}
  const txt=files.find(f=>f.name==="text");files=files.filter(f=>f.name!=="text");
  if(files.length)return routeIncoming(files);
  const t=txt?(await txt.text()).trim():"";const link=(t.match(/https?:\/\/\S+/)||[])[0];
  /* Kommt nur ein Link: direkt versuchen (klappt nur, wenn der Server es erlaubt), sonst anzeigen */
  /* Suunto teilt «GPX-Workout exp.» als Link auf api.sports-tracker.com – die Datei direkt dort holen */
  /* Sicherheit: nur Links von Suunto/Sports-Tracker (https) selbst laden – alles andere nur anzeigen */
  let trusted=false;try{const u=new URL(link);trusted=u.protocol==="https:"&&u.hostname==="api.sports-tracker.com";}catch(e){}
  if(link&&trusted){if(!navigator.onLine){toast("Suunto-Link empfangen – zum Laden braucht es Internet",5000);}
    else{progress("Workout laden",0,0,/sports-tracker|suunto/.test(link)?"von Suunto …":"vom Link …");
      try{const r=await fetch(link);if(r.ok){const b=await r.blob();if(/<gpx[\s>]/i.test(await b.slice(0,4000).text())){const cd=r.headers.get("content-disposition")||"";
          const nm=decodeURIComponent((cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)||[])[1]||"")||`Suunto_${today()}.gpx`;progressDone();return routeIncoming([new File([b],/\.gpx$/i.test(nm)?nm:nm+".gpx",{type:"application/gpx+xml"})]);}}}catch(e){}
      progressDone();}}
  openPanel(()=>({title:"Geteilt – keine Datei",icon:`<svg><use href="#i-info"/></svg>`,html:`<div class="note">BoschorMap hat ${t?"nur Text bzw. einen Link":"nichts"} erhalten, keine GPX-Datei.</div>
    ${t?`<div class="card"><h3>Empfangen</h3><p class="small" style="word-break:break-all;white-space:pre-wrap">${esc(t)}</p>${link?`<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Link öffnen</a>`:""}</div>`:""}
    <div class="card"><h3>So klappt es sicher</h3><p class="small">In der Suunto-App «GPX-Workout exp.» › <b>Speichern</b> (Ordner Download) wählen, dann hier <b>Mehr › GPX importieren</b>.</p>
    <button class="btn pri" id="shImp"><svg><use href="#i-gpx"/></svg>GPX importieren</button></div>`,after(P){$("#shImp",P).onclick=()=>$("#fGpx").click();}}));}
async function routeIncoming(files){const gpx=[],img=[],other=[];
  for(const f of files){if(/^image\//.test(f.type)||/\.(jpe?g|heic|heif|png)$/i.test(f.name)){img.push(f);continue;}
    let isG=/\.gpx$/i.test(f.name)||/gpx/.test(f.type);if(!isG){try{isG=/<gpx[\s>]/i.test(await f.slice(0,4000).text());}catch(e){}}
    (isG?gpx:other).push(isG&&!/\.gpx$/i.test(f.name)?new File([f],(f.name.replace(/\.[^.]+$/,"")||"suunto")+".gpx",{type:"application/gpx+xml",lastModified:f.lastModified}):f);}
  if(other.length&&!gpx.length&&!img.length)toast(`«${other[0].name}» ist keine GPX-Datei – in der Suunto-App «GPX-Workout exp.» wählen`,6000);
  if(gpx.length)await importGPX(gpx);else if(img.length)sharedPhotos(img);}
function sharedPhotos(img){const ro=recentOpen();if(!ro){locateOnce();return scanPhotos(img);}const {k,it}=ro;const n=img.length;
  openPanel(()=>({title:`${n} Foto${n>1?"s":""} erhalten`,half:true,html:`<p class="muted" style="margin:0 0 10px">Wohin sollen ${n>1?"die Fotos":"das Foto"}?</p>
    <div class="btns" style="flex-direction:column;align-items:stretch"><button class="btn pri" id="shTo">${k==="p"?catIc(it.cat):artIc(it.art)} Zu «${esc(it.name||"Ohne Name")}»</button>
    <button class="btn" id="shAuto"><svg><use href="#i-locate"/></svg>Automatisch nach Standort zuordnen</button></div>`,
    after(P){$("#shTo",P).onclick=async()=>{closePanel();if(k==="p"){await addPointPhotos(it,img);showPoint(it.id);}else{showTour(it.id);await tourPhotoAssign(it,img);}};
      $("#shAuto",P).onclick=()=>{closePanel();locateOnce();scanPhotos(img);};}}),{half:true});}

/* ---------- Service-Worker und Update ---------- */
let swReg=null,reloading=false;
function swInit(){if(!("serviceWorker" in navigator))return;navigator.serviceWorker.register("sw.js",{scope:"./",updateViaCache:"none"}).then(r=>{swReg=r;r.update().catch(()=>{});}).catch(e=>console.warn("SW",e));
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(reloading||!ls("swseen")){ls("swseen","1");return;}reloading=true;toast("Neue Version – wird geladen …");setTimeout(()=>location.reload(),600);});
  if(navigator.serviceWorker.controller)ls("swseen","1");}
async function checkUpdate(){if(!swReg)return toast("Update nicht möglich (kein Service-Worker)");if(!navigator.onLine)return toast("Kein Internet");toast("Suche Update …");
  try{await swReg.update();setTimeout(()=>{if(!reloading)toast("BoschorMap ist aktuell (v"+APP_VERSION+")");},2500);}catch(e){toast("Update-Prüfung fehlgeschlagen");}}

/* ---------- Heatmap: alle gemachten Touren übereinander, häufig begangene Wege leuchten stärker ---------- */
function drawHeat(c,m){if(!S.heat)return;const b=m.getBounds();const z=m.zoom;c.save();c.globalCompositeOperation="multiply";c.lineCap="round";c.lineJoin="round";
  const w=z<9?3:z<12?5:7;c.lineWidth=w;c.strokeStyle="rgba(214,40,40,.28)";
  for(const t of S.tours){if(t.del||t.status!=="gemacht"||!t.disp||!t.bbox)continue;const bb=t.bbox;if(bb[0]>b[2]||bb[2]<b[0]||bb[1]>b[3]||bb[3]<b[1])continue;
    const L=t.disp,step=z<10?4:z<12?2:1;c.beginPath();for(let i=0;i<L.length;i+=step){const p=m.project(L[i][0],L[i][1]);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);}c.stroke();}
  c.restore();}

/* ---------- Gipfelbuch: bestiegene Gipfel mit Datum, Höhe, Jahren ---------- */
function gipfelbuchPanel(){const g=S.points.filter(p=>!p.del&&p.cat==="gipfel"&&(p.visits||[]).length);
  const rows=g.map(p=>{const all=p.visits||[],v=all.map(x=>x.d).filter(Boolean).sort();return {p,first:all.some(x=>!x.d)?"":v[0]||"",last:v[v.length-1]||"",n:all.length};}).sort((a,b)=>b.last.localeCompare(a.last));
  const years={};for(const r of rows)for(const v of r.p.visits||[]){const y=String(v.d||"").slice(0,4);if(!y)continue;(years[y]=years[y]||new Set()).add(r.p.id);}
  const hm={};for(const t of S.tours)if(!t.del&&t.status==="gemacht"&&t.date){const y=t.date.slice(0,4);hm[y]=(hm[y]||0)+(t.up||0);}
  const ys=[...new Set([...Object.keys(years),...Object.keys(hm)])].sort().reverse();const top=g.slice().sort((a,b)=>(b.hoehe||0)-(a.hoehe||0))[0];
  const offen=S.points.filter(p=>!p.del&&p.cat==="gipfel"&&!(p.visits||[]).length).length;
  return {title:"Gipfelbuch",icon:`<svg><use href="#i-book"/></svg>`,html:`
   <div class="kv kv4"><div><b>${g.length}</b><small>Gipfel</small></div><div><b>${rows.reduce((a,r)=>a+r.n,0)}</b><small>Besteigungen</small></div><div><b>${top&&top.hoehe?fmtN(top.hoehe):"–"}</b><small>höchster (m)</small></div><div><b>${offen}</b><small>noch offen</small></div></div>
   ${ys.length?`<div class="card" style="margin-top:10px"><h3>Pro Jahr</h3><table class="tbl"><tr><th>Jahr</th><th>Gipfel</th><th>Höhenmeter</th></tr>${ys.map(y=>`<tr><td><b>${y}</b></td><td>${years[y]?years[y].size:0}</td><td>${fmtN(Math.round(hm[y]||0))}</td></tr>`).join("")}</table></div>`:""}
   <div class="card"><h3>Bestiegene Gipfel</h3>${rows.length?rows.map(r=>`<button class="q gb" data-gb="${r.p.id}"><span class="grow"><b>${esc(r.p.name||"Gipfel")}</b>${r.p.hoehe?` <small class="muted">${fmtN(r.p.hoehe)} m</small>`:""}<br>
      <small class="muted">${r.n>1?`${r.n}× · zuerst ${fmtVisit(r.first)} · zuletzt ${fmtVisit(r.last)}`:r.last?fmtDate(r.last):"früher, Datum unbekannt"}</small></span><svg class="chev"><use href="#i-back"/></svg></button>`).join("")
      :`<div class="muted">Noch keine Gipfel als besucht markiert. Beim GPX-Import schlägt die App Gipfel am Track vor; oder bei einem Gipfel «Besuch hinzufügen».</div>`}</div>`,
   after(P){$$("[data-gb]",P).forEach(b=>b.onclick=()=>showPoint(b.dataset.gb));}};}
