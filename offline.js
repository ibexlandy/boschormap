/* BoschorMap – Offline-Regionen (Kacheln in IndexedDB), Ortsnamen, Lawinenbulletin (SLF), Wetter (MeteoSchweiz) */
"use strict";
const LIM_KM2=3000,LIM_TILES=150000,WARN_TILES=30000,TPS=20,ZMIN_OFF=8;let stFree=null;
function storeFree(){try{navigator.storage.estimate().then(e=>{stFree=e.quota?Math.max(0,e.quota-(e.usage||0))/1048576:null;});}catch(e){}}
let regionSel=null,dl=null;

/* ---------- Kacheln eines Ausschnitts ---------- */
function tileRange(b,z){const n=1<<z;const x0=Math.floor(BMap.lonX(b[1])*n),x1=Math.floor(BMap.lonX(b[3])*n),y0=Math.floor(BMap.latY(b[2])*n),y1=Math.floor(BMap.latY(b[0])*n);return [x0,x1,y0,y1];}
function regionLayers(r){const out=[];for(const k of r.bases||[]){const b=BASES[k];if(b)out.push({id:b.id,f:b.f,max:Math.min(b.max,r.zmax),kb:b.kb});}
  for(const k of r.ovs||[]){const o=OVERLAYS[k];if(o)for(const id of o.ids)out.push({id,f:"png",max:Math.min(o.max,r.zmax),min:Math.max(ZMIN_OFF,Math.min(o.from,r.zmax)),kb:o.kb});}return out;}
function regionCount(r){let n=0,kb=0;for(const L of regionLayers(r))for(let z=L.min||ZMIN_OFF;z<=L.max;z++){const [x0,x1,y0,y1]=tileRange(r.bbox,z);const c=(x1-x0+1)*(y1-y0+1);n+=c;kb+=c*(z<12?L.kb*0.8:L.kb);}return {n,mb:kb/1024};}
function* regionKeys(r){for(const L of regionLayers(r))for(let z=L.min||ZMIN_OFF;z<=L.max;z++){const [x0,x1,y0,y1]=tileRange(r.bbox,z);
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)yield {k:`${L.id}/${z}/${x}/${y}`,u:layerUrl(L.id,L.f).replace("{z}",z).replace("{x}",x).replace("{y}",y)};}}
const areaKm2=b=>distM(b[0],b[1],b[0],b[3])/1000*distM(b[0],b[1],b[2],b[1])/1000;

/* ---------- Liste der Regionen und Download-Warteschlange ---------- */
async function regionsPanel(){const R=(await getAll("regions",await tdb())).sort((a,b)=>(a.created||0)-(b.created||0));
  const st={done:["erledigt","st-done"],run:["läuft","st-run"],wait:["kommt noch","st-wait"],paused:["angehalten","st-wait"],err:["unterbrochen","st-err"],names:["läuft (Namen)","st-run"]};
  let est="";try{const e=await navigator.storage.estimate();est=`Belegt insgesamt: ${MB(e.usage||0)} von ca. ${MB(e.quota||0)}`;}catch(e){}
  return {title:"Offline-Regionen",icon:`<svg><use href="#i-down"/></svg>`,html:`
   <p class="muted">Gespeicherte swisstopo-Karten (und gewählte Ebenen) sind auch ohne Netz da. Grenzen pro Region: ${fmtN(LIM_KM2)} km² und ${fmtN(LIM_TILES)} Kacheln.</p>
   <button class="btn pri full" id="rNew"><svg><use href="#i-plus"/></svg>Neue Region auf der Karte wählen</button>
   <div class="card" style="margin-top:10px">${R.length?R.map(r=>{const s=st[r.state]||st.wait;const pct=r.total?Math.round((r.done||0)/r.total*100):0;
     return `<div class="q"><div class="grow"><b>${esc(r.name)}</b> <small class="${s[1]}">${s[0]}</small><br><small class="muted">${(r.bases||[]).map(k=>BASES[k].n).concat((r.ovs||[]).map(k=>OVERLAYS[k].n)).join(", ")} · bis Zoom ${r.zmax} · ${fmtN(r.done||0)} / ${fmtN(r.total||0)} Kacheln · ${MB(r.bytes||0)}${r.names?` · ${fmtN(r.names)} Namen`:""}${r.fail?` · ${r.fail} fehlten`:""}</small>
       ${r.state!=="done"?`<div class="pbar"><i style="width:${pct}%"></i></div>`:""}</div>
      <div class="btns" style="flex-direction:column;gap:4px">${r.state==="run"||r.state==="names"?`<button class="btn sm" data-pause="${r.id}">Anhalten</button>`:r.state!=="done"?`<button class="btn sm pri" data-go="${r.id}">Fortsetzen</button>`:""}
       <button class="btn sm" data-show="${r.id}">Zeigen</button><button class="btn sm red" data-del="${r.id}">Löschen</button></div></div>`;}).join(""):`<div class="muted">Noch keine Regionen gespeichert.</div>`}</div>
   <p class="muted small">${est}</p>`,
   after(P){$("#rNew",P).onclick=startRegionSelect;
     $$("[data-go]",P).forEach(b=>b.onclick=()=>resumeRegion(b.dataset.go));$$("[data-pause]",P).forEach(b=>b.onclick=()=>{if(dl)dl.stop=true;});
     $$("[data-show]",P).forEach(b=>b.onclick=async()=>{const r=R.find(x=>x.id===b.dataset.show);closePanel();map.fitBounds(r.bbox,30);showFrame(r.bbox);setTimeout(hideFrame,4000);});
     $$("[data-del]",P).forEach(b=>b.onclick=async()=>{const r=R.find(x=>x.id===b.dataset.del);if(!confirm(`Region «${r.name}» auf diesem Gerät löschen?`))return;if(dl&&dl.id===r.id)dl.stop=true;await deleteRegion(r);refreshPanel();});}};}

/* ---------- Ausschnitt wählen (Rahmen mit vier Griffen) ---------- */
let frameEl=null,frameHandles=[];
function showFrame(b){hideFrame();frameEl=document.createElement("div");frameEl.className="fframe";$("#map").appendChild(frameEl);const upd=()=>{if(!frameEl)return;const a=map.project(b[2],b[1]),c=map.project(b[0],b[3]);
  Object.assign(frameEl.style,{left:a.x+"px",top:a.y+"px",width:(c.x-a.x)+"px",height:(c.y-a.y)+"px"});};frameEl._u=upd;frameEl._b=b;map.on("move",upd);upd();}
