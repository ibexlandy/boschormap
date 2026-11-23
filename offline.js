/* Boschor Map – Offline-Regionen (Kacheln in IndexedDB), Ortsnamen, Lawinenbulletin (SLF), Wetter (MeteoSchweiz) */
"use strict";
const LIM_KM2=300,LIM_TILES=20000,ZMIN_OFF=8;
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
   <p class="muted">Gespeicherte swisstopo-Karten (und gewählte Ebenen) sind auch ohne Netz da. Grenzen pro Region: ${LIM_KM2} km² und ${fmtN(LIM_TILES)} Kacheln.</p>
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
function startRegionSelect(){if(planState)return toast("Zuerst die Planung beenden");closePanel();const bb=map.getBounds();const dy=(bb[2]-bb[0])*0.18,dx=(bb[3]-bb[1])*0.15;
  regionSel={b:[bb[0]+dy,bb[1]+dx,bb[2]-dy,bb[3]-dx],bases:["lk"],ovs:Object.keys(viewPrefs().ov||{}).filter(k=>viewPrefs().ov[k]),zmax:17};
  if(map.z<10)toast("Tipp: zuerst näher an das Gebiet zoomen",3500);
  showFrame(regionSel.b);const b=regionSel.b;
  const mk=(i)=>{const pos=[[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]][i];const h=map.addMarker({lat:pos[0],lon:pos[1],anchor:[0,0],drag:true,z:80,html:`<div class="hdl"></div>`});h.corner=i;return h;};
  frameHandles=[0,1,2,3].map(mk);map.on("markerdrag",onHandleDrag);
  modebar(`<b class="grow">Ecken ziehen, um den Ausschnitt zu wählen</b><button class="btn sm" id="rsX">Abbrechen</button><button class="btn sm pri" id="rsOk">Weiter</button>`);
  $("#rsX").onclick=endRegionSelect;$("#rsOk").onclick=()=>openPanel(regionFormPanel,{half:true});openPanel(regionFormPanel,{half:true});}
function onHandleDrag(e){if(!regionSel||e.marker.corner==null)return;const b=regionSel.b,i=e.marker.corner;
  if(i===0){b[2]=e.lat;b[1]=e.lon;}else if(i===1){b[2]=e.lat;b[3]=e.lon;}else if(i===2){b[0]=e.lat;b[3]=e.lon;}else{b[0]=e.lat;b[1]=e.lon;}
  if(b[0]>b[2])[b[0],b[2]]=[b[2],b[0]];if(b[1]>b[3])[b[1],b[3]]=[b[3],b[1]];
  const pos=[[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]];frameHandles.forEach((h,k)=>{if(h!==e.marker)map.moveMarker(h,pos[k][0],pos[k][1]);});frameEl._u();
  clearTimeout(regionSel._t);regionSel._t=setTimeout(()=>{const el=$("#rfEst");if(el)el.innerHTML=regionEstHTML();},120);}
function endRegionSelect(){map.off("markerdrag",onHandleDrag);hideFrame();regionSel=null;modebar(null);closePanel();}
function regionEstHTML(){const r={bbox:regionSel.b,bases:regionSel.bases,ovs:regionSel.ovs,zmax:regionSel.zmax};const c=regionCount(r);const a=areaKm2(r.bbox);
  const bad=a>LIM_KM2||c.n>LIM_TILES;regionSel.ok=!bad&&(r.bases.length+r.ovs.length)>0;
  return `<b>${fmtN(a)} km²</b> · <b>${fmtN(c.n)}</b> Kacheln · ca. <b>${fmtN(c.mb)} MB</b>${bad?`<div class="st-err">Zu gross – Ausschnitt verkleinern oder Zoomstufe senken (max. ${LIM_KM2} km², ${fmtN(LIM_TILES)} Kacheln).</div>`:""}`;}
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

/* ---------- Download (massvoll: 2 gleichzeitig, kurze Pausen, Abbruch jederzeit) ---------- */
async function resumeRegion(id){const T=await tdb();const r=await getOne("regions",id,T);if(!r)return;if(!navigator.onLine)return toast("Kein Internet");r.state="wait";await put("regions",r,T);pumpQueue();refreshPanel();}
async function pumpQueue(){if(dl)return;const T=await tdb();const R=(await getAll("regions",T)).filter(r=>r.state==="wait").sort((a,b)=>a.created-b.created);if(!R.length){updPill();return;}
  const r=R[0];dl={id:r.id,stop:false};r.state="run";await put("regions",r,T);updPill(r);refreshRegionsPanel();
  try{await downloadRegion(r,T);if(!dl.stop){r.state="names";await put("regions",r,T);refreshRegionsPanel();await downloadNames(r,T);}
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
      await sleep(30);}};
    await Promise.all([worker(),worker()]);
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
     ${a.core?`<br><small class="muted">${esc(a.core)}</small>`:""}${a.c?`<details><summary class="small">Beschreibung</summary><p class="small" style="white-space:pre-wrap">${esc(a.c)}</p></details>`:""}</div></div>`).join("")}
   ${h&&b.critLow!=null&&h>=b.critLow?`<div class="note">Der Zielort (${fmtN(h)} m) liegt im Höhenbereich der Lawinenprobleme.</div>`:""}
   ${b.snow?`<details><summary class="small">Schneedecke</summary><p class="small" style="white-space:pre-wrap">${esc(b.snow)}</p></details>`:""}
   ${b.tend?`<details><summary class="small">Tendenz</summary><p class="small">${esc(b.tend)}</p></details>`:""}
   <p class="muted small">Quelle: WSL-Institut für Schnee- und Lawinenforschung SLF, www.slf.ch</p></div>`;}