function hideFrame(){if(frameEl){map.off("move",frameEl._u);frameEl.remove();frameEl=null;}frameHandles.forEach(h=>map.removeMarker(h));frameHandles=[];}
function startRegionSelect(){if(planState)return toast("Zuerst die Planung beenden");storeFree();closePanel();const bb=map.getBounds();const dy=(bb[2]-bb[0])*0.18,dx=(bb[3]-bb[1])*0.15;
  regionSel={b:[bb[0]+dy,bb[1]+dx,bb[2]-dy,bb[3]-dx],bases:["lk"],ovs:Object.keys(viewPrefs().ov||{}).filter(k=>viewPrefs().ov[k]),zmax:17};
  if(map.z<10)toast("Tipp: zuerst näher an das Gebiet zoomen",3500);
  showFrame(regionSel.b);const b=regionSel.b;
  const mk=(i)=>{const pos=[[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]][i];const h=map.addMarker({lat:pos[0],lon:pos[1],anchor:[0,0],drag:true,z:80,html:`<div class="hdl"></div>`});h.corner=i;return h;};
  frameHandles=[0,1,2,3].map(mk);map.on("markerdrag",onHandleDrag);
  modebar(`<span class="grow"><b>Ecken ziehen, um den Ausschnitt zu wählen</b><br><small class="muted" id="rsEst"></small></span><button class="btn sm" id="rsX">Abbrechen</button><button class="btn sm pri" id="rsOk">Weiter</button>`);
  $("#rsX").onclick=endRegionSelect;$("#rsOk").onclick=()=>openPanel(regionFormPanel,{half:true});regionSelEst();}
function regionSelEst(){const el=$("#rsEst");if(!el||!regionSel)return;const r={bbox:regionSel.b,bases:regionSel.bases,ovs:regionSel.ovs,zmax:regionSel.zmax};const c=regionCount(r);const a=areaKm2(r.bbox);
  const bad=a>LIM_KM2||c.n>LIM_TILES||(stFree!=null&&c.mb>stFree*0.9);el.innerHTML=`${fmtN(a)} km² · ca. ${fmtN(c.mb)} MB · ${durTxt(c.n)}${bad?' · <span style="color:var(--rot)">zu gross</span>':""}`;}
function durTxt(n){const m=Math.max(1,Math.round(n/TPS/60));return m<60?`ca. ${m} min`:`ca. ${(m/60).toFixed(1)} h`;}
function onHandleDrag(e){if(!regionSel||e.marker.corner==null)return;const b=regionSel.b,i=e.marker.corner;
  if(i===0){b[2]=e.lat;b[1]=e.lon;}else if(i===1){b[2]=e.lat;b[3]=e.lon;}else if(i===2){b[0]=e.lat;b[3]=e.lon;}else{b[0]=e.lat;b[1]=e.lon;}
  if(b[0]>b[2])[b[0],b[2]]=[b[2],b[0]];if(b[1]>b[3])[b[1],b[3]]=[b[3],b[1]];
  const pos=[[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]];frameHandles.forEach((h,k)=>{if(h!==e.marker)map.moveMarker(h,pos[k][0],pos[k][1]);});frameEl._u();
  clearTimeout(regionSel._t);regionSel._t=setTimeout(()=>{const el=$("#rfEst");if(el)el.innerHTML=regionEstHTML();regionSelEst();},120);}
function endRegionSelect(){map.off("markerdrag",onHandleDrag);hideFrame();regionSel=null;modebar(null);closePanel();}
function regionEstHTML(){const r={bbox:regionSel.b,bases:regionSel.bases,ovs:regionSel.ovs,zmax:regionSel.zmax};const c=regionCount(r);const a=areaKm2(r.bbox);
  const full=stFree!=null&&c.mb>stFree*0.9;const bad=a>LIM_KM2||c.n>LIM_TILES||full;setTimeout(regionSelEst,0);regionSel.ok=!bad&&(r.bases.length+r.ovs.length)>0;
  return `<b>${fmtN(a)} km²</b> · <b>${fmtN(c.n)}</b> Kacheln · ca. <b>${fmtN(c.mb)} MB</b><br><span class="muted">Dauer ${durTxt(c.n)} (je nach Netz)</span>${full?`<div class="st-err">Zu wenig Speicher frei auf dem Gerät (frei ca. ${fmtN(Math.round(stFree))} MB).</div>`:bad?`<div class="st-err">Zu gross – Ausschnitt verkleinern oder Zoomstufe senken (max. ${fmtN(LIM_KM2)} km², ${fmtN(LIM_TILES)} Kacheln).</div>`:c.n>WARN_TILES?`<div class="muted small" style="color:#b26a00">Grosse Region: am besten im WLAN, App dabei offen lassen. Ein unterbrochener Download lässt sich mit «Fortsetzen» dort weiterführen, wo er stehen blieb.</div>`:""}`;}
function regionFormPanel(){if(!regionSel)return {title:"Region",html:""};const rs=regionSel;
  return {title:"Neue Offline-Region",icon:`<svg><use href="#i-down"/></svg>`,half:true,html:`
   <div class="card"><label class="f">Name</label><input class="inp" id="rfN" placeholder="z. B. Val Bever">
    <label class="f">Karten</label>${Object.entries(BASES).map(([k,b])=>`<label class="chk"><input type="checkbox" data-b="${k}"${rs.bases.includes(k)?" checked":""}><span>${b.n}</span></label>`).join("")}
    <label class="f">Ebenen</label>${Object.entries(OVERLAYS).map(([k,o])=>`<label class="chk"><input type="checkbox" data-o="${k}"${rs.ovs.includes(k)?" checked":""}><span>${o.n}</span></label>`).join("")}
    <label class="f">Genauigkeit (höchste Zoomstufe)</label><select class="inp" id="rfZ">${[[14,"14 – Übersicht"],[15,"15"],[16,"16 – Wandern"],[17,"17 – genau (empfohlen)"],[18,"18 – sehr genau, viermal grösser"]].map(([z,n])=>`<option value="${z}"${rs.zmax===z?" selected":""}>${n}</option>`).join("")}</select>
    <p class="muted small">Gespeichert wird ab Zoom ${ZMIN_OFF}. Dazu kommen die Orts- und Gipfelnamen für die Suche ohne Netz.</p>
    <div id="rfEst" style="margin-top:8px">${regionEstHTML()}</div></div>
   <button class="btn pri full" id="rfGo"><svg><use href="#i-down"/></svg>Herunterladen</button>`,
   after(P){const upd=()=>{rs.bases=$$("[data-b]",P).filter(c=>c.checked).map(c=>c.dataset.b);rs.ovs=$$("[data-o]",P).filter(c=>c.checked).map(c=>c.dataset.o);rs.zmax=+$("#rfZ",P).value;$("#rfEst",P).innerHTML=regionEstHTML();};
     $$("input[type=checkbox],select",P).forEach(x=>x.onchange=upd);
     $("#rfGo",P).onclick=async()=>{upd();if(!rs.ok)return toast("Zu gross oder keine Karte gewählt");if(!navigator.onLine)return toast("Kein Internet");
       const r={id:uid(),name:$("#rfN",P).value.trim()||`Region ${fmtDate(today())}`,bbox:rs.b.map(v=>+v.toFixed(5)),bases:rs.bases,ovs:rs.ovs,zmax:rs.zmax,state:"wait",done:0,bytes:0,created:Date.now()};
       r.total=regionCount(r).n;await put("regions",r,await tdb());endRegionSelect();toast("Download gestartet");pumpQueue();openPanel(regionsPanel);};}};}

/* ---------- Download (massvoll: 4 gleichzeitig, kurze Pausen, Abbruch jederzeit) ---------- */
async function resumeRegion(id){const T=await tdb();const r=await getOne("regions",id,T);if(!r)return;if(!navigator.onLine)return toast("Kein Internet");r.state="wait";await put("regions",r,T);pumpQueue();refreshPanel();}
async function pumpQueue(){if(dl)return;const T=await tdb();const R=(await getAll("regions",T)).filter(r=>r.state==="wait").sort((a,b)=>a.created-b.created);if(!R.length){updPill();return;}
  const r=R[0];dl={id:r.id,stop:false};r.state="run";await put("regions",r,T);updPill(r);refreshRegionsPanel();
  try{await downloadRegion(r,T);if(!dl.stop){r.state="names";await put("regions",r,T);refreshRegionsPanel();await downloadNames(r,T);if(!dl.stop&&((r.bases||[]).includes("winter")||(r.ovs||[]).includes("ski")))await skiPrefetch(r.bbox);}
    r.state=dl.stop?"paused":"done";}catch(e){console.warn(e);r.state="err";r.errMsg=e.message;toast("Download unterbrochen: "+e.message,5000);}
  await put("regions",r,T);dl=null;refreshRegionsPanel();updPill();if(r.state==="done")toast(`«${r.name}» ist offline verfügbar`,4000);pumpQueue();}
function refreshRegionsPanel(){if(nav.length&&nav[nav.length-1].fn===regionsPanel)refreshPanel();}
async function downloadRegion(r,T){const keys=[...regionKeys(r)];r.total=keys.length;let done=0,bytes=0,fail=0,last=Date.now();const b0=r.bytes||0;
  for(let i=0;i<keys.length&&!dl.stop;i+=20){const batch=keys.slice(i,i+20);
    const have=await new Promise((res,rej)=>{const tx=T.transaction("tiles");const s=tx.objectStore("tiles");const out=new Map();for(const k of batch){const q=s.get(k.k);q.onsuccess=()=>{if(q.result)out.set(k.k,q.result);};}tx.oncomplete=()=>res(out);tx.onerror=()=>rej(tx.error);});
    const todo=batch.filter(k=>!have.has(k.k));const got=[];
    const worker=async()=>{while(todo.length&&!dl.stop){const k=todo.shift();let tries=0;
      for(;;){try{if(!navigator.onLine)throw new Error("offline");const res=await fetch(k.u,{mode:"cors",credentials:"omit",cache:"no-store"});
          if(res.ok){const b=await res.blob();got.push({k:k.k,b,r:[r.id]});bytes+=b.size;}else fail++;break;}
        catch(e){if(++tries>=4){dl.stop=true;throw new Error(navigator.onLine?"Netzfehler":"Netz weg");}await sleep(1500*tries);}}
      await sleep(10);}};
    await Promise.all([worker(),worker(),worker(),worker()]);
    const upd=[];for(const [k,v] of have){if(!v.r.includes(r.id)){v.r=v.r.concat(r.id);upd.push(v);}}
    await putMany("tiles",got.concat(upd),T);done+=batch.length-(todo.length);
    if(Date.now()-last>700||i+20>=keys.length){last=Date.now();r.done=done;r.bytes=b0+bytes;r.fail=fail;await put("regions",r,T);updPill(r);refreshRegionsPanel();}}
  r.done=Math.min(done,r.total);r.bytes=b0+bytes;r.fail=fail;}