function bindBulletin(){}

/* ---------- Wetter: Lokalprognosen MeteoSchweiz (Tageswerte, ganze Schweiz, offline gespeichert) ---------- */
let wxMem=null;const STAC="https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting";
async function fetchText1252(u){const r=await fetch(u,{cache:"no-store"});if(!r.ok)throw new Error("MeteoSchweiz: Fehler "+r.status);const b=await r.arrayBuffer();
  try{return new TextDecoder("utf-8",{fatal:true}).decode(b);}catch(e){return new TextDecoder("windows-1252").decode(b);}}
async function fetchWeather(onStep){const its=await (await fetch(STAC+"/items?limit=100",{cache:"no-store"})).json();const item=(its.features||[]).slice().sort((a,b)=>a.id.localeCompare(b.id)).pop();if(!item)throw new Error("Keine Prognose gefunden");
  const ks=Object.keys(item.assets);const run=ks.map(k=>k.split(".")[2]).filter(Boolean).sort().pop();
  let meta=await metaGet("wxmeta",null);if(!meta||Date.now()-meta.t>30*864e5){onStep&&onStep("Prognosepunkte");const tx=await fetchText1252("https://data.geo.admin.ch/ch.meteoschweiz.ogd-local-forecasting/ogd-local-forecasting_meta_point.csv");
    const rows=tx.split(/\r?\n/).slice(1).map(l=>l.split(";")).filter(c=>c.length>13);meta={t:Date.now(),p:rows.map(c=>[+c[0],c[4],+c[9],+c[12],+c[13],c[5]==="Station"?"S":c[5]==="Point of Interest"?"P":"O"])};await metaSet("wxmeta",meta);}
  const idx=new Map(meta.p.map((p,i)=>[p[0],i]));const par={tx:"tre200dx",tn:"tre200dn",rr:"rka150d0"};const dates=new Set();const raw={};
  for(const [k,p] of Object.entries(par)){onStep&&onStep(k==="tx"?"Höchsttemperatur":k==="tn"?"Tiefsttemperatur":"Niederschlag");const key=ks.find(x=>x.includes("."+run+".")&&x.includes("."+p+"."));if(!key)throw new Error("Prognose unvollständig ("+p+")");
    const tx=await fetchText1252(item.assets[key].href);const m=new Map();for(const l of tx.split(/\r?\n/).slice(1)){const c=l.split(";");if(c.length<4)continue;const d=c[2].slice(0,8);dates.add(d);
      const v=parseFloat(c[3]);(m.get(+c[0])||m.set(+c[0],{}).get(+c[0]))[d]=isFinite(v)?v:null;}raw[k]=m;}
  const D=[...dates].sort();const v={tx:[],tn:[],rr:[]};for(const p of meta.p){for(const k of ["tx","tn","rr"]){const m=raw[k].get(p[0])||{};v[k].push(D.map(d=>m[d]!=null?m[d]:null));}}
  wxMem={t:Date.now(),run,dates:D.map(d=>`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`),v};await metaSet("wx",wxMem);return wxMem;}
async function weatherAt(lat,lon,h){if(!wxMem)wxMem=await metaGet("wx",null);const meta=await getWxMeta();if(!wxMem||!meta)return null;
  const c=meta.p.map((p,i)=>({i,p,d:distM(lat,lon,p[3],p[4])/1000})).filter(x=>x.d<20).sort((a,b)=>a.d-b.d).slice(0,12);if(!c.length)return null;
  const best=h?c.reduce((m,x)=>(x.d+Math.abs(x.p[2]-h)/150<m.d+Math.abs(m.p[2]-h)/150?x:m),c[0]):c[0];const i=best.i;const td=today();
  return {name:best.p[1],h:best.p[2],dist:best.d,t:wxMem.t,run:wxMem.run,days:wxMem.dates.map((d,k)=>({date:d,tx:wxMem.v.tx[i][k],tn:wxMem.v.tn[i][k],rr:wxMem.v.rr[i][k]})).filter(x=>x.date>=td&&x.tx!=null)};}