function updPill(r){const p=$("#dlpill");if(!r||!dl){p.hidden=true;return;}p.hidden=false;p.textContent=r.state==="names"?`Offline: Namen für «${r.name}» …`:`Offline: ${r.name} ${fmtN(r.done||0)} / ${fmtN(r.total||0)}`;p.onclick=()=>openPanel(regionsPanel);}
async function deleteRegion(r){const T=await tdb();progress("Region löschen",0,0,r.name);
  await new Promise((res,rej)=>{const tx=T.transaction(["tiles","names"],"readwrite");for(const st of ["tiles","names"]){const c=tx.objectStore(st).openCursor();
      c.onsuccess=()=>{const cur=c.result;if(!cur)return;const v=cur.value;if(v.r&&v.r.includes(r.id)){v.r=v.r.filter(x=>x!==r.id);if(v.r.length)cur.update(v);else cur.delete();}cur.continue();};}
    tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
  await del("regions",r.id,T);namesCache=null;progressDone();toast("Region gelöscht");}

/* ---------- Orts- und Gipfelnamen (swissNAMES3D) für die Suche ohne Netz ---------- */
async function downloadNames(r,T){const [E0,N0]=toLV95(r.bbox[0],r.bbox[1]),[E1,N1]=toLV95(r.bbox[2],r.bbox[3]);const cells=[];const step=5000;
  for(let e=Math.min(E0,E1);e<Math.max(E0,E1);e+=step)for(let n=Math.min(N0,N1);n<Math.max(N0,N1);n+=step)cells.push([e,n,Math.min(e+step,Math.max(E0,E1)),Math.min(n+step,Math.max(N0,N1)),0]);
  const out=new Map();
  while(cells.length&&!dl.stop){const c=cells.shift();const g=c.slice(0,4).map(v=>Math.round(v)).join(",");
    const u=`https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryEnvelope&geometry=${g}&imageDisplay=500,500,96&mapExtent=${g}&layers=all:ch.swisstopo.swissnames3d&tolerance=0&sr=2056&returnGeometry=true&geometryFormat=geojson&limit=200&lang=de`;
    let j=null;for(let k=0;k<3&&!j;k++){try{const res=await fetch(u);if(res.ok)j=await res.json();}catch(e){await sleep(2000);}}if(!j)continue;
    const L=j.results||[];if(L.length>=200&&c[4]<2){const mx=(c[0]+c[2])/2,my=(c[1]+c[3])/2;cells.push([c[0],c[1],mx,my,c[4]+1],[mx,c[1],c[2],my,c[4]+1],[c[0],my,mx,c[3],c[4]+1],[mx,my,c[2],c[3],c[4]+1]);continue;}
    for(const f of L){const a=f.attributes||f.properties||{};const bb=f.bbox;if(!bb||!a.name)continue;const ll=fromLV95((bb[0]+bb[2])/2,(bb[1]+bb[3])/2);
      out.set("n"+f.featureId,{id:"n"+f.featureId,name:a.name,kind:a.objektart||"",lat:+ll[0].toFixed(5),lon:+ll[1].toFixed(5)});}
    await sleep(800);}
  const exist=await getAll("names",T);const ex=new Map(exist.map(x=>[x.id,x]));const rows=[];
  for(const [id,v] of out){const o=ex.get(id);rows.push(o?Object.assign(o,{r:o.r.includes(r.id)?o.r:o.r.concat(r.id)}):Object.assign(v,{r:[r.id]}));}
  await putMany("names",rows,T);r.names=out.size;namesCache=null;}
let namesCache=null;
async function searchOfflineNames(q){if(!namesCache){try{namesCache=await getAll("names",await tdb());}catch(e){namesCache=[];}}const out=[];
  for(const n of namesCache){if(n.name.toLowerCase().includes(q)){out.push(n);if(out.length>60)break;}}
  out.sort((a,b)=>(a.name.toLowerCase().startsWith(q)?0:1)-(b.name.toLowerCase().startsWith(q)?0:1)||a.name.length-b.name.length);return out;}

/* ---------- Lawinenbulletin (SLF, CAAML als GeoJSON mit Warnregionen) ---------- */
let slfMem=null;const LV={low:1,moderate:2,considerable:3,high:4,very_high:5};const LVN=["","gering","mässig","erheblich","gross","sehr gross"];
const PROB={new_snow:"Neuschnee",wind_slab:"Triebschnee",persistent_weak_layers:"Altschnee",wet_snow:"Nassschnee",gliding_snow:"Gleitschnee",favourable_situation:"Günstige Situation",no_distinct_avalanche_problem:"Kein ausgeprägtes Problem",cornices:"Wechten"};
const strip=s=>String(s||"").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").trim();
const rnd=c=>Array.isArray(c[0])?c.map(rnd):[Math.round(c[0]*1e4)/1e4,Math.round(c[1]*1e4)/1e4];
async function fetchBulletin(){const r=await fetch("https://aws.slf.ch/api/bulletin/caaml/de/geojson",{cache:"no-store"});if(!r.ok)throw new Error("SLF: Fehler "+r.status);const j=await r.json();
  const feats=(j.features||[]).map(f=>{const p=f.properties||{};return {g:f.geometry?{type:f.geometry.type,coordinates:rnd(f.geometry.coordinates)}:null,
    valid:p.validTime,next:p.nextUpdate,pub:p.publicationTime,regions:(p.regions||[]).map(x=>x.name),
    dr:(p.dangerRatings||[]).map(d=>({v:LV[d.mainValue]||0,sub:((d.customData||{}).CH||{}).subdivision||"",period:d.validTimePeriod,elev:d.elevation||null,aspects:d.aspects||null})),
    ap:(p.avalancheProblems||[]).map(a=>({t:a.problemType,c:strip(a.comment),v:LV[a.dangerRatingValue]||0,elev:a.elevation||null,asp:a.aspects||[],core:strip(((a.customData||{}).CH||{}).coreZoneText),period:a.validTimePeriod})),
    snow:strip((p.snowpackStructure||{}).comment),wx:strip((p.weatherForecast||{}).comment),tend:(p.tendency||[]).map(t=>strip(t.comment)).filter(Boolean).join(" ")};});
  slfMem={t:Date.now(),f:feats};await metaSet("slf",slfMem);return slfMem;}
async function bulletinAt(lat,lon){if(!slfMem)slfMem=await metaGet("slf",null);if(!slfMem)return null;const f=slfMem.f.find(x=>inGeom(lat,lon,x.g));if(!f)return {none:true,t:slfMem.t};
  const lv=Math.max(0,...f.dr.map(d=>d.v),...f.ap.map(a=>a.v));const d0=f.dr.find(d=>d.v===lv)||{};const sub=d0.sub==="plus"?"+":d0.sub==="minus"?"-":d0.sub==="neutral"?"=":"";
  let lo=null,hi=null;for(const a of f.ap){if(!a.elev||a.t==="favourable_situation"||a.t==="no_distinct_avalanche_problem")continue;const l=parseFloat(a.elev.lowerBound),h=parseFloat(a.elev.upperBound);
    if(isFinite(l))lo=lo==null?l:Math.min(lo,l);else lo=lo==null?0:lo;if(isFinite(h))hi=hi==null?h:Math.max(hi,h);}
  const end=f.valid&&f.valid.endTime?Date.parse(f.valid.endTime):0;return Object.assign({},f,{level:lv,sub,critLow:lo,critHigh:hi,stale:end&&end<Date.now(),t:slfMem.t});}
function rose(asp){const all=["N","NE","E","SE","S","SW","W","NW"];let s=`<svg class="rose" viewBox="-32 -32 64 64" style="stroke:#62707d;stroke-width:.8">`;
  all.forEach((a,i)=>{const a0=(i*45-22.5-90)*RAD,a1=(i*45+22.5-90)*RAD;s+=`<path d="M0 0L${(28*Math.cos(a0)).toFixed(1)} ${(28*Math.sin(a0)).toFixed(1)}A28 28 0 0 1 ${(28*Math.cos(a1)).toFixed(1)} ${(28*Math.sin(a1)).toFixed(1)}z" fill="${asp.includes(a)?"#1f3a52":"#e6f0f7"}"/>`;});
  return s+`<text x="0" y="-21" font-size="9" text-anchor="middle" fill="#fff" stroke="none">N</text></svg>`;}
function bulletinHTML(b,h){if(!b)return `<div class="card"><h3><svg><use href="#i-snow"/></svg>Lawinenbulletin</h3><div class="muted">Noch nicht gespeichert. Mit Netz «Jetzt aktualisieren» tippen.</div></div>`;
  if(b.none)return `<div class="card"><h3><svg><use href="#i-snow"/></svg>Lawinenbulletin</h3><div class="muted">Für diesen Ort gibt es im gespeicherten Bulletin (Stand ${fmtDT(b.t)}) keine Warnregion – z. B. ausserhalb der Saison oder ausserhalb der Schweizer Alpen.</div></div>`;
  const v=b.valid||{};const fromTo=v.startTime?`${fmtDT(Date.parse(v.startTime))} – ${fmtDT(Date.parse(v.endTime))}`:"";
  return `<div class="card"><h3><svg><use href="#i-snow"/></svg>Lawinenbulletin</h3>${b.stale?`<div class="note"><b>Abgelaufen.</b> Gültig war es ${esc(fromTo)}. Mit Netz aktualisieren.</div>`:""}
   <div class="row"><span class="danger d${b.level||1}">${b.level||"–"}${esc(b.sub)}</span><span class="grow"><b>Gefahrenstufe ${b.level?LVN[b.level]:"–"}</b><br><small class="muted">${esc(b.regions.slice(0,3).join(", "))}${b.regions.length>3?" …":""}</small></span></div>
   <p class="muted small">Gültig ${esc(fromTo)} · gespeichert ${fmtDT(b.t)}</p>
   ${b.ap.map(a=>`<div class="q"><div>${rose(a.asp)}</div><div class="grow"><b>${esc(PROB[a.t]||a.t)}</b>${a.elev?`<br><small>${a.elev.lowerBound?"oberhalb "+fmtN(+a.elev.lowerBound)+" m":""}${a.elev.upperBound?" unterhalb "+fmtN(+a.elev.upperBound)+" m":""}</small>`:""}
     ${a.core?`<br><small class="muted">${esc(a.core)}</small>`:""}${a.c?`<div class="bsec"><b class="small">Beschreibung</b><p class="small" style="white-space:pre-wrap">${esc(a.c)}</p></div>`:""}</div></div>`).join("")}
   ${h&&b.critLow!=null&&h>=b.critLow?`<div class="note">Der Zielort (${fmtN(h)} m) liegt im Höhenbereich der Lawinenprobleme.</div>`:""}
   ${b.snow?`<div class="bsec"><b class="small">Schneedecke</b><p class="small" style="white-space:pre-wrap">${esc(b.snow)}</p></div>`:""}
   ${b.tend?`<div class="bsec"><b class="small">Tendenz</b><p class="small">${esc(b.tend)}</p></div>`:""}
   <p class="muted small">Quelle: WSL-Institut für Schnee- und Lawinenforschung SLF, www.slf.ch</p></div>`;}
function bindBulletin(){}

/* ---------- Wetter: Lokalprognosen MeteoSchweiz (Tageswerte, ganze Schweiz, offline gespeichert) ---------- */
const WX_DAYS=4;let wxMem=null;const STAC="https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting";
async function fetchText1252(u){const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error("MeteoSchweiz: Fehler "+r.status);const b=await r.arrayBuffer();
  try{return new TextDecoder("utf-8",{fatal:true}).decode(b);}catch(e){return new TextDecoder("windows-1252").decode(b);}}
async function fetchWeather(onStep){const its=await (await fetch(STAC+"/items?limit=100",{cache:"no-store"})).json();
  /* neuester VOLLSTÄNDIGER Lauf: MeteoSchweiz lädt einen neuen Lauf schrittweise hoch – fehlt ein Wert noch, den vorherigen nehmen */
  const need=["tre200dx","tre200dn","rka150d0"];let item=null,run=null,ks=[];
  for(const it of (its.features||[]).slice().sort((a,b)=>b.id.localeCompare(a.id))){const k=Object.keys(it.assets||{});
    const runs=[...new Set(k.map(x=>x.split(".")[2]).filter(Boolean))].sort().reverse();
    const r=runs.find(r=>need.every(p=>k.some(x=>x.includes("."+r+".")&&x.includes("."+p+"."))));if(r){item=it;run=r;ks=k;break;}}
  if(!item)throw new Error("Zurzeit keine vollständige Prognose verfügbar – später nochmals versuchen");
  let meta=await metaGet("wxmeta",null);if(!meta||Date.now()-meta.t>30*864e5){onStep&&onStep("Prognosepunkte");const tx=await fetchText1252("https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/ogd-local-forecasting_meta_point.csv");
    const rows=tx.split(/\r?\n/).slice(1).map(l=>l.split(";")).filter(c=>c.length>13);meta={t:Date.now(),p:rows.map(c=>[+c[0],c[4],+c[9],+c[12],+c[13],c[5]==="Station"?"S":c[5]==="Point of Interest"?"P":"O"])};await metaSet("wxmeta",meta);}
  const idx=new Map(meta.p.map((p,i)=>[p[0],i]));const par={tx:"tre200dx",tn:"tre200dn",rr:"rka150d0",sy:"jp2000d0",q10:"rreq10p0",q90:"rreq90p0"};const dates=new Set();const raw={};
  for(const [k,p] of Object.entries(par)){onStep&&onStep({tx:"Höchsttemperatur",tn:"Tiefsttemperatur",rr:"Niederschlag",sy:"Wettersymbol",q10:"Niederschlag (Bandbreite)",q90:"Niederschlag (Bandbreite)"}[k]);const key=ks.find(x=>x.includes("."+run+".")&&x.includes("."+p+"."));
    if(!key){if(k==="sy"||k==="q10"||k==="q90"){raw[k]=new Map();continue;}throw new Error("Prognose unvollständig ("+p+")");}
    const tx=await fetchText1252(item.assets[key].href);const m=new Map();for(const l of tx.split(/\r?\n/).slice(1)){const c=l.split(";");if(c.length<4)continue;const d=c[2].slice(0,8);dates.add(d);
      const v=parseFloat(c[3]);(m.get(+c[0])||m.set(+c[0],{}).get(+c[0]))[d]=isFinite(v)?v:null;}raw[k]=m;}
  const D=[...dates].sort();const v={tx:[],tn:[],rr:[],sy:[],q10:[],q90:[]};for(const p of meta.p){for(const k of ["tx","tn","rr","sy","q10","q90"]){const m=raw[k].get(p[0])||{};v[k].push(D.map(d=>m[d]!=null?m[d]:null));}}
  wxMem={t:Date.now(),run,dates:D.map(d=>`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`),v};await metaSet("wx",wxMem);return wxMem;}
async function weatherAt(lat,lon,h){if(!wxMem)wxMem=await metaGet("wx",null);const meta=await getWxMeta();if(!wxMem||!meta)return null;
  /* Tageswerte gibt es nur für die Messstationen (nicht für Postleitzahl-Punkte): nur Punkte mit Werten wählen */
  const has=i=>wxMem.v.tx[i]&&wxMem.v.tx[i].some(v=>v!=null);
  const c=meta.p.map((p,i)=>({i,p,d:distM(lat,lon,p[3],p[4])/1000})).filter(x=>x.d<40&&has(x.i)).sort((a,b)=>a.d-b.d).slice(0,12);if(!c.length)return null;
  const best=h?c.reduce((m,x)=>(x.d+Math.abs(x.p[2]-h)/150<m.d+Math.abs(m.p[2]-h)/150?x:m),c[0]):c[0];const i=best.i;const td=today();
  /* Symbol gibt es für alle Punkte (auch Postleitzahlen, Gipfel): vom nächsten Punkt nehmen, bei Höhenangabe auch nach Höhe */
  const hasS=j=>wxMem.v.sy&&wxMem.v.sy[j]&&wxMem.v.sy[j].some(v=>v!=null);
  const cs=meta.p.map((p,j)=>({j,p,d:distM(lat,lon,p[3],p[4])/1000})).filter(x=>x.d<10&&hasS(x.j)).sort((a,b)=>a.d-b.d).slice(0,10);
  const sb=cs.length?(h?cs.reduce((m,x)=>(x.d+Math.abs(x.p[2]-h)/150<m.d+Math.abs(m.p[2]-h)/150?x:m),cs[0]):cs[0]):null;const si=sb?sb.j:i;
  return {lat,lon,pid:sb?sb.p[0]:best.p[0],name:best.p[1],h:best.p[2],dist:best.d,sname:sb?sb.p[1]:best.p[1],sh:sb?sb.p[2]:best.p[2],t:wxMem.t,run:wxMem.run,days:wxMem.dates.map((d,k)=>({date:d,tx:wxMem.v.tx[i][k],tn:wxMem.v.tn[i][k],rr:wxMem.v.rr[i][k],q10:wxMem.v.q10&&wxMem.v.q10[i]?wxMem.v.q10[i][k]:null,q90:wxMem.v.q90&&wxMem.v.q90[i]?wxMem.v.q90[i][k]:null,sy:wxMem.v.sy&&wxMem.v.sy[si]?wxMem.v.sy[si][k]:null})).filter(x=>x.date>=td&&x.tx!=null).slice(0,WX_DAYS)};}
let wxMetaMem=null;async function getWxMeta(){if(!wxMetaMem)wxMetaMem=await metaGet("wxmeta",null);return wxMetaMem;}
const WD=["So","Mo","Di","Mi","Do","Fr","Sa"];
/* Wettersymbole von MeteoSchweiz: Nummer → Text (offizielle Liste); gezeichnet mit eigenen Symbolen */
const WXT=["","sonnig","ziemlich sonnig","teilweise sonnig","wechselnd bewölkt","bedeckt","Aufhellungen, einzelne Regenschauer","Aufhellungen, einzelne Regen- oder Schneeschauer","Aufhellungen, einzelne Schneeschauer",
 "bewölkt, einige Regenschauer","bewölkt, einige Regen- oder Schneeschauer","bewölkt, einige Schneeschauer","Aufhellungen, leicht gewitterhaft","Aufhellungen und gewitterhaft","stark bewölkt, schwacher Regen",
 "stark bewölkt, schwacher Schnee oder Regen","stark bewölkt, schwacher Schnee","stark bewölkt, zeitweise Regen","stark bewölkt, zeitweise Schnee oder Regen","stark bewölkt, zeitweise Schnee","stark bewölkt, anhaltender Regen",
 "stark bewölkt, anhaltender Regen oder Schnee","stark bewölkt, anhaltender Schnee","stark bewölkt, leicht gewitterhaft","stark bewölkt, gewitterhaft","stark bewölkt, stark gewitterhaft","Hohe Bewölkung","Hochnebel","Nebel",
 "leicht bewölkt, einzelne Regenschauer","leicht bewölkt, leichter Schneefall","teilweise sonnig, einige Schnee- oder Regenschauer","teilweise sonnig, einige Regenschauer","bewölkt, häufige Regenschauer","bewölkt, häufige Schneeschauer",
 "bedeckt und trocken","teilweise sonnig, gewitterhaft","teilweise sonnig, Gewitter und Schneeschauer","bewölkt, Gewitter und häufige Regenschauer","bewölkt, Gewitter und häufige Schneeschauer","stark bewölkt, leicht gewitterhaft",
 "bewölkt, leicht gewitterhaft","stark bewölkt, Gewitter und häufige Schneeschauer"];
const WXN={101:"klar",102:"leicht bewölkt",103:"zum Teil bewölkt",131:"leicht bewölkt, einige Schnee- oder Regenschauer",132:"leicht bewölkt, einige Regenschauer",136:"Aufhellungen, gewitterhaft",137:"leicht bewölkt, Gewitter und Schneeschauer"};
const wxText=c=>{c=+c;if(!c)return "";if(c>100)return WXN[c]||WXT[c-100]||"";return WXT[c]||"";};
function wxIcon(c,sz){const t=wxText(c).toLowerCase();if(!t)return "";sz=sz||34;const night=+c>100;
  const thunder=/gewitter/.test(t),snow=/schnee/.test(t),rain=/regen/.test(t),fog=/nebel/.test(t)&&!/hochnebel/.test(t)||/hochnebel/.test(t);
  const sunOnly=/^(sonnig|klar)$/.test(t),fewCl=/ziemlich sonnig|leicht bewölkt/.test(t),part=/teilweise|aufhellungen|zum teil|wechselnd|hohe bewölkung/.test(t),heavy=/stark bewölkt|bedeckt/.test(t);
  const sunC=night?"#9aa4ad":"#f2b100";let g="";
  const sun=(x,y,r)=>night?`<path d="M${x+r*0.4} ${y-r}a${r} ${r} 0 1 0 ${r*0.6} ${r*1.6}a${r*0.8} ${r*0.8} 0 0 1 ${-r*0.6} ${-r*1.6}z" fill="${sunC}"/>`:`<circle cx="${x}" cy="${y}" r="${r}" fill="${sunC}"/>`+[0,45,90,135,180,225,270,315].map(a=>{const q=a*Math.PI/180;return `<line x1="${x+Math.cos(q)*(r+2)}" y1="${y+Math.sin(q)*(r+2)}" x2="${x+Math.cos(q)*(r+5)}" y2="${y+Math.sin(q)*(r+5)}" stroke="${sunC}" stroke-width="2" stroke-linecap="round"/>`;}).join("");
  const cloud=(x,y,s,col)=>`<path transform="translate(${x} ${y}) scale(${s})" d="M6 18h17a5 5 0 0 0 .6-10 7 7 0 0 0-13.3 2A4 4 0 0 0 6 18z" fill="${col}" stroke="#7b8792" stroke-width="${1/s}"/>`;
  if(sunOnly)g=sun(20,20,8);
  else if(fog){g=cloud(4,2,1.1,"#cfd6dc")+`<path d="M6 28h28M9 33h22" stroke="#9aa4ad" stroke-width="2.5" stroke-linecap="round"/>`;}
  else{if(fewCl||part)g+=sun(14,13,6.5);g+=cloud(fewCl?10:part?7:4,fewCl?10:part?7:3,fewCl?0.95:1.15,heavy?"#b9c2ca":"#e8edf1");}
  const y0=29;if(rain&&!thunder)g+=[12,19,26].map((x,i)=>i<(/schwach|einzelne|leicht/.test(t)?2:3)?`<line x1="${x}" y1="${y0}" x2="${x-2}" y2="${y0+6}" stroke="#1e88e5" stroke-width="2.2" stroke-linecap="round"/>`:"").join("");
  if(snow)g+=[[rain?27:14,y0+3],[rain?33:23,y0+5],[30,y0+1]].slice(0,rain?1:/schwach|einzelne|leicht/.test(t)?2:3).map(([x,y])=>`<g stroke="#5c8fbf" stroke-width="1.6" stroke-linecap="round"><line x1="${x-3}" y1="${y}" x2="${x+3}" y2="${y}"/><line x1="${x-1.5}" y1="${y-2.6}" x2="${x+1.5}" y2="${y+2.6}"/><line x1="${x+1.5}" y1="${y-2.6}" x2="${x-1.5}" y2="${y+2.6}"/></g>`).join("");
  if(thunder)g+=`<path d="M20 25l-4 8h4l-2 6 7-9h-4l2-5z" fill="#f2b100" stroke="#b07f00" stroke-width=".8"/>`;
  return `<svg viewBox="0 0 40 40" style="width:${sz}px;height:${sz}px;stroke:none;fill:none" role="img" aria-label="${esc(wxText(c))}"><title>${esc(wxText(c))}</title>${g}</svg>`;}
function weatherHTML(w){if(!w)return `<div class="card"><h3><svg><use href="#i-sun"/></svg>Wetter</h3><div class="muted">Noch keine Prognose gespeichert. Mit Netz «Jetzt aktualisieren» tippen.</div></div>`;
  const old=Date.now()-w.t>36*3600e3;
  const td=w.days.find(d=>d.date===today());
  /* gemeinsame Skala für alle Tage: 0 bis M mm (mind. 10, auf 5 aufgerundet) */
  const M=Math.max(10,Math.ceil(Math.max(...w.days.map(d=>Math.max(d.rr||0,d.q90||0)))/5)*5);const pc=v=>Math.max(0,Math.min(100,v/M*100));const hasQ=w.days.some(d=>d.q90!=null);
  return `<div class="card"><h3>${td&&td.sy?wxIcon(td.sy,26):`<svg><use href="#i-sun"/></svg>`}Prognose${td&&td.sy?` <small class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· heute ${esc(wxText(td.sy))}</small>`:""}</h3><p class="muted small">${w.sname&&w.sname!==w.name?`Symbol: <b>${esc(w.sname)}</b> (${fmtN(w.sh)} m) · Temperatur und Niederschlag: <b>${esc(w.name)}</b> (${fmtN(w.h)} m, ${fmtN(w.dist,1)} km)`:`Prognosepunkt <b>${esc(w.name)}</b> (${fmtN(w.h)} m, ${fmtN(w.dist,1)} km entfernt)`} · gespeichert ${fmtDT(w.t)}</p>
   ${old?`<div class="note">Die Prognose ist älter als 36 Stunden.</div>`:""}
   <div class="wx">${w.days.map(d=>{const dt=new Date(d.date+"T12:00");const snow=d.rr>0.5&&d.tx<1.5;const ic=d.sy?wxIcon(d.sy,34):`<svg style="width:20px;height:20px;color:${d.rr>0.5?"#1e88e5":"#e0a100"}"><use href="#i-${snow?"snow":d.rr>0.5?"cloud":"sun"}"/></svg>`;
     const k5=Math.round((dt-new Date(today()+"T12:00"))/864e5);const tap=w.pid!=null&&k5>=0&&k5<WXH_DAYS;
     return `<div title="${esc(wxText(d.sy))}"${tap?` class="wxtap" data-wxd="${w.pid}|${d.date}|${w.lat}|${w.lon}" data-wxn="${esc(w.sname||w.name)}" role="button"`:""}><b>${WD[dt.getDay()]} ${dt.getDate()}.${dt.getMonth()+1}.</b>${ic}<div>${fmtN(d.tn)}° / <b style="display:inline">${fmtN(d.tx)}°</b></div>
     <div class="muted">${fmtN(d.rr,1)} mm${d.q90!=null&&d.q90-(d.q10||0)>=0.5?`<br><small>${fmtN(d.q10||0,d.q10<10?1:0)}–${fmtN(d.q90,d.q90<10?1:0)}</small>`:""}</div>
     <div class="rtrack" title="0–${M} mm">${d.q90!=null?`<i class="rq" style="left:${pc(d.q10||0)}%;width:${Math.max(1.5,pc(d.q90)-pc(d.q10||0))}%"></i>`:""}<i class="rm" style="left:${pc(d.rr||0)}%"></i></div>${d.sy?`<div class="wxt">${esc(wxText(d.sy))}</div>`:""}</div>`;}).join("")}</div></div>`;}

/* ---------- Jetzt gemessen: SwissMetNet-Stationen (10-Minuten-Werte von heute) ---------- */
const SMN="https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn";
async function smnStations(){let m=await metaGet("smnmeta",null);if(m&&Date.now()-m.t<30*864e5)return m;if(!navigator.onLine)return m;
  const tx=await fetchText1252(SMN+"/ogd-smn_meta_stations.csv");const L=tx.split(/\r?\n/).filter(Boolean);const h=L[0].split(";").map(x=>x.replace(/"/g,""));
  const ix=re=>h.findIndex(c=>re.test(c));const iA=ix(/^station_abbr$/),iN=ix(/^station_name$/),iH=ix(/height_masl/),iLa=ix(/wgs84_lat/),iLo=ix(/wgs84_lon/);
  if(iA<0||iLa<0||iLo<0)throw new Error("Stationsliste unbekannt");
  m={t:Date.now(),s:L.slice(1).map(l=>l.split(";").map(x=>x.replace(/^"|"$/g,""))).filter(c=>isFinite(+c[iLa])&&+c[iLa]>40).map(c=>({a:c[iA],n:iN>=0?c[iN]:c[iA],h:iH>=0?Math.round(+c[iH]):null,lat:+c[iLa],lon:+c[iLo]}))};
  await metaSet("smnmeta",m);return m;}
/* Kandidaten in Reihenfolge: zwei nächste, dann die höhenmässig passendste, dann weitere nach Nähe (für Ersatz, falls eine Station gerade nichts meldet) */
function pickStations(list,lat,lon,h){const c=list.map(s=>Object.assign({d:distM(lat,lon,s.lat,s.lon)/1000},s)).filter(s=>s.d<40).sort((a,b)=>a.d-b.d);const out=c.slice(0,2);
  if(h){const b=c.slice(0,12).reduce((m,x)=>!m||Math.abs(x.h-h)<Math.abs(m.h-h)?x:m,null);if(b&&!out.includes(b))out.push(b);}
  for(const x of c.slice(0,8))if(!out.includes(x))out.push(x);return out.slice(0,7);}
const usable=v=>v&&(v.ta!=null||v.ff!=null);
async function smnNow(abbr){const a=abbr.toLowerCase();let href=`${SMN}/${a}/ogd-smn_${a}_t_now.csv`;let r=await fetch(href,{cache:"no-store"});
  if(!r.ok){const it=await (await fetch(`https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-smn/items/${a}`,{cache:"no-store"})).json();const k=Object.keys(it.assets||{}).find(x=>/_t_now\.csv$/.test(x));if(!k)throw new Error("keine aktuellen Werte");href=it.assets[k].href;r=await fetch(href,{cache:"no-store"});}
  const tx=await r.text();const L=tx.split(/\r?\n/).filter(Boolean);const hd=L[0].split(";");const rows=L.slice(1).map(l=>l.split(";"));const col=k=>hd.indexOf(k);
  const num=(row,k)=>{const i=col(k);if(i<0)return null;const v=parseFloat(row[i]);return isFinite(v)?v:null;};
  const full=rows.filter(rw=>num(rw,"tre200s0")!=null||num(rw,"fu3010z0")!=null);const last=full[full.length-1];if(!last)throw new Error("keine aktuellen Werte");
  const ts=(last[col("reference_timestamp")]||"").match(/(\d+)\.(\d+)\.(\d+) (\d+):(\d+)/);const t=ts?Date.UTC(+ts[3],+ts[2]-1,+ts[1],+ts[4],+ts[5]):Date.now();
  const lastN=k=>{for(let i=rows.length-1;i>=0;i--){const v=num(rows[i],k);if(v!=null)return v;}return null;};
  const li=rows.indexOf(last);let rr=0,any=false;for(let i=Math.max(0,li-5);i<=li;i++){const v=num(rows[i],"rre150z0");if(v!=null){rr+=v;any=true;}}
  return {t,ta:num(last,"tre200s0"),rh:num(last,"ure200s0"),ff:num(last,"fu3010z0"),fx:num(last,"fu3010z1"),dd:num(last,"dkl010z0"),rr:any?Math.round(rr*10)/10:null,hs:lastN("htoauts0"),sun:num(last,"sre000z0")};}
async function nowCached(){return (await metaGet("smnnow",null))||{};}
async function fetchNowFor(sts){const cache=await nowCached();let ok=0;
  /* der Reihe nach, bis drei Stationen brauchbare Werte haben (spart Abfragen) */
  for(let i=0;i<sts.length&&ok<3;i+=3){await Promise.all(sts.slice(i,i+3).map(async s=>{try{cache[s.a]=Object.assign(await smnNow(s.a),{fetched:Date.now()});}catch(e){cache[s.a]={none:1,fetched:Date.now()};}}));
    ok=sts.slice(0,i+3).filter(s=>usable(cache[s.a])).length;}
  await metaSet("smnnow",cache);return cache;}
const DIRS=["N","NO","O","SO","S","SW","W","NW"];const dirTxt=d=>d==null?"":DIRS[Math.round(d/45)%8];
function nowHTML(sts,cache,loading){if(!sts)return `<div class="card"><h3><svg><use href="#i-gauge"/></svg>Jetzt gemessen</h3><div class="muted">${navigator.onLine?"Stationen werden geladen …":"Stationsliste noch nicht gespeichert (einmal mit Netz öffnen)."}</div></div>`;
  if(!sts.length)return `<div class="card"><h3><svg><use href="#i-gauge"/></svg>Jetzt gemessen</h3><div class="muted">Keine Messstation im Umkreis von 35 km.</div></div>`;
  const withV=sts.filter(s=>usable(cache[s.a]));const show=(withV.length?withV:sts).slice(0,3);
  return `<div class="card"><h3><svg><use href="#i-gauge"/></svg>Jetzt gemessen${loading?` <small class="muted">· wird aktualisiert …</small>`:""}</h3>${show.map(s=>{const v=usable(cache[s.a])?cache[s.a]:null;const age=v?Math.round((Date.now()-v.t)/60000):null;
    return `<div class="q"><div class="grow"><b>${esc(s.n)}</b> <small class="muted">${s.h!=null?fmtN(s.h)+" m · ":""}${fmtN(s.d,1)} km</small><br>
     ${v?`<span style="font-size:17px;font-weight:700;color:var(--nacht)">${v.ta!=null?fmtN(v.ta,1)+" °C":"–"}</span>
      <small>${v.ff!=null?` · Wind ${fmtN(v.ff)} km/h ${dirTxt(v.dd)}${v.fx!=null?`, Böen ${fmtN(v.fx)}`:""}`:""}${v.rr!=null?` · ${fmtN(v.rr,1)} mm/h`:""}${v.hs!=null?` · Schnee ${fmtN(v.hs)} cm`:""}${v.rh!=null?` · ${fmtN(v.rh)} % Feuchte`:""}</small>
      <br><small class="${age>90?"st-err":"muted"}">gemessen ${fmtDT(v.t)}${age!=null?` (vor ${age<120?age+" min":fmtN(age/60,1)+" h"})`:""}</small>`:`<small class="muted">noch keine Werte gespeichert</small>`}</div></div>`;}).join("")}
   <p class="muted small">Quelle: MeteoSchweiz (SwissMetNet, 10-Minuten-Werte).</p></div>`;}
/* ---------- Bulletin und Wetter zusammen holen ---------- */
async function fetchConditions(){let ok=0;progress("Lawinenbulletin laden",0,0,"SLF");try{await fetchBulletin();ok++;}catch(e){toast("Bulletin: "+e.message,4000);}
  try{await fetchWeather(s=>progress("Wetter laden",0,0,"MeteoSchweiz: "+s));ok++;}catch(e){toast("Wetter: "+e.message,4000);}
  try{await fetchHourlyAll();}catch(e){toast("Tagesverlauf: "+e.message,4000);}progressDone();if(ok===2)toast("Bulletin und Wetter gespeichert");ls("condT",Date.now());}
async function condCenterPanel(){const s=await metaGet("slf",null),w=await metaGet("wx",null);const auto=ls("autocond")!=="0";
  return {title:"Lawinenbulletin & Wetter",icon:`<svg><use href="#i-snow"/></svg>`,html:`
   <div class="card"><h3>Gespeicherter Stand</h3><div class="q"><span class="grow">Lawinenbulletin (SLF)</span><b>${s?fmtDT(s.t):"–"}</b></div><div class="q"><span class="grow">Wetterprognose (MeteoSchweiz)</span><b>${w?fmtDT(w.t):"–"}</b></div>
    <p class="muted small">Ganze Schweiz rund 3 MB, dazu der Tagesverlauf (4 Tage) für deine Orte und Touren. Danach für jeden Ort, jede Tour und «Ideen» ohne Netz verfügbar.</p>
    <button class="btn pri full" id="ccGo"><svg><use href="#i-down"/></svg>Jetzt aktualisieren</button></div>
   <label class="tg card"><span>Beim Öffnen automatisch aktualisieren<br><small class="muted">mit Netz, wenn der Stand älter als 6 Stunden ist</small></span><span class="sw2"><input type="checkbox" id="ccA"${auto?" checked":""}><i></i></span></label>
   <div class="btns"><button class="btn" id="ccHere"><svg><use href="#i-pin"/></svg>Für die Kartenmitte anzeigen</button></div>`,
   after(P){$("#ccGo",P).onclick=async()=>{if(!navigator.onLine)return toast("Kein Internet");await fetchConditions();refreshPanel();};
     $("#ccA",P).onchange=e=>ls("autocond",e.target.checked?"1":"0");$("#ccHere",P).onclick=()=>{const c=map.getCenter();openPanel(()=>conditionsPanel(c.lat,c.lon,null,"Kartenmitte"));};}};}

async function bootOffline(){bootPlanEvents();try{const T=await tdb();const R=await getAll("regions",T);for(const r of R)if(r.state==="run"||r.state==="names"){r.state="paused";await put("regions",r,T);}
    if(R.some(r=>r.state==="paused"||r.state==="err"||r.state==="wait"))setTimeout(()=>toast("Ein Offline-Download ist angehalten – unter Mehr › Offline-Regionen fortsetzen",5000),2500);}catch(e){}
  const t=+ls("condT")||0;if(ls("autocond")!=="0"&&navigator.onLine&&Date.now()-t>6*3600e3)setTimeout(()=>{fetchBulletin().catch(()=>{});fetchWeather().then(()=>ls("condT",Date.now())).catch(()=>{});},4000);}