let wxMetaMem=null;async function getWxMeta(){if(!wxMetaMem)wxMetaMem=await metaGet("wxmeta",null);return wxMetaMem;}
const WD=["So","Mo","Di","Mi","Do","Fr","Sa"];
function weatherHTML(w){if(!w)return `<div class="card"><h3><svg><use href="#i-sun"/></svg>Wetter</h3><div class="muted">Noch keine Prognose gespeichert. Mit Netz «Jetzt aktualisieren» tippen.</div></div>`;
  const old=Date.now()-w.t>36*3600e3;
  return `<div class="card"><h3><svg><use href="#i-sun"/></svg>Wetter</h3><p class="muted small">Prognosepunkt <b>${esc(w.name)}</b> (${fmtN(w.h)} m, ${fmtN(w.dist,1)} km entfernt) · gespeichert ${fmtDT(w.t)}</p>
   ${old?`<div class="note">Die Prognose ist älter als 36 Stunden.</div>`:""}
   <div class="wx">${w.days.map(d=>{const dt=new Date(d.date+"T12:00");const snow=d.rr>0.5&&d.tx<1.5;return `<div><b>${WD[dt.getDay()]} ${dt.getDate()}.${dt.getMonth()+1}.</b>
     <svg style="width:20px;height:20px;color:${d.rr>0.5?"#1e88e5":"#e0a100"}"><use href="#i-${snow?"snow":d.rr>0.5?"cloud":"sun"}"/></svg><div>${fmtN(d.tn)}° / <b style="display:inline">${fmtN(d.tx)}°</b></div>
     <div class="muted">${fmtN(d.rr,1)} mm</div><div class="rbar" style="width:${Math.min(100,d.rr*6)}%"></div></div>`;}).join("")}</div>
   <p class="muted small">Quelle: MeteoSchweiz (Tageswerte). Symbole nur nach Niederschlag, keine Bewölkungsangabe.</p></div>`;}

/* ---------- Bulletin und Wetter zusammen holen ---------- */
async function fetchConditions(){let ok=0;progress("Lawinenbulletin laden",0,0,"SLF");try{await fetchBulletin();ok++;}catch(e){toast("Bulletin: "+e.message,4000);}
  try{await fetchWeather(s=>progress("Wetter laden",0,0,"MeteoSchweiz: "+s));ok++;}catch(e){toast("Wetter: "+e.message,4000);}progressDone();if(ok===2)toast("Bulletin und Wetter gespeichert");ls("condT",Date.now());}
async function condCenterPanel(){const s=await metaGet("slf",null),w=await metaGet("wx",null);const auto=ls("autocond")!=="0";
  return {title:"Lawinenbulletin & Wetter",icon:`<svg><use href="#i-snow"/></svg>`,html:`
   <div class="card"><h3>Gespeicherter Stand</h3><div class="q"><span class="grow">Lawinenbulletin (SLF)</span><b>${s?fmtDT(s.t):"–"}</b></div><div class="q"><span class="grow">Wetterprognose (MeteoSchweiz)</span><b>${w?fmtDT(w.t):"–"}</b></div>
    <p class="muted small">Ganze Schweiz, rund 3 MB. Danach für jeden Ort, jede Tour und «Wochenende» ohne Netz verfügbar.</p>
    <button class="btn pri full" id="ccGo"><svg><use href="#i-down"/></svg>Jetzt aktualisieren</button></div>
   <label class="tg card"><span>Beim Öffnen automatisch aktualisieren<br><small class="muted">mit Netz, wenn der Stand älter als 6 Stunden ist</small></span><span class="sw2"><input type="checkbox" id="ccA"${auto?" checked":""}><i></i></span></label>
   <div class="btns"><button class="btn" id="ccHere"><svg><use href="#i-pin"/></svg>Für die Kartenmitte anzeigen</button></div>`,
   after(P){$("#ccGo",P).onclick=async()=>{if(!navigator.onLine)return toast("Kein Internet");await fetchConditions();refreshPanel();};
     $("#ccA",P).onchange=e=>ls("autocond",e.target.checked?"1":"0");$("#ccHere",P).onclick=()=>{const c=map.getCenter();openPanel(()=>conditionsPanel(c.lat,c.lon,null,"Kartenmitte"));};}};}

async function bootOffline(){bootPlanEvents();try{const T=await tdb();const R=await getAll("regions",T);for(const r of R)if(r.state==="run"||r.state==="names"){r.state="paused";await put("regions",r,T);}
    if(R.some(r=>r.state==="paused"||r.state==="err"||r.state==="wait"))setTimeout(()=>toast("Ein Offline-Download ist angehalten – unter Mehr › Offline-Regionen fortsetzen",5000),2500);}catch(e){}
  const t=+ls("condT")||0;if(ls("autocond")!=="0"&&navigator.onLine&&Date.now()-t>6*3600e3)setTimeout(()=>{fetchBulletin().catch(()=>{});fetchWeather().then(()=>ls("condT",Date.now())).catch(()=>{});},4000);}
