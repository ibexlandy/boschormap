/* BoschorMap – Touren: GPX-Import, Liste, Detail mit Höhenprofil, Planung, Tempo, Ideen, Checklisten */
"use strict";
const r5=v=>Math.round(v*1e5)/1e5;
async function saveTour(t,line,raw){t.mod=Date.now();if(!t.created)t.created=t.mod;
  if(line){t.disp=simplify(line,4).map(p=>[r5(p[0]),r5(p[1])]);t.bbox=bboxOf(line);t.lineRev=t.mod;
    if(t.status==="gemacht"&&line.some(p=>p[3]))t.pace=paceStats(line);await put("lines",{id:t.id,line,rev:t.lineRev});}
  if(raw)await put("raw",{id:t.id,gpx:raw});
  await put("tours",t);const i=S.tours.findIndex(x=>x.id===t.id);if(i<0)S.tours.push(t);else S.tours[i]=t;markDirty();map.render();return t;}
async function tourLine(id){const r=await getOne("lines",id);return r?r.line:null;}
function tempoFor(art){const base=S.settings.tempoLearn!==false?learnTempo(S.tours,art).t:tempoDefault(art);const f=(S.settings.tempoFactor||{})[art]||1;
  return {vf:base.vf*f,vu:base.vu*f,vd:base.vd*f};}
const estFor=t=>estTime((t.dist||0)/1000,t.up||0,t.down||0,tempoFor(t.art));
const artOpts=sel=>Object.entries(ARTS).map(([k,a])=>`<option value="${k}"${k===sel?" selected":""}>${a.n}</option>`).join("");

/* Name für eine importierte Tour: höchster Gipfel am Track (eigene Gipfel, sonst swissNAMES3D) */
const GENERIC_NAME=/^(suunto|skitour(ing)?|ski ?tour(ing)?|backcountry|hik(e|ing)|wander|trail|walk|running|run|cycling|ride|gravel|mountain ?bik|biking|bike|move|workout|activity|track|\d{4}[-_.])/i;
async function summitName(pts){let hi=null;for(const p of pts)if(p[2]!=null&&(!hi||p[2]>hi[2]))hi=p;if(!hi)return "";
  let best=null,bd=200;for(const q of S.points)if(!q.del&&q.cat==="gipfel"){const d=distM(hi[0],hi[1],q.lat,q.lon);if(d<bd){bd=d;best=q.name;}}if(best)return best;
  if(!navigator.onLine)return "";try{const [E,N]=toLV95(hi[0],hi[1]);const ext=[E-1000,N-1000,E+1000,N+1000].map(Math.round).join(",");
    const u=`https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryPoint&geometry=${E.toFixed(1)},${N.toFixed(1)}&imageDisplay=100,100,96&mapExtent=${ext}&tolerance=12&layers=all:ch.swisstopo.swissnames3d&sr=2056&returnGeometry=true&geometryFormat=geojson&limit=12&lang=de`;
    const r=await fetch(u);if(!r.ok)return "";const j=await r.json();let n="",nd=1e9;for(const f of j.results||[]){const at=f.attributes||f.properties||{};if(!at.name||nameCat(at.objektart||"",at.name)!=="gipfel")continue;
      const g=f.geometry;const c=g&&g.type==="Point"?g.coordinates:g&&g.type==="MultiPoint"?g.coordinates[0]:null;const d=c?Math.hypot(c[0]-E,c[1]-N):500;if(d<nd){nd=d;n=at.name;}}return n.split("|")[0].trim();}catch(e){return "";}}
const GPX_MAX=40*1048576;
/* ---------- GPX-Import (mehrere Dateien) ---------- */
async function importGPX(files){const items=[];progress("GPX lesen",0,files.length);
  for(let i=0;i<files.length;i++){progress("GPX lesen",i,files.length,files[i].name);try{if(files[i].size>GPX_MAX)throw new Error(`zu gross (${fmtN(files[i].size/1048576,1)} MB, höchstens ${GPX_MAX/1048576} MB)`);const txt=await files[i].text();if(!/<gpx[\s>]/i.test(txt.slice(0,5000)))throw new Error("keine GPX-Datei");const g=parseGPX(txt);if(g.pts.length<2)throw new Error("keine Trackpunkte");
      const t0=g.pts.find(p=>p[3]);const art=guessArt(g.type+" "+g.name+" "+files[i].name)||ls("lastArt")||"wandern";
      items.push({file:files[i],txt,g,art,name:g.name&&!/^(suunto|track|move|activity)/i.test(g.name)?g.name:"",date:t0?new Date(t0[3]).toISOString().slice(0,10):today()});}
    catch(e){items.push({file:files[i],err:e.message});}}
  /* Gipfelname vorschlagen, wenn der GPX-Name nichtssagend ist */
  for(let i=0;i<items.length;i++){const it=items[i];if(it.err)continue;if(it.name&&!GENERIC_NAME.test(it.name))continue;progress("Gipfel erkennen",i,items.length,it.file.name);
    const n=await summitName(it.g.pts);if(n)it.name=n;}
  progressDone();const groups=mergeGroups(items);
  openPanel(()=>({title:`GPX importieren (${items.length})`,icon:`<svg><use href="#i-gpx"/></svg>`,html:`
    <p class="muted">Pro Tour Art und Name prüfen. Pausen und GPS-Ausreisser werden automatisch bereinigt, das Original bleibt gespeichert.</p>
    ${groups.map((g,k)=>`<div class="card"><label class="chk"><input type="checkbox" data-mg="${k}" checked><span><b>${g.idx.length} Tracks vom ${fmtDate(g.date)} zu einer Tour zusammenfassen</b><br><small class="muted">Unterbrüche: ${g.gaps.map(fmtGap).join(", ")} · Name und Art vom ersten Track</small></span></label></div>`).join("")}
    ${items.length>1?`<div class="card row"><span class="grow">Art für alle</span><select class="inp" id="gAll" style="width:auto"><option value="">–</option>${artOpts("")}</select></div>`:""}
    ${items.map((it,i)=>it.err?`<div class="card"><b>${esc(it.file.name)}</b><div class="st-err">${esc(it.err)}</div></div>`:`<div class="card"><div class="muted small">${esc(it.file.name)} · ${fmtDate(it.date)} · ${fmtN(it.g.pts.length)} Punkte</div>
      <div class="row" style="margin-top:6px"><input class="inp grow" data-n="${i}" placeholder="Name der Tour" value="${esc(it.name)}"><select class="inp" data-a="${i}" style="width:auto">${artOpts(it.art)}</select></div></div>`).join("")}
    <button class="btn pri full" id="gGo"${items.some(x=>!x.err)?"":" disabled"}><svg><use href="#i-down"/></svg>Importieren</button>`,
    after(P){const ga=$("#gAll",P);if(ga)ga.onchange=()=>{if(ga.value)$$("[data-a]",P).forEach(s=>s.value=ga.value);};
      $("#gGo",P).onclick=async()=>{for(const s of $$("[data-a]",P))items[+s.dataset.a].art=s.value;for(const s of $$("[data-n]",P))items[+s.dataset.n].name=s.value.trim();
        for(const c of $$("[data-mg]",P))groups[+c.dataset.mg].on=c.checked;
        /* zusammengefasste Gruppen als ein Eintrag */
        const done=new Set(),list=[];for(let i=0;i<items.length;i++){const it=items[i];if(it.err||done.has(i))continue;const g=groups.find(g=>g.on&&g.idx.includes(i));
          if(g){const parts=g.idx.map(j=>items[j]);g.idx.forEach(j=>done.add(j));const f=parts[0];list.push(Object.assign({},f,{parts,file:{name:parts.map(x=>x.file.name).join(" + ")}}));}else list.push(it);}
        closePanel();await doImport(list);};}}));}
async function doImport(items){const added=[],skipped=[];
  for(let i=0;i<items.length;i++){const it=items[i];progress("Touren bereinigen und speichern",i,items.length,it.name||it.file.name);await sleep(10);
    const c=it.parts?combineClean(it.parts.map(x=>cleanTrack(x.g.pts,it.art))):cleanTrack(it.g.pts,it.art);const st=c.stats;if(it.parts)it.txt=mergeGpxText(it.parts.map(x=>x.txt),it.name);
    const dup=S.tours.find(t=>!t.del&&t.status==="gemacht"&&t.t0&&st.t0&&Math.abs(t.t0-st.t0)<60000&&Math.abs((t.dist||0)-st.dist)<Math.max(50,st.dist*0.02));
    if(dup){skipped.push(it.name||it.file.name);continue;}
    const t={id:uid(),status:"gemacht",src:"gpx",art:it.art,name:it.name||`${ARTS[it.art].n} ${fmtDate(it.date)}`,date:it.date,dist:st.dist,up:st.up,down:st.down,moving:st.moving,total:st.total,
      t0:st.t0,emin:st.emin,emax:st.emax,removed:c.removed,pauses:c.pauses.length,note:"",rate:{},diff:"",...(it.parts?{merged:it.parts.length}:{})};
    await saveTour(t,c.pts,it.txt);added.push({t,line:c.pts});}
  let tc=0;for(const a of added)tc+=await attachTripPhotos(a.t,a.line);if(tc)toast(`${tc} Unterwegs-Foto${tc>1?"s":""} auf die Route gesetzt`,4000);
  ls("lastArt",items.length?items[items.length-1].art:"");progressDone();
  if(skipped.length)toast(`${skipped.length} schon vorhanden – übersprungen`,4000);
  if(!added.length)return;
  /* Gipfel bis 100 m neben dem Track vorschlagen, passende Ideen erkennen */
  const sug=[],ideas=[];
  for(const a of added){for(const p of S.points){if(p.del||p.cat!=="gipfel")continue;const bb=a.t.bbox;if(p.lat<bb[0]-0.002||p.lat>bb[2]+0.002||p.lon<bb[1]-0.003||p.lon>bb[3]+0.003)continue;
      if(distLine(p.lat,p.lon,a.line)<=100&&!(p.visits||[]).some(v=>v.d===a.t.date))sug.push({p,t:a.t});}
    for(const id of S.tours.filter(x=>!x.del&&x.status==="idee"&&x.disp&&x.disp.length>1)){const d=id.disp;let n=0;for(const q of d)if(distLine(q[0],q[1],a.line)<250)n++;
      if(n/d.length>=0.6)ideas.push({idea:id,t:a.t});}}
  const finish=()=>{const all=added.map(a=>a.t.bbox);const bb=[Math.min(...all.map(b=>b[0])),Math.min(...all.map(b=>b[1])),Math.max(...all.map(b=>b[2])),Math.max(...all.map(b=>b[3]))];
    map.fitBounds(bb,50,sheetPad(),sheetPadR());if(added.length===1)showTour(added[0].t.id);else{toast(`${added.length} Touren importiert`);openPanel(toursPanel);}};
  if(!sug.length&&!ideas.length){finish();return;}
  openPanel(()=>({title:"Passt das?",html:`
    ${sug.length?`<div class="card"><h3>Gipfel am Weg</h3><p class="muted">Diese Gipfel liegen höchstens 100 m neben dem Track. Als besucht eintragen (mit dem Datum der Tour)?</p>
      ${sug.map((s,i)=>`<label class="chk"><input type="checkbox" data-s="${i}" checked><span><b>${esc(s.p.name)}</b> ${s.p.hoehe?fmtN(s.p.hoehe)+" m":""}<br><small class="muted">${esc(s.t.name)} · ${fmtDate(s.t.date)}</small></span></label>`).join("")}</div>`:""}
    ${ideas.length?`<div class="card"><h3>Geplante Idee gemacht?</h3>${ideas.map((x,i)=>`<label class="chk"><input type="checkbox" data-i="${i}" checked><span>Idee <b>${esc(x.idea.name)}</b> gehört zu <b>${esc(x.t.name)}</b> – Idee als erledigt übernehmen</span></label>`).join("")}</div>`:""}
    <button class="btn pri full" id="sOk"><svg><use href="#i-check"/></svg>Übernehmen</button><button class="btn full" id="sNo" style="margin-top:8px">Nichts eintragen</button>`,
    after(P){$("#sNo",P).onclick=()=>{closePanel();finish();};
      $("#sOk",P).onclick=async()=>{for(const c of $$("[data-s]",P))if(c.checked){const s=sug[+c.dataset.s];s.p.visits=(s.p.visits||[]).concat({d:s.t.date,note:"",tour:s.t.id});await savePoint(s.p);}
        for(const c of $$("[data-i]",P))if(c.checked){const x=ideas[+c.dataset.i];const t=x.t;if(/^\S+ \d+\.\d+\.\d{4}$/.test(t.name)||!t.name)t.name=x.idea.name;
          t.fromIdea=x.idea.id;if(!t.diff)t.diff=x.idea.diff||"";if(!t.note)t.note=x.idea.note||"";t.rate=Object.assign({},x.idea.rate||{},t.rate);await saveTour(t);x.idea.del=Date.now();await saveTour(x.idea);}
        closePanel();finish();};}}));}

/* ---------- Tourenliste mit Filter und Summen ---------- */
let tf={status:"gemacht",art:"",year:""};
function toursPanel(){const all=S.tours.filter(t=>!t.del);const years=[...new Set(all.filter(t=>t.status==="gemacht").map(t=>String(t.date||"").slice(0,4)).filter(Boolean))].sort().reverse();
  let L=all.filter(t=>t.status===tf.status&&(!tf.art||t.art===tf.art)&&(tf.status!=="gemacht"||!tf.year||String(t.date).startsWith(tf.year)));
  L.sort((a,b)=>tf.status==="gemacht"?String(b.date).localeCompare(String(a.date)):(b.mod||0)-(a.mod||0));
  const sum=L.reduce((s,t)=>{s.n++;s.km+=(t.dist||0)/1000;s.up+=t.up||0;s.mv+=t.moving||0;return s;},{n:0,km:0,up:0,mv:0});
  const byYear={};if(tf.status==="gemacht"&&!tf.year)for(const t of L){const y=String(t.date).slice(0,4);(byYear[y]=byYear[y]||{n:0,km:0,up:0}).n++;byYear[y].km+=(t.dist||0)/1000;byYear[y].up+=t.up||0;}
  return {title:"Touren",icon:`<svg><use href="#i-route"/></svg>`,html:`
   <div class="chips"><button class="chip${tf.status==="gemacht"?" on":""}" data-s="gemacht">Gemacht</button><button class="chip${tf.status==="idee"?" on":""}" data-s="idee">Geplant</button>
    <span class="grow"></span>${tf.status==="gemacht"?`<select class="inp" id="tY" style="width:auto;min-height:34px;padding:4px 8px"><option value="">Alle Jahre</option>${years.map(y=>`<option${y===tf.year?" selected":""}>${y}</option>`).join("")}</select>`:""}</div>
   <div class="chips"><button class="chip${!tf.art?" on":""}" data-a="">Alle</button>${Object.entries(ARTS).map(([k,a])=>`<button class="chip${tf.art===k?" on":""}" data-a="${k}" style="${tf.art===k?`background:${a.c};border-color:${a.c}`:`border-color:${a.c}`}">${a.n}</button>`).join("")}</div>
   ${tf.status==="gemacht"?`<div class="kv kv4" style="margin-bottom:10px"><div><b>${fmtN(sum.n)}</b><small>Touren</small></div><div><b>${fmtN(sum.km)}</b><small>km</small></div><div><b>${fmtN(sum.up)}</b><small>Höhenmeter</small></div><div><b>${fmtDur(sum.mv)}</b><small>in Bewegung</small></div></div>
    ${Object.keys(byYear).length>1?`<div class="card"><h3>Pro Jahr</h3><table style="width:100%;font-size:14px"><tr class="muted"><td>Jahr</td><td>Touren</td><td>km</td><td>Hm</td></tr>${Object.entries(byYear).sort((a,b)=>b[0].localeCompare(a[0])).map(([y,v])=>`<tr><td><b>${y}</b></td><td>${v.n}</td><td>${fmtN(v.km)}</td><td>${fmtN(v.up)}</td></tr>`).join("")}</table></div>`:""}`:""}

   ${L.map(t=>`<button class="li" data-id="${t.id}"><span class="sw" style="background:${ARTS[t.art].c}"></span><span class="t"><b>${esc(t.name)}</b><small>${t.status==="gemacht"?fmtDate(t.date)+" · ":""}${ARTS[t.art].n} · ${fmtKm(t.dist)} · ↑${fmtN(t.up)} m · ${t.status==="gemacht"?fmtDur(t.moving):"≈ "+fmtDur(estFor(t))}</small></span>${(t.rate||{}).gesamt?starsHTML(t.rate.gesamt,"",1):""}</button>`).join("")||`<div class="empty">${tf.status==="gemacht"?"Noch keine Touren. GPX-Dateien aus der Suunto-App importieren.":"Noch keine Ideen. Unter «Planen» eine Tour zeichnen."}</div>`}`,foot:`<div class="fabwrap"><div class="fabm" id="tAddM" hidden><button class="btn" id="tImp"><svg><use href="#i-gpx"/></svg>GPX importieren</button><button class="btn" id="tPlan"><svg><use href="#i-flag"/></svg>Neue Tour planen</button></div><button class="fab" id="tAdd" aria-label="Tour hinzufügen"><svg><use href="#i-plus"/></svg></button></div>`,
   after(P){$$("[data-s]",P).forEach(b=>b.onclick=()=>{tf.status=b.dataset.s;refreshPanel();});$$("[data-a]",P).forEach(b=>b.onclick=()=>{tf.art=b.dataset.a;refreshPanel();});
     const y=$("#tY",P);if(y)y.onchange=()=>{tf.year=y.value;refreshPanel();};$("#tAdd",P).onclick=e=>{e.stopPropagation();const m=$("#tAddM",P);m.hidden=!m.hidden;};$("#tImp",P).onclick=()=>$("#fGpx").click();$("#tPlan",P).onclick=()=>{closePanel();startPlan({});};
     $$(".li[data-id]",P).forEach(b=>b.onclick=()=>showTour(b.dataset.id));}};}

/* ---------- Tour anzeigen ---------- */
let profMk=null;function removeProfDot(){if(profMk){map.removeMarker(profMk);profMk=null;}}
async function showTour(id,replace){const t=S.tours.find(x=>x.id===id);if(!t)return;selTour=id;S._selLine=null;selPoint=null;refreshMarkers();setTourPhotoMarks(t);
  const line=await tourLine(id);S._selLine=line?(line.length>3000?simplify(line,1.5):line).map(p=>[p[0],p[1]]):null;map.render();
  const b=t.bbox;const pb=sheetPad();if(b){const s=map.project(b[2],b[1]),e=map.project(b[0],b[3]);if(s.x<0||s.y<0||e.x>map.w-sheetPadR()||e.y>map.h-pb||(e.x-s.x)<map.w*0.15)map.fitBounds(b,40,pb,sheetPadR());}
  const fn=()=>tourPanel(id);if(replace)replacePanel(fn,{half:true});else openPanel(fn,{half:true});}
function profFromLine(line){const out=[];let d=0;for(let i=0;i<line.length;i++){if(i)d+=distM(line[i-1][0],line[i-1][1],line[i][0],line[i][1]);if(line[i][2]!=null)out.push({d,h:line[i][2],lat:line[i][0],lon:line[i][1]});}
  if(out.length>600){const k=out.length/600;return out.filter((p,i)=>Math.floor(i%k)===0||i===out.length-1);}return out;}
async function tourPanel(id){const t=S.tours.find(x=>x.id===id);if(!t||t.del)return {title:"Tour",html:`<div class="empty">Nicht gefunden</div>`};
  const line=await tourLine(id);const prof=t.prof||(line?profFromLine(line):[]);const a=ARTS[t.art]||ARTS.wandern;const idea=t.status==="idee";
  const along=line?S.points.filter(p=>!p.del&&t.bbox&&p.lat>t.bbox[0]-0.002&&p.lat<t.bbox[2]+0.002&&p.lon>t.bbox[1]-0.003&&p.lon<t.bbox[3]+0.003).map(p=>{let bi=0,bd=Infinity;
      for(let i=0;i<line.length;i+=2){const d=distM(p.lat,p.lon,line[i][0],line[i][1]);if(d<bd){bd=d;bi=i;}}return {p,bd,bi};}).filter(x=>x.bd<=100).sort((x,y)=>x.bi-y.bi):[];
  const est=estFor(t);const hasRaw=!idea&&!!(await getOne("raw",id));const winter=/ski|winter/.test(t.art);
  const wtop=prof.length?prof.reduce((m,p)=>p.h>m.h?p:m,prof[0]):(t.bbox?{lat:(t.bbox[0]+t.bbox[2])/2,lon:(t.bbox[1]+t.bbox[3])/2,h:t.emax}:null);
  const wx=wtop?await weatherAt(wtop.lat,wtop.lon,wtop.h).catch(()=>null):null;const wd=wx&&wx.days.find(d=>d.date===today());
  return {title:t.name,icon:artIc(t.art),half:true,tools:wd&&wd.sy?`<button class="ib wxb" id="tWxTop" aria-label="Wetter heute: ${esc(wxText(wd.sy))}" title="Wetter heute: ${esc(wxText(wd.sy))} – antippen für Prognose und Bulletin">${wxIcon(wd.sy,28)}</button>`:"",html:`
   <div class="row" style="margin-bottom:8px"><span class="tag" style="background:${a.c};color:#fff">${a.n}</span><span class="tag">${idea?"Idee":fmtDate(t.date)}</span>${t.diff?`<span class="tag">${esc(t.diff)}</span>`:""}${t.fromIdea?`<span class="tag">aus Idee</span>`:""}</div>
   <div class="kv"><div><b>${fmtKm(t.dist)}</b><small>Distanz</small></div><div><b>${fmtN(t.up)} m</b><small>Aufstieg</small></div><div><b>${fmtN(t.down)} m</b><small>Abstieg</small></div>
    ${idea?`<div><b>≈ ${fmtDur(est)}</b><small>mit deinem Tempo</small></div>`:`<div><b>${fmtDur(t.moving)}</b><small>in Bewegung${t.total?` · gesamt ${fmtDur(t.total)}`:""}</small></div>`}
    ${t.emax!=null?`<div><b>${fmtN(t.emax)} m</b><small>höchster Punkt</small></div>`:""}${!idea&&t.moving?`<div><b>${fmtDur(est)}</b><small>Schätzung vorher</small></div>`:""}</div>
   ${t.diffAuto?diffHTML(t.diffAuto).replace("Schwierigkeit (Vorschlag)",/Skirouten/.test(t.diffAuto.src||"")?"Schwierigkeit laut Skirouten":"Schwierigkeit laut Wegen"):""}
   ${prof.length>1?`<div class="card" style="margin-top:10px;padding:8px"><canvas class="prof" id="tProf"></canvas><div class="muted small" id="tProfI">Antippen oder darüberfahren: Stelle auf der Karte</div></div>`:""}
   ${prof.length>2?steepHTML(slopeInfo(prof,t.prof?60:100)):""}
   ${prof.length>2?checkCard(tourCheckKey(t),!!(ARTS[t.art]||{}).ski):""}
   ${t.merged?`<p class="muted small">Aus ${t.merged} Tracks zusammengefasst.</p>`:""}
   ${!idea&&(t.removed||t.pauses)?`<p class="muted small">Bereinigt: ${t.pauses?t.pauses+" Pausen zusammengefasst":""}${t.removed&&t.pauses?", ":""}${t.removed?t.removed+" Ausreisser entfernt":""}.</p>`:""}
   <div class="card"><h3>Bewertung</h3><div class="crit"><span>Gesamt</span>${starsHTML((t.rate||{}).gesamt,"gesamt")}</div>${TOUR_CRIT.map(([k,n])=>`<div class="crit"><span>${n}</span>${starsHTML((t.rate||{})[k],k)}</div>`).join("")}
    ${t.note?`<p style="white-space:pre-wrap;margin:8px 0 0">${esc(t.note)}</p>`:""}</div>
   ${tourPhotoCard(t,idea)}
   ${along.length?`<div class="card"><h3>Am Weg</h3>${along.map(x=>`<button class="li" data-p="${x.p.id}">${catIc(x.p.cat)}<span class="t"><b>${esc(x.p.name)}</b><small>${x.p.hoehe?fmtN(x.p.hoehe)+" m · ":""}${CATS[x.p.cat].n}${(x.p.photos||[]).length?` · ${x.p.photos.length} Fotos`:""}</small></span></button>`).join("")}</div>`:""}
   <div class="btns">
    <button class="btn" id="tEd"><svg><use href="#i-edit"/></svg>Bearbeiten</button>
    ${idea?`<button class="btn pri" id="tRe"><svg><use href="#i-flag"/></svg>Route ändern</button>`:`<button class="btn" id="tAgain"><svg><use href="#i-flag"/></svg>Nochmals machen</button>`}
    <button class="btn" id="tGpx"><svg><use href="#i-down"/></svg>GPX</button>
    <button class="btn" id="tCond"><svg><use href="#i-${winter?"snow":"sun"}"/></svg>${winter?"Bulletin & Wetter":"Wetter"}</button>
    <button class="btn" id="tChk"><svg><use href="#i-check"/></svg>Checkliste</button>
    ${hasRaw?`<button class="btn" id="tRaw">Original-Track</button>`:""}
    ${t.status==="gemacht"&&t.src==="gpx"?`<button class="btn" id="tMrg"><svg><use href="#i-route"/></svg>Zusammenführen</button>`:""}
    <button class="btn red" id="tDel"><svg><use href="#i-trash"/></svg>Löschen</button></div>`,
   async after(P){bindDiff(P);P.addEventListener("stars",async e=>{const k=e.target.dataset.stars;t.rate=Object.assign({},t.rate||{});t.rate[k]=e.detail;await saveTour(t);});
     if(prof.length>1){const top=prof.reduce((m,p)=>p.h>m.h?p:m,prof[0]);const b=winter?await bulletinAt(top.lat,top.lon):null;const band=b&&b.critLow!=null?[b.critLow,b.critHigh]:null;
       const si=slopeInfo(prof,t.prof?60:100);bindSteep(P,prof,si);bindCheckCard(P,tourCheckKey(t),async()=>({prof,line:(await tourLine(t.id)||[]).map(p=>[p[0],p[1]]),winter:!!ARTS[t.art].ski}));drawProfile($("#tProf",P),prof,{band,slope:si,info:$("#tProfI",P),marks:tourPhotoMarks(t),onMark:i=>openTourPhoto(t,i)});}
     bindTourPhotoCard(P,t);
     $("#tEd",P).onclick=()=>openPanel(()=>editTourPanel(t));
     const re=$("#tRe",P);if(re)re.onclick=()=>{closePanel();startPlan({edit:t.id});};
     const ag=$("#tAgain",P);if(ag)ag.onclick=async()=>{const n={id:uid(),status:"idee",src:"copy",art:t.art,name:t.name,dist:t.dist,up:t.up,down:t.down,emin:t.emin,emax:t.emax,note:t.note,rate:{},diff:t.diff,
         plan:{art:t.art,wps:line?[[line[0][0],line[0][1]],[line[line.length-1][0],line[line.length-1][1]]].map(p=>({lat:p[0],lon:p[1],mode:"luft"})):[]}};
       await saveTour(n,line?line.map(p=>[p[0],p[1],p[2],null]):null);toast("Als Idee gespeichert");showTour(n.id,true);};
     $("#tGpx",P).onclick=async()=>{const L=await tourLine(t.id);if(!L)return toast("Linie fehlt (noch nicht abgeglichen?)");
       const wp=along.map(x=>({lat:x.p.lat,lon:x.p.lon,ele:x.p.hoehe,name:x.p.name}));download(`${fileSafe(t.name)}.gpx`,toGPX(t.name,L,wp),"application/gpx+xml");};
     $("#tCond",P).onclick=()=>{const top=prof.length?prof.reduce((m,p)=>p.h>m.h?p:m,prof[0]):null;const c=top||{lat:(t.bbox[0]+t.bbox[2])/2,lon:(t.bbox[1]+t.bbox[3])/2,h:t.emax};openPanel(()=>conditionsPanel(c.lat,c.lon,c.h,t.name,{noBul:!!(ARTS[t.art]||{}).bike}));};if($("#tWxTop",P))$("#tWxTop",P).onclick=$("#tCond",P).onclick;
     $("#tChk",P).onclick=()=>openPanel(()=>checklistPanel(t.art));
     const rw=$("#tRaw",P);if(rw)rw.onclick=async()=>{const r=await getOne("raw",t.id);const g=parseGPX(r.gpx);S._selLine=g.pts.map(p=>[p[0],p[1]]);map.render();
       const st=trackStats(g.pts,g.pts.some(p=>p[3]));toast(`Original: ${fmtKm(st.dist)}, ↑${fmtN(st.up)} m, ${fmtDur(st.moving)} in Bewegung`,5000);};
     const mg=$("#tMrg",P);if(mg)mg.onclick=()=>openPanel(()=>mergePanel(t));
     $("#tDel",P).onclick=async()=>{if(!confirm(`Tour «${t.name}» löschen?`))return;t.del=Date.now();await saveTour(t);selTour=null;closePanel();toast("Gelöscht");};
     $$("[data-p]",P).forEach(b=>b.onclick=()=>showPoint(b.dataset.p));}};}
function editTourPanel(t){const sc=SCALES[t.art]||[];return {title:"Tour bearbeiten",html:`<div class="card">
   <label class="f">Name</label><input class="inp" id="eN" value="${esc(t.name)}"><label class="f">Art</label><select class="inp" id="eA">${artOpts(t.art)}</select>
   <label class="f">Status</label><select class="inp" id="eS"><option value="gemacht"${t.status==="gemacht"?" selected":""}>Gemacht</option><option value="idee"${t.status==="idee"?" selected":""}>Idee</option></select>
   <label class="f">Datum</label><input type="date" class="inp" id="eD" value="${esc(t.date||"")}">
   <label class="f">Schwierigkeit</label><select class="inp" id="eF"><option value="">–</option>${Object.values(SCALES).flat().filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option${v===t.diff?" selected":""}>${v}</option>`).join("")}</select>
   <label class="f">Notiz</label><textarea class="inp" id="eT">${esc(t.note||"")}</textarea></div><button class="btn pri full" id="eOk"><svg><use href="#i-check"/></svg>Speichern</button>${t.status==="idee"?`<button class="btn full" id="eRe" style="margin-top:8px"><svg><use href="#i-flag"/></svg>Route ändern (Punkte auf der Karte)</button>`:""}`,
   after(P){const fill=()=>{const s=SCALES[$("#eA",P).value]||[];const cur=$("#eF",P).value;$("#eF",P).innerHTML=`<option value="">–</option>`+s.map(v=>`<option${v===cur?" selected":""}>${v}</option>`).join("");};fill();$("#eA",P).onchange=fill;
     const er=$("#eRe",P);if(er)er.onclick=()=>{closePanel();startPlan({edit:t.id});};
     $("#eOk",P).onclick=async()=>{t.name=$("#eN",P).value.trim()||t.name;t.art=$("#eA",P).value;t.status=$("#eS",P).value;t.date=$("#eD",P).value||t.date;if($("#eF",P).value!==t.diff)t.diffWasAuto=false;t.diff=$("#eF",P).value;t.note=$("#eT",P).value.trim();
       await saveTour(t);panelBack();};}};}
const fileSafe=s=>String(s||"tour").replace(/[^\wäöüÄÖÜéèàç\- ]+/g,"").trim().replace(/\s+/g,"_").slice(0,60)||"tour";
function download(name,data,type){const b=data instanceof Blob?data:new Blob([data],{type:type||"application/octet-stream"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000);}

/* ---------- Höhenprofil ---------- */
function drawProfile(cv,prof,o){o=o||{};if(!cv||prof.length<2)return;const dpr=Math.min(2,devicePixelRatio||1);const W=cv.clientWidth||300,H=cv.clientHeight||150;cv.width=W*dpr;cv.height=H*dpr;
  const c=cv.getContext("2d");c.scale(dpr,dpr);const L=40,R=8,T=10,B=20;const D=prof[prof.length-1].d||1;let hmin=Infinity,hmax=-Infinity;for(const p of prof){if(p.h<hmin)hmin=p.h;if(p.h>hmax)hmax=p.h;}
  const pad=Math.max(20,(hmax-hmin)*0.1);hmin=Math.floor((hmin-pad)/50)*50;hmax=Math.ceil((hmax+pad)/50)*50;const X=d=>L+(W-L-R)*d/D,Y=h=>T+(H-T-B)*(1-(h-hmin)/(hmax-hmin));
  const draw=sel=>{c.clearRect(0,0,W,H);c.font="10px system-ui";c.fillStyle="#62707d";c.strokeStyle="#dde3e8";c.lineWidth=1;
    const st=[50,100,200,250,500,1000].find(s=>(hmax-hmin)/s<=5)||1000;for(let h=Math.ceil(hmin/st)*st;h<=hmax;h+=st){c.beginPath();c.moveTo(L,Y(h));c.lineTo(W-R,Y(h));c.stroke();c.fillText(fmtN(h),2,Y(h)+3);}
    const ks=[1,2,5,10,20,50].find(s=>D/1000/s<=6)||50;for(let k=0;k<=D/1000;k+=ks){c.fillText(k+" km",X(k*1000)-6,H-5);}
    if(o.band){const y1=Y(Math.min(hmax,o.band[1]||hmax)),y0=Y(Math.max(hmin,o.band[0]));if(y0>T){c.fillStyle="rgba(255,152,0,.18)";c.fillRect(L,y1,W-L-R,y0-y1);c.fillStyle="#b26a00";c.fillText("kritisch laut Bulletin",L+4,y1+11);}}
    c.beginPath();c.moveTo(X(0),Y(hmin));for(const p of prof)c.lineTo(X(p.d),Y(p.h));c.lineTo(X(D),Y(hmin));c.closePath();c.fillStyle="rgba(127,179,213,.45)";c.fill();
    if(o.slope){c.lineWidth=3;c.lineCap="round";for(let i=1;i<prof.length;i++){c.beginPath();c.moveTo(X(prof[i-1].d),Y(prof[i-1].h));c.lineTo(X(prof[i].d),Y(prof[i].h));c.strokeStyle=o.slope.seg[i]?SLOPE_CL[o.slope.seg[i]].c:"#1f3a52";c.stroke();}c.lineCap="butt";}
    else{c.beginPath();prof.forEach((p,i)=>i?c.lineTo(X(p.d),Y(p.h)):c.moveTo(X(p.d),Y(p.h)));c.strokeStyle="#1f3a52";c.lineWidth=2;c.stroke();}
    for(const m of o.marks||[]){if(m.d==null)continue;const x=X(m.d),y=Y(m.h!=null?m.h:hmin);c.beginPath();c.arc(x,y,5,0,7);c.fillStyle="#13263a";c.fill();c.lineWidth=2;c.strokeStyle="#fff";c.stroke();}
    if(sel){c.strokeStyle="#c8102e";c.lineWidth=1.5;c.beginPath();c.moveTo(X(sel.d),T);c.lineTo(X(sel.d),H-B);c.stroke();c.beginPath();c.arc(X(sel.d),Y(sel.h),4,0,7);c.fillStyle="#c8102e";c.fill();}};
  draw();const pick=e=>{const r=cv.getBoundingClientRect();const d=Math.max(0,Math.min(D,(e.clientX-r.left-L)/(W-L-R)*D));let b=prof[0];for(const p of prof)if(Math.abs(p.d-d)<Math.abs(b.d-d))b=p;
    draw(b);const bi=prof.indexOf(b);if(o.info)o.info.textContent=`${fmtKm(b.d)} · ${fmtN(b.h)} m ü. M.${o.slope?` · ${fmtN(Math.round(o.slope.deg[bi]))}°`:""}`;if(b.lat!=null){if(!profMk)profMk=map.addMarker({lat:b.lat,lon:b.lon,anchor:[7,7],html:`<div class="prof-dot"></div>`,z:60});else map.moveMarker(profMk,b.lat,b.lon);}};
  if(o.marks&&o.marks.length&&o.onMark)cv.onclick=e=>{const r=cv.getBoundingClientRect(),x=e.clientX-r.left;let bi=-1,bd=12;o.marks.forEach((m,i)=>{if(m.d==null)return;const dx=Math.abs(X(m.d)-x);if(dx<bd){bd=dx;bi=i;}});if(bi>=0)o.onMark(bi);};
  cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);pick(e);};
  cv.onpointerup=()=>{if(!profMk)return;const p=profMk;const bb=map.getBounds();if(p.lat<bb[0]||p.lat>bb[2]||p.lon<bb[1]||p.lon>bb[3])map.setView(p.lat,p.lon,Math.max(map.zoom,14));};cv.onpointermove=e=>{if(e.pointerType==="mouse"||e.buttons)pick(e);};}

/* ---------- Planung wie bei SchweizMobil: antippen, Linie folgt dem Weg, Höhenprofil und Zeit laufend ---------- */
let planState=null;const routeCache=new Map();
function planEntry(){if(planState){openPanel(planPanel,{half:true});return;}startPlan({});}
async function startPlan(o){if(placing)endPlace();closePanel();selTour=null;
  const art=o.art||ls("planArt")||"wandern";planState={art,mode:defMode(art),wps:[],segs:[],editId:null,prof:null,busy:0,undo:[]};
  if(o.edit){const t=S.tours.find(x=>x.id===o.edit);if(t){planState.editId=t.id;planState.art=t.art;planState.name=t.name;
      if(t.plan&&t.plan.wps&&t.plan.wps.length){planState.wps=t.plan.wps.map(w=>Object.assign({},w));}
      else if(t.disp){const L=t.disp;planState.wps=[{lat:L[0][0],lon:L[0][1],mode:"luft"},{lat:L[L.length-1][0],lon:L[L.length-1][1],mode:"luft"}];}
      const line=await tourLine(t.id);if(line&&t.plan&&t.plan.segs)planState.segs=t.plan.segs;}}
  if(o.start)planState.wps.push({lat:o.start[0],lon:o.start[1],mode:planState.mode,pid:o.pid});
  if(o.end)planState.wps.push({lat:o.end[0],lon:o.end[1],mode:planState.mode});
  $$("#bar button").forEach(x=>x.classList.toggle("on",x.dataset.go==="plan"));
  planBar();miscDraw.push(drawPlan);await planRoute();openPanel(planPanel,{half:true});
  if(!planState.wps.length)toast("Startpunkt auf der Karte antippen",3500);}
const defMode=art=>ARTS[art].ski?"ski":ARTS[art].prof?"weg":"luft";
const MODE_N={ski:"Skiroute",weg:"am Weg",luft:"Luftlinie"};
const artModes=art=>ARTS[art].ski?["ski","weg","luft"]:ARTS[art].prof?["weg","luft"]:["luft"];
/* Art wechseln: Abschnitte passend umstellen (Skitour = Skirouten, Sommer = Wege) */
async function setPlanArt(art){const ps=planState;if(!ps||!ARTS[art])return;ps.art=art;ls("planArt",art);const dm=defMode(art);
  if(ps.mode!=="luft"||!ps.wps.length)ps.mode=dm;for(const w of ps.wps)if(w.mode!=="luft")w.mode=dm;ps.segs=[];planBar();await planRoute();refreshPlanPanel();}
/* Alles zur Planung steht im Planungsfenster; die Leiste oben wird nicht mehr gebraucht */
function planBar(){modebar(null);refreshPlanPanel();}
function planQuit(){const ps=planState;if(!ps)return closePanel();if(ps.undo.length&&ps.wps.length>1&&!confirm(ps.editId?"Änderungen an der Route verwerfen?":"Planung beenden ohne zu speichern?"))return;endPlan();}
function endPlan(){if(!planState)return;closeWpMenu();clearTemp();clearWpMarkers();for(const w of planState.wps)if(w.mk)map.removeMarker(w.mk);miscDraw=miscDraw.filter(f=>f!==drawPlan);planState=null;modebar(null);closePanel();map.render();removeProfDot();}
const snap=()=>planState.undo.push(planState.wps.map(w=>({lat:w.lat,lon:w.lon,mode:w.mode,pid:w.pid})));
async function planClick(e){if(wpm){closeWpMenu();return;}const ps=planState;if(!ps||ps.busy>3)return;
  /* auf die Linie getippt → Zwischenpunkt einfügen */
  if(!e.pid&&ps.wps.length>1&&e.x!=null){let best=null;for(let i=0;i<ps.segs.length;i++){const L=ps.segs[i]||[];for(let k=1;k<L.length;k++){const a=map.project(L[k-1][0],L[k-1][1]),b=map.project(L[k][0],L[k][1]);const d=segPx(e.x,e.y,a,b);if(d<12&&(!best||d<best.d))best={i,d};}}
    if(best){snap();ps.wps.splice(best.i+1,0,{lat:e.lat,lon:e.lon,mode:ps.wps[best.i+1].mode});ps.segs.splice(best.i,1,null,null);await planRoute();refreshPlanPanel();return;}}
  snap();ps.wps.push({lat:e.lat,lon:e.lon,mode:ps.mode,pid:e.pid});await planRoute();refreshPlanPanel();}
/* Alle Wegpunkt-Marker zentral führen: so bleiben nach Rückgängig/Abbruch keine losen Punkte auf der Karte */
const wpMks=new Set();function clearWpMarkers(){for(const m of wpMks)map.removeMarker(m);wpMks.clear();if(planState)for(const w of planState.wps)w.mk=null;}
function planMarkers(){const ps=planState;clearWpMarkers();
  ps.wps.forEach((w,i)=>{const last=i===ps.wps.length-1&&i>0;const m=map.addMarker({lat:w.lat,lon:w.lon,anchor:[11,11],drag:true,z:70,html:`<div class="wp${i===0?" s":last?" e":""}">${i===0?"S":last?"Z":i}</div>`});m.wp=w;w.mk=m;wpMks.add(m);
    m.onClick=()=>wpMenu(w);});}
async function planUndo(){const ps=planState;if(!ps)return;closeWpMenu();const u=ps.undo.pop();if(!u)return toast("Nichts mehr rückgängig zu machen");for(const w of ps.wps)if(w.mk){map.removeMarker(w.mk);w.mk=null;}ps.wps=u;ps.segs=[];await planRoute();refreshPlanPanel();}
async function planRemoveWp(w){const ps=planState;if(!ps)return;const i=ps.wps.indexOf(w);if(i<0)return;snap();if(w.mk)map.removeMarker(w.mk);ps.wps.splice(i,1);ps.segs=[];await planRoute();refreshPlanPanel();}
document.addEventListener("keydown",e=>{if(planState&&(e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==="z"&&!e.target.closest("input,textarea,select")){e.preventDefault();planUndo();}});
/* Kleines Menü beim Antippen eines Wegpunkts */
let wpm=null;function closeWpMenu(){if(wpm){map.off("move",wpm._u);wpm.remove();wpm=null;}}
function wpMenu(w){closeWpMenu();const ps=planState;if(!ps)return;const i=ps.wps.indexOf(w);if(i<0)return;const modes=artModes(ps.art);
  const lbl=i===0?"Start":i===ps.wps.length-1?"Ziel":"Punkt "+i;
  const seg=i>0&&modes.length>1?`<small>Abschnitt davor:</small>${modes.filter(m=>m!==w.mode).map(m=>`<button data-wm="mode" data-m="${m}">${MODE_N[m]}</button>`).join("")}`:"";
  wpm=document.createElement("div");wpm.className="wpmenu bm-ui";wpm.innerHTML=`<b>${lbl}</b><button data-wm="del"><svg><use href="#i-trash"/></svg>Entfernen</button>${seg}<button data-wm="x">Schliessen</button><small>Verschieben: Punkt ziehen</small>`;
  $("#map").appendChild(wpm);const u=()=>{if(!wpm)return;const p=map.project(w.lat,w.lon);const H=wpm.offsetHeight,W=wpm.offsetWidth,bot=map.h-sheetPad()-8,top=64;
    let y=p.y-H-18;if(y<top)y=p.y+18;if(y+H>bot)y=Math.max(top,bot-H);
    wpm.style.left=Math.max(8,Math.min(map.w-sheetPadR()-W-8,p.x-W/2))+"px";wpm.style.top=y+"px";};wpm._u=u;map.on("move",u);u();
  wpm.onclick=async e=>{const b=e.target.closest("[data-wm]");if(!b)return;const k=b.dataset.wm;closeWpMenu();
    if(k==="del")await planRemoveWp(w);else if(k==="mode"){snap();w.mode=b.dataset.m;ps.segs[i-1]=null;await planRoute();refreshPlanPanel();}};}
function routeKey(a,b,prof){return `${prof}|${a.lat.toFixed(5)},${a.lon.toFixed(5)}|${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;}
async function routeSeg(a,b,mode,art){const prof=ARTS[art].prof||ARTS[art].wprof;
  /* Skiroute; wo keine verläuft (z. B. Zustieg auf Strasse oder Weg): den Wegen folgen, erst dann Luftlinie */
  if(mode==="ski"&&ARTS[art].ski){const k="ski|"+routeKey(a,b,"");if(routeCache.has(k))return routeCache.get(k);
    try{const L=await skiRoute(a,b);routeCache.set(k,L);return L;}catch(e){if(e.message!=="keine Skiroute"||!prof)throw e;const L=await routeSeg(a,b,"weg",art);L._via="weg";return L;}}
  if(mode==="luft"||!prof)return [[a.lat,a.lon,null],[b.lat,b.lon,null]];const k=routeKey(a,b,prof);if(routeCache.has(k))return routeCache.get(k);
  if(!navigator.onLine)throw new Error("offline");const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),30000);
  try{const r=await fetch(`https://brouter.de/brouter?lonlats=${a.lon.toFixed(6)},${a.lat.toFixed(6)}|${b.lon.toFixed(6)},${b.lat.toFixed(6)}&profile=${prof}&alternativeidx=0&format=geojson`,{signal:ctl.signal});
    const tx=await r.text();if(!r.ok)throw new Error(tx.slice(0,120));const g=JSON.parse(tx);const c=g.features[0].geometry.coordinates;const L=c.map(p=>[p[1],p[0],p[2]!=null?p[2]:null]);
    L[0]=[a.lat,a.lon,L[0][2]];L[L.length-1]=[b.lat,b.lon,L[L.length-1][2]];L._tags=wayTags(g.features[0].properties);routeCache.set(k,L);return L;}finally{clearTimeout(tm);}}
/* Schwierigkeit aus OpenStreetMap (über BRouter): sac_scale → T1–T6, mtb:scale → S0–S5 */
const SAC={hiking:"T1",mountain_hiking:"T2",demanding_mountain_hiking:"T3",alpine_hiking:"T4",demanding_alpine_hiking:"T5",difficult_alpine_hiking:"T6"};
/* ---------- Skitouren: auf den swisstopo-Skirouten einrasten (Vektordaten, Kacheln 10 km, im Gerät gespeichert) ---------- */
const SKI_T=10000,SKI_SNAP=400,SKI_AGE=180*864e5,skiMem=new Map();
const SKI_ORDER=["L","WS-","WS","WS+","ZS-","ZS","ZS+","S-","S","S+","SS-","SS","SS+","AS-","AS","AS+","EX"];
function skiUrl(b){return `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryEnvelope&geometry=${b.map(Math.round).join(",")}&imageDisplay=500,500,96&mapExtent=${b.map(Math.round).join(",")}&layers=all:ch.swisstopo-karto.skitouren&tolerance=0&sr=2056&returnGeometry=true&geometryFormat=geojson&limit=200&lang=de`;}
async function skiFetchBox(b,lvl){const res=await fetch(skiUrl(b));if(!res.ok)throw new Error("Skirouten: Fehler "+res.status);const j=await res.json();const L=j.results||[];
  if(L.length>=200&&lvl<3){const mx=(b[0]+b[2])/2,my=(b[1]+b[3])/2;const parts=await Promise.all([[b[0],b[1],mx,my],[mx,b[1],b[2],my],[b[0],my,mx,b[3]],[mx,my,b[2],b[3]]].map(x=>skiFetchBox(x,lvl+1)));return parts.flat();}
  return L.map(f=>{const g=f.geometry||{},p=f.properties||f.attributes||{};const parts=g.type==="LineString"?[g.coordinates]:g.type==="MultiLineString"?g.coordinates:[];
    return {id:String(f.featureId||f.id),v:p.difficulty_de||"",n:p.name_de||p.name||"",z:p.target_name||"",c:parts.map(l=>{const a=[];for(const q of l)a.push(Math.round(q[0]-2e6),Math.round(q[1]-1e6));return a;})};});}
async function skiTile(tx,ty,force){const k=`ski_${tx}_${ty}`;if(!force&&skiMem.has(k))return skiMem.get(k);
  let v=force?null:await metaGet(k,null);
  if(!v||(navigator.onLine&&Date.now()-v.t>SKI_AGE)){if(!navigator.onLine){if(v){skiMem.set(k,v.f);return v.f;}return null;}
    try{const f=await skiFetchBox([tx*SKI_T,ty*SKI_T,(tx+1)*SKI_T,(ty+1)*SKI_T],0);v={t:Date.now(),f};await metaSet(k,v);}catch(e){if(!v)throw e;}}
  skiMem.set(k,v.f);if(skiMem.size>60)skiMem.delete(skiMem.keys().next().value);return v.f;}
function skiTilesFor(E0,N0,E1,N1){const o=[];for(let x=Math.floor(Math.min(E0,E1)/SKI_T);x<=Math.floor(Math.max(E0,E1)/SKI_T);x++)for(let y=Math.floor(Math.min(N0,N1)/SKI_T);y<=Math.floor(Math.max(N0,N1)/SKI_T);y++)o.push([x,y]);return o;}
/* Für Offline-Regionen: Skirouten im Gebiet vorab speichern */
async function skiPrefetch(bbox){const [E0,N0]=toLV95(bbox[0],bbox[1]),[E1,N1]=toLV95(bbox[2],bbox[3]);let n=0;for(const [x,y] of skiTilesFor(E0,N0,E1,N1)){try{if(await skiTile(x,y))n++;}catch(e){}}return n;}
function skiGraph(feats){const idx=new Map(),X=[],Y=[],adj=[];const seen=new Set();const F=[];
  const node=(x,y)=>{const k=x*4e6+y;let i=idx.get(k);if(i==null){i=X.length;idx.set(k,i);X.push(x);Y.push(y);adj.push([]);}return i;};
  for(const f of feats){if(seen.has(f.id))continue;seen.add(f.id);const fi=F.length;F.push(f);
    for(const a of f.c){let prev=-1;for(let i=0;i<a.length;i+=2){const n=node(a[i],a[i+1]);if(prev>=0&&prev!==n){const w=Math.hypot(X[n]-X[prev],Y[n]-Y[prev]);adj[prev].push(n,w,fi);adj[n].push(prev,w,fi);}prev=n;}}}
  return {X,Y,adj,F};}
function skiNearest(G,x,y){let bi=-1,bd=Infinity;for(let i=0;i<G.X.length;i++){const d=Math.hypot(G.X[i]-x,G.Y[i]-y);if(d<bd){bd=d;bi=i;}}return bd<=SKI_SNAP?{i:bi,d:bd}:null;}
function skiPath(G,s,t){const n=G.X.length,dist=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),pf=new Int32Array(n).fill(-1);dist[s]=0;
  const h=[[0,s]];const push=e=>{h.push(e);let i=h.length-1;while(i){const p=(i-1)>>1;if(h[p][0]<=h[i][0])break;[h[p],h[i]]=[h[i],h[p]];i=p;}};
  const pop=()=>{const top=h[0],last=h.pop();if(h.length){h[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<h.length&&h[l][0]<h[m][0])m=l;if(r<h.length&&h[r][0]<h[m][0])m=r;if(m===i)break;[h[m],h[i]]=[h[i],h[m]];i=m;}}return top;};
  while(h.length){const [d,u]=pop();if(d>dist[u])continue;if(u===t)break;const a=G.adj[u];for(let k=0;k<a.length;k+=3){const v=a[k],nd=d+a[k+1];if(nd<dist[v]){dist[v]=nd;prev[v]=u;pf[v]=a[k+2];push([nd,v]);}}}
  if(dist[t]===Infinity)return null;const path=[],fs=[];for(let v=t;v>=0;v=prev[v]){path.push(v);fs.push(pf[v]);}path.reverse();fs.reverse();return {path,fs,len:dist[t]};}
async function skiRoute(a,b){const [Ea,Na]=toLV95(a.lat,a.lon),[Eb,Nb]=toLV95(b.lat,b.lon);const m=3000;
  const tiles=skiTilesFor(Math.min(Ea,Eb)-m,Math.min(Na,Nb)-m,Math.max(Ea,Eb)+m,Math.max(Na,Nb)+m);if(tiles.length>16)throw new Error("Abschnitt zu lang");
  const feats=[];for(const [x,y] of tiles){const f=await skiTile(x,y);if(!f)throw new Error("offline");feats.push(...f);}
  const G=skiGraph(feats);const xa=Ea-2e6,ya=Na-1e6,xb=Eb-2e6,yb=Nb-1e6;const sa=skiNearest(G,xa,ya),sb=skiNearest(G,xb,yb);if(!sa||!sb)throw new Error("keine Skiroute");
  const r=skiPath(G,sa.i,sb.i);if(!r)throw new Error("keine Skiroute");const direct=Math.hypot(xb-xa,yb-ya);if(r.len>direct*2.5+600)throw new Error("keine Skiroute");
  const L=[[a.lat,a.lon,null]],tags=[];let px=xa,py=ya;
  /* Gemeinsame Abschnitte mehrerer Routen: die leichteste Route zählt (z. B. Hüttenweg statt Gipfelroute) */
  const rk=v=>{const i=SKI_ORDER.indexOf(v);return i<0?99:i;};const best=(u,v)=>{const A=G.adj[u];let bf=null;for(let k=0;k<A.length;k+=3)if(A[k]===v){const f=G.F[A[k+2]];if(!bf||rk(f.v)<rk(bf.v))bf=f;}return bf;};
  r.path.forEach((n,k)=>{const ll=fromLV95(G.X[n]+2e6,G.Y[n]+1e6);const d=Math.hypot(G.X[n]-px,G.Y[n]-py);px=G.X[n];py=G.Y[n];L.push([ll[0],ll[1],null]);
    const f=k?best(r.path[k-1],n):null;if(f&&d>0)tags.push({lat:ll[0],lon:ll[1],d,ski:f.v||null,name:f.n,goal:f.z});});
  L.push([b.lat,b.lon,null]);L._tags=tags;L._skiOff=Math.round(sa.d+sb.d);return L;}
function wayTags(pr){const m=pr&&pr.messages;if(!m||m.length<2)return null;const h=m[0];const iLo=h.indexOf("Longitude"),iLa=h.indexOf("Latitude"),iD=h.indexOf("Distance"),iW=h.indexOf("WayTags");if(iW<0||iD<0)return null;
  return m.slice(1).map(r=>{const w=String(r[iW]||"");const s=(w.match(/(?:^| )sac_scale=([\w]+)/)||[])[1];const mt=(w.match(/(?:^| )mtb:scale=(\d)/)||[])[1];
    return {lat:+r[iLa]/1e6,lon:+r[iLo]/1e6,d:+r[iD]||0,sac:SAC[s]||null,mtb:mt!=null?"S"+Math.min(5,+mt):null};});}
/* Auswertung einer Route: km pro Stufe, schwierigste Stufe und Stelle, Abdeckung */
function routeDifficulty(segs,art){const ski=!!ARTS[art]&&!!ARTS[art].ski,bike=/bike|gravel/.test(art);const key=ski?"ski":bike?"mtb":"sac";const order=ski?SKI_ORDER:bike?["S0","S1","S2","S3","S4","S5"]:["T1","T2","T3","T4","T5","T6"];const names=new Set();
  const km={};let tot=0,cov=0,top=null;
  for(const L of segs){if(!L)continue;if(!L._tags){for(let i=1;i<L.length;i++)tot+=distM(L[i-1][0],L[i-1][1],L[i][0],L[i][1]);continue;}
    for(const t of L._tags){tot+=t.d;const v=t[key];if(!v)continue;cov+=t.d;km[v]=(km[v]||0)+t.d;if(t.name)names.add(t.goal?`${t.goal} (${t.name})`:t.name);if(!top||order.indexOf(v)>order.indexOf(top.v))top={v,lat:t.lat,lon:t.lon};}}
  if(!top)return null;return {lvl:top.v,lat:top.lat,lon:top.lon,km:order.filter(o=>km[o]).map(o=>[o,Math.round(km[o])]),cov:tot?Math.round(cov/tot*100):0,scale:ski?"SAC-Skitouren":bike?"MTB":"SAC",src:ski?"swisstopo-Skirouten":"OpenStreetMap",names:[...names].slice(0,4)};}
/* Steilheit entlang der Linie (aus dem Höhenprofil, Fenster ca. 60 m, bei GPX 100 m) */
const SLOPE_CL=[{m:15,c:"#9aa5ae",n:"unter 15°"},{m:25,c:"#e3c13b",n:"15–25°"},{m:30,c:"#ef8a2e",n:"25–30°"},{m:35,c:"#d7263d",n:"30–35°"},{m:99,c:"#8e44ad",n:"über 35°"}];
const slopeCl=deg=>SLOPE_CL.findIndex(k=>deg<k.m);
function slopeInfo(prof,win){win=win||60;if(!prof||prof.length<3)return null;const n=prof.length,deg=new Float32Array(n);let a=0,b=0;
  for(let i=0;i<n;i++){while(prof[a].d<prof[i].d-win/2)a++;while(b<n-1&&prof[b+1].d<=prof[i].d+win/2)b++;let i0=a,i1=Math.max(b,Math.min(n-1,a+1));if(i1===i0)i0=Math.max(0,i0-1);
    const dd=prof[i1].d-prof[i0].d;deg[i]=dd>0?Math.atan(Math.abs(prof[i1].h-prof[i0].h)/dd)*180/Math.PI:0;}
  const km=SLOPE_CL.map(()=>0),seg=new Int8Array(n);let mx=0;
  for(let i=1;i<n;i++){const k=slopeCl((deg[i-1]+deg[i])/2);seg[i]=k;km[k]+=prof[i].d-prof[i-1].d;if(deg[i]>mx)mx=deg[i];}
  return {deg,seg,km,max:mx};}
function steepHTML(si){if(!si)return "";const tot=si.km.reduce((a,b)=>a+b,0)||1;const steep=si.km[3]+si.km[4];
  return `<div class="card"><h3>Steilheit</h3><div class="slbar">${SLOPE_CL.map((k,i)=>si.km[i]>0?`<i style="width:${si.km[i]/tot*100}%;background:${k.c}"></i>`:"").join("")}</div>
   <div class="slleg">${SLOPE_CL.map((k,i)=>si.km[i]>=50?`<span><b style="background:${k.c}"></b>${k.n}: ${fmtN(si.km[i]/1000,1)} km</span>`:"").join("")}</div>
   <div class="row" style="margin-top:6px"><span class="grow muted small">Steilheit entlang der Linie (Farben auch im Höhenprofil). Bei Spitzkehren ist das Gelände daneben steiler – massgebend bleibt die Ebene «Hangneigung über 30°».</span>
   ${steep>=20?`<button class="btn sm" data-steepmap>${S._steep?"Ausblenden":"Abschnitte ab 30° zeigen"}</button>`:""}</div></div>`;}
/* Abschnitte ab 30° auf der Karte markieren */
function steepRuns(prof,si){const runs=[];let cur=null;for(let i=1;i<prof.length;i++){if(si.seg[i]>=3&&prof[i].lat!=null){if(!cur){cur={c:SLOPE_CL[si.seg[i]].c,pts:[[prof[i-1].lat,prof[i-1].lon]]};runs.push(cur);}cur.pts.push([prof[i].lat,prof[i].lon]);if(si.seg[i]===4)cur.c=SLOPE_CL[4].c;}else cur=null;}return runs;}
function bindSteep(P,prof,si){const b=$("[data-steepmap]",P);if(!b)return;b.onclick=()=>{if(S._steep){S._steep=null;b.textContent="Abschnitte ab 30° zeigen";}else{S._steep=steepRuns(prof,si);b.textContent="Ausblenden";
    const all=S._steep.flatMap(r=>r.pts);if(all.length)map.fitBounds(bboxOf(all),60,sheetPad(),sheetPadR());}map.render();};}
function diffHTML(d){if(!d)return "";return `<div class="card"><h3>Schwierigkeit (Vorschlag)</h3><div class="row"><span class="tag" style="font-size:15px">${esc(d.lvl)}</span><span class="grow muted small">${/Skirouten/.test(d.src||"")?"laut":"schwierigster Abschnitt laut"} ${d.src||"OpenStreetMap"} (${d.scale}-Skala) · Angaben für ${d.cov} % der Strecke</span>
   ${d.lat!=null&&!/Skirouten/.test(d.src||"")?`<button class="btn sm" data-diffshow="${d.lat},${d.lon}">Stelle zeigen</button>`:""}</div>${/Skirouten/.test(d.src||"")?`<div class="muted small" style="margin-top:4px">swisstopo gibt die Schwierigkeit für die ganze Route an, nicht für einzelne Stellen.</div>`:""}
   <div class="small" style="margin-top:6px">${d.km.map(([k,m])=>`${k}: ${fmtN(m/1000,1)} km`).join(" · ")}</div>${d.names&&d.names.length?`<div class="muted small" style="margin-top:4px">Skirouten: ${d.names.map(esc).join(" · ")}</div>`:""}</div>`;}
function bindDiff(P){$$("[data-diffshow]",P).forEach(b=>b.onclick=()=>{const [la,lo]=b.dataset.diffshow.split(",").map(Number);setTemp(la,lo);map.flyTo(la,lo,Math.max(map.z,15));});}
async function planRoute(){const ps=planState;if(!ps)return;ps.busy++;planMarkers();map.render();
  try{const n=ps.wps.length;const segs=[];let fail=0,via=0;
    for(let i=1;i<n;i++){const a=ps.wps[i-1],b=ps.wps[i];const old=ps.segs[i-1];
      if(old&&old.length>1&&Math.abs(old[0][0]-a.lat)<1e-7&&Math.abs(old[old.length-1][0]-b.lat)<1e-7&&Math.abs(old[0][1]-a.lon)<1e-7&&Math.abs(old[old.length-1][1]-b.lon)<1e-7&&old._m===b.mode&&!old._fb){segs.push(old);continue;}
      let L;try{L=await routeSeg(a,b,b.mode,ps.art);}catch(e){fail++;L=[[a.lat,a.lon,null],[b.lat,b.lon,null]];L._fb=1;}if(L._via)via++;L._m=b.mode;segs.push(L);}
    if(planState!==ps)return;ps.segs=segs;if(via&&!fail)toast("Keine Skiroute – Abschnitt folgt dem Weg",2500);
    if(fail)toast(navigator.onLine?(ARTS[ps.art].ski&&segs.some(x=>x._m==="ski"&&x._fb)?"Hier weder Skiroute noch Weg – Abschnitt als Luftlinie":"Für einen Abschnitt kein Weg gefunden – Luftlinie"):"Offline: Abschnitte als Luftlinie",3500);
    planStats();map.render();clearTimeout(ps.pt);ps.pt=setTimeout(()=>planProfile(),600);}
  finally{ps.busy--;}}
function planLine(){const ps=planState;const out=[];ps.segs.forEach((s,i)=>{(s||[]).forEach((p,k)=>{if(i&&!k)return;out.push(p);});});return out;}
function planStats(){const ps=planState;const L=planLine();let d=0;for(let i=1;i<L.length;i++)d+=distM(L[i-1][0],L[i-1][1],L[i][0],L[i][1]);ps.dist=d;
  /* Höhen: zuerst aus der Wegführung (BRouter), genauer danach aus swissALTI3D */
  if(!ps.prof||ps.profFor!==L.length+":"+d.toFixed(0)){let up=0,dn=0,ref=null,ok=L.filter(p=>p[2]!=null).length>L.length*0.8;
    if(ok)for(const p of L){if(p[2]==null)continue;if(ref==null)ref=p[2];else if(p[2]-ref>=5){up+=p[2]-ref;ref=p[2];}else if(ref-p[2]>=5){dn+=ref-p[2];ref=p[2];}}
    ps.up=ok?Math.round(up):null;ps.down=ok?Math.round(dn):null;ps.prof=null;}}
async function planProfile(){const ps=planState;if(!ps)return;const L=planLine();if(L.length<2){refreshPlanPanel();return;}const key=L.length+":"+ps.dist.toFixed(0);
  if(!navigator.onLine){refreshPlanPanel();return;}
  try{const prof=await profileOf(L,Math.min(400,Math.max(60,Math.round(ps.dist/40))));if(planState!==ps)return;let up=0,dn=0,ref=null;
    for(const p of prof){if(ref==null)ref=p.h;else if(p.h-ref>=3){up+=p.h-ref;ref=p.h;}else if(ref-p.h>=3){dn+=ref-p.h;ref=p.h;}}
    ps.prof=prof;ps.profFor=key;ps.up=Math.round(up);ps.down=Math.round(dn);}catch(e){}refreshPlanPanel();}
function drawPlan(c,m){const ps=planState;if(!ps)return;const col=ARTS[ps.art].c;
  ps.segs.forEach((L,i)=>{if(!L||L.length<2)return;c.beginPath();L.forEach((p,k)=>{const q=m.project(p[0],p[1]);k?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y);});
    c.lineJoin=c.lineCap="round";c.setLineDash([]);c.strokeStyle="#fff";c.lineWidth=8;c.stroke();c.strokeStyle=col;c.lineWidth=4.5;if(L._m==="luft"||L._fb)c.setLineDash([10,8]);c.stroke();c.setLineDash([]);});}
function refreshPlanPanel(){if(nav.length&&nav[nav.length-1].fn===planPanel)refreshPanel();else if(planState&&!nav.length)openPanel(planPanel,{half:true});}
function planPanel(){const ps=planState;if(!ps)return {title:"Planen",html:`<div class="empty">Keine Planung offen</div>`};const t=tempoFor(ps.art);const fac=(S.settings.tempoFactor||{})[ps.art]||1;
  const est=ps.up!=null?estTime(ps.dist/1000,ps.up,ps.down,t):null;
  return {title:ps.editId?"Route ändern":"Tour planen",icon:`<svg><use href="#i-flag"/></svg>`,half:true,html:`
   <div class="chips" id="plArts" style="margin-bottom:4px">${Object.entries(ARTS).map(([k,a])=>`<button class="chip${ps.art===k?" on":""}" data-art="${k}">${a.n}</button>`).join("")}</div>
   ${artModes(ps.art).length>1?`<div class="row" style="margin-bottom:10px;gap:6px;flex-wrap:wrap"><span class="muted small">Linie:</span>${artModes(ps.art).map(m=>`<button class="chip sm${ps.mode===m?" on":""}" data-pm="${m}">${MODE_N[m]}</button>`).join("")}</div>`:""}
   ${ps.wps.length<2?`<div class="note">Zuerst oben die Art wählen, dann die Punkte der Reihe nach auf der Karte antippen. Die Linie folgt ${ARTS[ps.art].ski?"den Skirouten von swisstopo (wo keine verläuft: Strassen und Wegen, sonst Luftlinie)":ARTS[ps.art].prof?"den Wegen (Umschalten auf «Luftlinie» für Abschnitte abseits der Wege)":"als Luftlinie"}.<br>Punkte ziehen = verschieben · lange drücken = entfernen · auf die Linie tippen = Zwischenpunkt.</div>`:""}
   <div class="kv"><div><b>${fmtKm(ps.dist||0)}</b><small>Distanz</small></div><div><b>${ps.up!=null?fmtN(ps.up)+" m":"…"}</b><small>Aufstieg</small></div><div><b>${ps.down!=null?fmtN(ps.down)+" m":"…"}</b><small>Abstieg</small></div><div><b>${est!=null?fmtDur(est):"…"}</b><small>Zeit (dein Tempo)</small></div></div>
   ${ps.prof&&ps.prof.length>1?`<div class="card" style="margin-top:10px;padding:8px"><canvas class="prof" id="plProf"></canvas><div class="muted small" id="plProfI">Höhen: swissALTI3D</div></div>`:ps.wps.length>1?`<p class="muted small">${navigator.onLine?"Höhenprofil wird geladen …":"Höhenprofil nur online (swisstopo)"}</p>`:""}
   ${diffHTML(routeDifficulty(ps.segs,ps.art))}
   ${ps.prof?steepHTML(slopeInfo(ps.prof)):""}
   ${ps.prof&&ps.wps.length>1?checkCard(planCheckKey(),!!(ARTS[ps.art]||{}).ski):""}
   <div class="card"><div class="crit"><span>Tempo ${(fac*100).toFixed(0)} %<br><small class="muted">${fmtN(t.vf,1)} km/h · ↑${fmtN(t.vu)} · ↓${fmtN(t.vd)} Hm/h</small></span><input type="range" id="plF" min="60" max="150" step="5" value="${Math.round(fac*100)}" style="flex:1;max-width:180px"></div></div>
   <div class="btns"><button class="btn" id="plG"${ps.wps.length<2?" disabled":""}><svg><use href="#i-down"/></svg>GPX</button>
    <button class="btn" id="plRev"${ps.wps.length<2?" disabled":""}>Umkehren</button><button class="btn" id="plZ"${ps.wps.length<2?" disabled":""}>Zurück zum Start</button></div>
`,foot:`<button class="btn" id="plU2"${ps.undo.length?"":" disabled"} title="Rückgängig (Ctrl+Z)"><svg><use href="#i-undo"/></svg>Rückgängig</button><button class="btn pri" id="plS"${ps.wps.length<2?" disabled":""}><svg><use href="#i-check"/></svg>${ps.editId?"Speichern":"Als Idee speichern"}</button><button class="btn" id="plQ"><svg><use href="#i-close"/></svg>${ps.editId?"Verwerfen":"Beenden"}</button>`,onClose:planQuit,
   after(P){if(ps.prof&&ps.prof.length>1){const si=slopeInfo(ps.prof);bindSteep(P,ps.prof,si);bindCheckCard(P,planCheckKey(),async()=>({prof:ps.prof,line:ps.segs.flatMap(L=>L?L.map(p=>[p[0],p[1]]):[]),winter:!!ARTS[ps.art].ski}));drawProfile($("#plProf",P),ps.prof,{info:$("#plProfI",P),slope:si});}bindDiff(P);
     $$("[data-art]",P).forEach(b=>b.onclick=()=>{if(b.dataset.art!==ps.art)setPlanArt(b.dataset.art);});
     $$("[data-pm]",P).forEach(b=>b.onclick=()=>{ps.mode=b.dataset.pm;refreshPanel();toast(`Neue Punkte: ${MODE_N[ps.mode]}`,1500);});
     $("#plQ",P).onclick=planQuit;
     $("#plF",P).onchange=async e=>{S.settings.tempoFactor=Object.assign({},S.settings.tempoFactor||{});S.settings.tempoFactor[ps.art]=+e.target.value/100;await saveSettings();refreshPanel();};
     $("#plRev",P).onclick=async()=>{snap();ps.wps.reverse();ps.segs=[];await planRoute();refreshPanel();};
     $("#plZ",P).onclick=async()=>{snap();const a=ps.wps[0];ps.wps.push({lat:a.lat,lon:a.lon,mode:ps.mode});await planRoute();refreshPanel();};
     $("#plG",P).onclick=()=>{const L=planLine();download(`${fileSafe(ps.name||"Planung")}.gpx`,toGPX(ps.name||"BoschorMap Planung",L.map(p=>[p[0],p[1],p[2],null])),"application/gpx+xml");};
     $("#plS",P).onclick=savePlan;$("#plU2",P).onclick=planUndo;}};}
async function savePlan(){const ps=planState;if(!ps||ps.wps.length<2)return;if(!ps.prof&&navigator.onLine){clearTimeout(ps.pt);toast("Höhenprofil wird geladen …");await planProfile();if(planState!==ps)return;}const def=ps.name||planName();const name=prompt("Name der Tour-Idee",def);if(name===null)return;
  const L=planLine();let line=L.map(p=>[p[0],p[1],p[2]!=null?p[2]:null,null]);
  if(ps.prof&&ps.prof.length>1){/* Höhen aus swissALTI3D auf die Linie übertragen */let d=0,j=0;line=line.map((p,i)=>{if(i)d+=distM(line[i-1][0],line[i-1][1],p[0],p[1]);const f=d/ps.dist*ps.prof[ps.prof.length-1].d;
      while(j<ps.prof.length-2&&ps.prof[j+1].d<f)j++;const a=ps.prof[j],b=ps.prof[j+1]||a;const h=b.d>a.d?a.h+(b.h-a.h)*(f-a.d)/(b.d-a.d):a.h;return [p[0],p[1],Math.round(h*10)/10,null];});}
  const old=ps.editId?S.tours.find(x=>x.id===ps.editId):null;
  const hs=line.map(p=>p[2]).filter(v=>v!=null);
  const t=Object.assign(old||{id:uid(),status:"idee",rate:{},note:"",diff:""},{name:name.trim()||def,art:ps.art,src:"plan",dist:Math.round(ps.dist),up:ps.up||0,down:ps.down||0,
    emin:hs.length?Math.round(Math.min(...hs)):null,emax:hs.length?Math.round(Math.max(...hs)):null,prof:ps.prof?ps.prof.filter((p,i)=>i%2===0||i===ps.prof.length-1).map(p=>({d:Math.round(p.d),h:Math.round(p.h),lat:r5(p.lat),lon:r5(p.lon)})):null,
    plan:{art:ps.art,wps:ps.wps.map(w=>({lat:r5(w.lat),lon:r5(w.lon),mode:w.mode}))}});
  const dA=routeDifficulty(ps.segs,ps.art);t.diffAuto=dA?{lvl:dA.lvl,lat:r5(dA.lat),lon:r5(dA.lon),km:dA.km,cov:dA.cov,scale:dA.scale,src:dA.src,names:dA.names}:null;if(dA&&(!t.diff||t.diffWasAuto)){t.diff=dA.lvl;t.diffWasAuto=true;}
  await saveTour(t,line);const id=t.id;endPlan();toast("Idee gespeichert");showTour(id);}
function planName(){const ps=planState;const near=(w)=>{let b=null;for(const p of S.points){if(p.del)continue;const d=distM(w.lat,w.lon,p.lat,p.lon);if(d<300&&(!b||d<b.d))b={p,d};}return b&&b.p.name;};
  const a=near(ps.wps[0]),top=ps.prof?ps.prof.reduce((m,p)=>p.h>m.h?p:m,ps.prof[0]):null;const z=top?near(top):near(ps.wps[ps.wps.length-1]);
  return z?(a&&a!==z?`${a} – ${z}`:z):`${ARTS[ps.art].n} ${fmtDate(today())}`;}
/* Wegpunkte verschieben und entfernen */
function bootPlanEvents(){map.on("markerdragstart",e=>{if(e.marker.wp&&planState)snap();});
  map.on("markerdragend",async e=>{const w=e.marker.wp;if(!w||!planState)return;w.lat=e.lat;w.lon=e.lon;await planRoute();refreshPlanPanel();});
  map.on("markerlong",async e=>{const w=e.marker.wp;if(!w||!planState)return;closeWpMenu();return planRemoveWp(w);});}

/* ---------- Persönliches Tempo ---------- */
function tempoPanel(){const arts=Object.keys(ARTS);
  return {title:"Persönliches Tempo",icon:`<svg><use href="#i-gauge"/></svg>`,html:`
   <label class="tg card"><span>Gelerntes Tempo für Schätzungen verwenden<br><small class="muted">Aus deinen Touren (Zeit in Bewegung, Distanz, Auf- und Abstieg), pro Sportart.</small></span><span class="sw2"><input type="checkbox" id="tpL"${S.settings.tempoLearn!==false?" checked":""}><i></i></span></label>
   ${arts.map(a=>{const d=tempoDefault(a),l=learnTempo(S.tours,a),f=(S.settings.tempoFactor||{})[a]||1;const T=S.tours.filter(t=>!t.del&&t.art===a&&t.status==="gemacht"&&t.pace);
     return `<div class="card"><h3 style="color:${ARTS[a].c}">${ARTS[a].n}</h3>
      <table style="width:100%;font-size:13px"><tr class="muted"><td></td><td>Ebene</td><td>Aufstieg</td><td>Abstieg</td></tr>
       <tr><td class="muted">Vorgabe</td><td>${fmtN(d.vf,1)} km/h</td><td>${fmtN(d.vu)} Hm/h</td><td>${fmtN(d.vd)} Hm/h</td></tr>
       <tr><td><b>Gelernt</b></td><td><b>${l.n?fmtN(l.t.vf,1)+" km/h":"–"}</b></td><td><b>${l.n?fmtN(l.t.vu)+" Hm/h":"–"}</b></td><td><b>${l.n?fmtN(l.t.vd)+" Hm/h":"–"}</b></td></tr></table>
      <p class="muted small">${l.n?`aus ${l.n} Touren${l.fac?` · insgesamt ${l.fac<1?"schneller":"langsamer"} als die Vorgabe (Faktor ${fmtN(1/l.fac,2)})`:""}`:"noch keine Touren mit Zeit"}${f!==1?` · Regler ${Math.round(f*100)} %`:""}</p>
      ${T.length?`<canvas class="prof" data-tc="${a}" style="height:130px"></canvas><p class="muted small">Punkte: Steigleistung pro Tour (Hm/h in Abschnitten über 8 % Steigung), Linie: Verlauf. Grau: Abstieg.</p>`:""}</div>`;}).join("")}
   <div class="card"><h3>Vorher geschätzt – tatsächlich</h3>${S.tours.filter(t=>!t.del&&t.status==="gemacht"&&t.moving).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,8).map(t=>{const e=estFor(t);const d=Math.round((t.moving/e-1)*100);
     return `<div class="q"><span class="grow"><b>${esc(t.name)}</b><br><small class="muted">${fmtDate(t.date)} · ${ARTS[t.art].n}</small></span><span>${fmtDur(e)} → <b>${fmtDur(t.moving)}</b><br><small class="${Math.abs(d)<=10?"st-done":"muted"}">${d>0?"+":""}${d} %</small></span></div>`;}).join("")||`<div class="muted">Noch keine Touren.</div>`}</div>`,
   after(P){$("#tpL",P).onchange=async e=>{S.settings.tempoLearn=e.target.checked;await saveSettings();refreshPanel();};
     $$("[data-tc]",P).forEach(cv=>tempoChart(cv,S.tours.filter(t=>!t.del&&t.art===cv.dataset.tc&&t.status==="gemacht"&&t.pace).sort((a,b)=>String(a.date).localeCompare(String(b.date)))));}};}
function tempoChart(cv,T){const dpr=Math.min(2,devicePixelRatio||1),W=cv.clientWidth||300,H=cv.clientHeight||130;cv.width=W*dpr;cv.height=H*dpr;const c=cv.getContext("2d");c.scale(dpr,dpr);
  const pts=T.map(t=>({x:Date.parse(t.date)||0,u:t.pace.vu,d:t.pace.vd})).filter(p=>p.x);if(!pts.length)return;const vals=pts.flatMap(p=>[p.u,p.d]).filter(v=>v);if(!vals.length)return;
  let x0=Math.min(...pts.map(p=>p.x)),x1=Math.max(...pts.map(p=>p.x));if(x1-x0<864e5*20){x0-=864e5*10;x1+=864e5*10;}const ymax=Math.ceil(Math.max(...vals)*1.1/100)*100,L=36,R=6,Tp=8,B=18;
  const X=x=>L+(W-L-R)*(x-x0)/(x1-x0),Y=v=>Tp+(H-Tp-B)*(1-v/ymax);c.font="10px system-ui";c.fillStyle="#62707d";c.strokeStyle="#dde3e8";
  for(let v=0;v<=ymax;v+=ymax>1200?500:200){c.beginPath();c.moveTo(L,Y(v));c.lineTo(W-R,Y(v));c.stroke();c.fillText(fmtN(v),2,Y(v)+3);}
  const yr=new Date(x0).getFullYear(),yr1=new Date(x1).getFullYear();for(let y=yr;y<=yr1;y++){const t=new Date(y,0,1).getTime();if(t>=x0&&t<=x1){c.fillText(String(y),X(t)+2,H-5);c.beginPath();c.moveTo(X(t),Tp);c.lineTo(X(t),H-B);c.stroke();}}
  const ser=(k,col)=>{const p=pts.filter(q=>q[k]);c.fillStyle=col;for(const q of p){c.beginPath();c.arc(X(q.x),Y(q[k]),3.5,0,7);c.fill();}
    if(p.length>2){c.beginPath();p.forEach((q,i)=>{const w=p.slice(Math.max(0,i-2),i+3).map(z=>z[k]).sort((a,b)=>a-b);const m=w[Math.floor(w.length/2)];i?c.lineTo(X(q.x),Y(m)):c.moveTo(X(q.x),Y(m));});c.strokeStyle=col;c.lineWidth=2;c.stroke();}};
  ser("d","#9aa4ad");ser("u","#1f3a52");}

/* ---------- Ideen: passende Tourideen in der Nähe (z. B. fürs Wochenende) ---------- */
let wf=null;
function weekendPanel(){if(!wf)wf=lsJ("wf",{arts:[],maxH:0,maxKm:0,from:"home",done:false});const o=wf.from==="me"&&S.me?S.me:wf.from==="home"&&S.settings.home?S.settings.home:map.getCenter();
  const fromName=wf.from==="me"&&S.me?"Standort":wf.from==="home"&&S.settings.home?"Zuhause":"Kartenmitte";
  let L=S.tours.filter(t=>!t.del&&t.disp&&t.disp.length&&(t.status==="idee"||wf.done)&&(!wf.arts.length||wf.arts.includes(t.art)));
  L=L.map(t=>({t,km:distM(o.lat,o.lon,t.disp[0][0],t.disp[0][1])/1000,h:estFor(t)/3600})).filter(x=>(!wf.maxH||x.h<=wf.maxH)&&(!wf.maxKm||x.km<=wf.maxKm));
  L.sort((a,b)=>(((b.t.rate||{}).gesamt||0)-((a.t.rate||{}).gesamt||0))||a.km-b.km);
  const sat=nextWeekend();
  return {title:"Vorschläge",icon:`<svg><use href="#i-idea"/></svg>`,html:`<p class="muted small" style="margin:0 0 8px">Deine geplanten Touren, die jetzt passen – nach Art, Dauer und Anfahrt, mit Wetter und Bulletin.</p>
   <div class="chips">${Object.entries(ARTS).map(([k,a])=>`<button class="chip${wf.arts.includes(k)?" on":""}" data-a="${k}">${a.n}</button>`).join("")}</div>
   <div class="row" style="margin-bottom:8px"><select class="inp" id="wH" style="flex:1"><option value="0">Dauer beliebig</option>${[2,3,4,5,6,8,10].map(h=>`<option value="${h}"${wf.maxH===h?" selected":""}>bis ${h} h</option>`).join("")}</select>
    <select class="inp" id="wK" style="flex:1"><option value="0">Entfernung beliebig</option>${[20,40,60,90,120,160].map(k=>`<option value="${k}"${wf.maxKm===k?" selected":""}>bis ${k} km</option>`).join("")}</select></div>
   <div class="row" style="margin-bottom:8px"><span class="muted grow">ab ${fromName}</span><select class="inp" id="wF" style="width:auto"><option value="home"${wf.from==="home"?" selected":""}>Zuhause</option><option value="me"${wf.from==="me"?" selected":""}>Standort</option><option value="map"${wf.from==="map"?" selected":""}>Kartenmitte</option></select>
    <label class="row small"><input type="checkbox" id="wD"${wf.done?" checked":""}>auch gemachte</label></div>
   ${!S.settings.home&&wf.from==="home"?`<div class="note">Zuhause ist noch nicht gesetzt (Mehr › Einstellungen). Bis dahin gilt die Kartenmitte.</div>`:""}
   <div id="wL">${L.map(x=>`<button class="li" data-id="${x.t.id}"><span class="sw" style="background:${ARTS[x.t.art].c}"></span><span class="t"><b>${esc(x.t.name)}</b><small>${ARTS[x.t.art].n} · ≈ ${fmtDur(x.h*3600)} · ↑${fmtN(x.t.up)} m · ${fmtN(x.km)} km entfernt</small><small class="wx-${x.t.id}"></small></span>${(x.t.rate||{}).gesamt?starsHTML(x.t.rate.gesamt,"",1):""}</button>`).join("")||`<div class="empty">Keine passenden Ideen. Filter lockern oder unter «Planen» neue Ideen zeichnen.</div>`}</div>
   <p class="muted small">Wetter und Bulletin aus dem gespeicherten Stand (Mehr › Lawinenbulletin & Wetter).</p>`,
   async after(P){$$("[data-a]",P).forEach(b=>b.onclick=()=>{const k=b.dataset.a;wf.arts=wf.arts.includes(k)?wf.arts.filter(x=>x!==k):wf.arts.concat(k);ls("wf",JSON.stringify(wf));refreshPanel();});
     $("#wH",P).onchange=e=>{wf.maxH=+e.target.value;ls("wf",JSON.stringify(wf));refreshPanel();};$("#wK",P).onchange=e=>{wf.maxKm=+e.target.value;ls("wf",JSON.stringify(wf));refreshPanel();};
     $("#wF",P).onchange=e=>{wf.from=e.target.value;if(wf.from==="me"&&!S.me){toggleLocate();toast("Standort wird gesucht …");}ls("wf",JSON.stringify(wf));refreshPanel();};
     $("#wD",P).onchange=e=>{wf.done=e.target.checked;ls("wf",JSON.stringify(wf));refreshPanel();};
     $$("#wL .li",P).forEach(b=>b.onclick=()=>showTour(b.dataset.id));
     for(const x of L.slice(0,30)){const t=x.t;const top=t.prof&&t.prof.length?t.prof.reduce((m,p)=>p.h>m.h?p:m,t.prof[0]):{lat:t.disp[0][0],lon:t.disp[0][1],h:t.emax};
       const [w,b]=await Promise.all([weatherAt(top.lat,top.lon,top.h||t.emax),/ski|winter/.test(t.art)?bulletinAt(top.lat,top.lon):null]);const el=$(".wx-"+t.id,P);if(!el)continue;
       const parts=[];if(b&&b.level)parts.push(`Lawinengefahr ${b.level}${b.sub||""}`);if(w){for(const d of sat){const day=w.days.find(z=>z.date===d.date);if(day)parts.push(`${d.n}: ${day.sy?wxText(day.sy)+", ":""}${fmtN(day.tn)}…${fmtN(day.tx)}°, ${fmtN(day.rr,1)} mm`);}}
       el.textContent=parts.join(" · ");}}};}
function nextWeekend(){const d=new Date();const out=[];for(let i=0;i<8&&out.length<2;i++){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+i);const wd=x.getDay();if(wd===6||wd===0)out.push({date:`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`,n:wd===6?"Sa":"So"});}return out;}

/* ---------- Checklisten (global pro Sportart) ---------- */
let chkArt=null;
function checklistPanel(art){if(art)chkArt=art;if(!chkArt)chkArt=ls("chkArt")||"skitour";const a=chkArt;const items=(S.settings.checklists||{})[a]||[];const st=(S.settings.checkState||{})[a]||{};
  return {title:"Checkliste",icon:`<svg><use href="#i-check"/></svg>`,html:`
   <div class="chips">${Object.entries(ARTS).map(([k,x])=>`<button class="chip${k===a?" on":""}" data-a="${k}">${x.n}</button>`).join("")}</div>
   <div class="card">${items.map((it,i)=>`<div class="chk${st[i]?" done":""}"><input type="checkbox" data-i="${i}"${st[i]?" checked":""}><span>${esc(it)}</span><button class="ib" data-del="${i}" aria-label="Entfernen" style="width:32px;height:32px;color:var(--mu)"><svg style="width:16px;height:16px"><use href="#i-close"/></svg></button></div>`).join("")||`<div class="muted">Leer.</div>`}
    <div class="row" style="margin-top:8px"><input class="inp grow" id="cNew" placeholder="Neuer Eintrag"><button class="btn" id="cAdd"><svg><use href="#i-plus"/></svg></button></div></div>
   <div class="btns"><button class="btn" id="cReset">Alle Haken entfernen</button><button class="btn" id="cDef">Vorgabe wiederherstellen</button></div>`,
   after(P){const save=async()=>{await saveSettings();refreshPanel();};
     $$("[data-a]",P).forEach(b=>b.onclick=()=>{chkArt=b.dataset.a;ls("chkArt",chkArt);refreshPanel();});
     $$("[data-i]",P).forEach(c=>c.onchange=async()=>{S.settings.checkState=S.settings.checkState||{};const s=S.settings.checkState[a]=S.settings.checkState[a]||{};if(c.checked)s[c.dataset.i]=1;else delete s[c.dataset.i];
       c.closest(".chk").classList.toggle("done",c.checked);await saveSettings(false);});
     $$("[data-del]",P).forEach(b=>b.onclick=async()=>{const i=+b.dataset.del;S.settings.checklists[a].splice(i,1);S.settings.checkState[a]={};await save();});
     const add=async()=>{const v=$("#cNew",P).value.trim();if(!v)return;S.settings.checklists[a]=(S.settings.checklists[a]||[]).concat(v);await save();setTimeout(()=>{const n=$("#cNew");if(n)n.focus();},50);};
     $("#cAdd",P).onclick=add;$("#cNew",P).onkeydown=e=>{if(e.key==="Enter")add();};
     $("#cReset",P).onclick=async()=>{S.settings.checkState=S.settings.checkState||{};S.settings.checkState[a]={};await saveSettings(false);refreshPanel();};
     $("#cDef",P).onclick=async()=>{if(!confirm("Liste auf die Vorgabe zurücksetzen?"))return;S.settings.checklists[a]=DEFAULT_CHECK[a].slice();S.settings.checkState[a]={};await save();};}};}

/* ---------- Fotos zur Tour: Stelle auf der Route über die Aufnahmezeit (Track) oder den Aufnahmeort ---------- */
const PH_TOL=10*60000,PH_NEAR=200;
function trackCum(line){const c=new Float64Array(line.length);for(let i=1;i<line.length;i++)c[i]=c[i-1]+distM(line[i-1][0],line[i-1][1],line[i][0],line[i][1]);return c;}
function trackTimed(line){return !!(line&&line.length>1&&line[0][3]!=null&&line[line.length-1][3]!=null);}
function placeOnTrack(line,cum,ph,off){if(!line||line.length<2)return null;const n=line.length,P=(i,how)=>({lat:line[i][0],lon:line[i][1],h:line[i][2],d:cum[i],how});
  if(ph.t&&trackTimed(line)){const tt=ph.t+(off||0),t0=line[0][3],t1=line[n-1][3];
    if(tt>=t0-PH_TOL&&tt<=t1+PH_TOL){if(tt<=t0)return P(0,"zeit");if(tt>=t1)return P(n-1,"zeit");let lo=0,hi=n-1;
      while(hi-lo>1){const m=(lo+hi)>>1,tm=line[m][3];if(tm==null||tm<=tt)lo=m;else hi=m;}
      const a=line[lo],b=line[hi];const f=b[3]!=null&&a[3]!=null&&b[3]>a[3]?(tt-a[3])/(b[3]-a[3]):0;
      return {lat:a[0]+(b[0]-a[0])*f,lon:a[1]+(b[1]-a[1])*f,h:a[2]!=null&&b[2]!=null?a[2]+(b[2]-a[2])*f:a[2],d:cum[lo]+(cum[hi]-cum[lo])*f,how:"zeit"};}}
  if(ph.lat!=null){let bi=0,bd=Infinity;for(let i=0;i<n;i++){const d=distM(ph.lat,ph.lon,line[i][0],line[i][1]);if(d<bd){bd=d;bi=i;}}
    if(bd<=PH_NEAR)return {lat:ph.lat,lon:ph.lon,h:line[bi][2],d:cum[bi],how:"ort"};}
  return null;}
const fmtClock=ms=>{const d=new Date(ms);return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");};
function tourPhotoCap(x){return [x.d!=null?fmtKm(x.d):"",x.h!=null?fmtN(Math.round(x.h))+" m":"",x.t?fmtClock(x.t):""].filter(Boolean).join(" · ");}
function sortTourPhotos(t){t.photos=(t.photos||[]).sort((a,b)=>(a.d==null)-(b.d==null)||(a.d||0)-(b.d||0)||(a.t||0)-(b.t||0));}
function tourPhotoMarks(t){return (t.photos||[]).map(x=>({d:x.d,h:x.h}));}
function openTourPhoto(t,i){const ph=t.photos||[];showGallery(ph.map(x=>x.id),i,{cap:k=>tourPhotoCap(ph[k])});}

/* Fotopunkte auf der Karte (nur bei der gewählten Tour) */
let tpm=[],tpmFor=null;
function clearTourPhotoMarks(){for(const m of tpm)map.removeMarker(m);tpm=[];tpmFor=null;}
function setTourPhotoMarks(t){clearTourPhotoMarks();if(!t||!(t.photos||[]).length)return;tpmFor=t.id;
  t.photos.forEach((x,i)=>{if(x.lat==null)return;const m=map.addMarker({lat:x.lat,lon:x.lon,anchor:[13,13],html:`<div class="phm"><svg><use href="#i-cam"/></svg></div>`,z:45});m.onClick=()=>openTourPhoto(t,i);tpm.push(m);});}

function tourPhotoCard(t,idea){const ph=t.photos||[];
  return `<div class="card"><h3>Fotos${ph.length?` <span class="muted small">${ph.length}</span>`:""}</h3>
    ${ph.length?`<div class="tph">${ph.map((x,i)=>`<button data-tp="${i}" aria-label="Foto ${i+1}"><img alt="" data-tpi="${x.id}">${x.d!=null?`<small>${fmtKm(x.d)}</small>`:""}</button>`).join("")}</div>`
      :`<p class="muted small" style="margin:4px 0 8px">${idea?"Fotos lassen sich bei gemachten Touren zuordnen.":"Unterwegs normal fotografieren und hier zuordnen. Die Stelle auf der Route ergibt sich aus der Aufnahmezeit."}</p>`}
    ${idea?"":`<div class="btns"><button class="btn" id="tPh"><svg><use href="#i-cam"/></svg>Fotos zuordnen</button>${ph.length?`<button class="btn" id="tPhE"><svg><use href="#i-edit"/></svg>Bearbeiten</button>`:""}</div>`}</div>`;}
function bindTourPhotoCard(P,t){$$("[data-tpi]",P).forEach(async im=>{im.src=await thumbURL(im.dataset.tpi);});
  $$("[data-tp]",P).forEach(b=>b.onclick=()=>openTourPhoto(t,+b.dataset.tp));
  const a=$("#tPh",P);if(a)a.onclick=()=>{const f=$("#fTPh");f.onchange=()=>{const fs=[...f.files];f.value="";if(fs.length)tourPhotoAssign(t,fs);};f.click();};
  const e=$("#tPhE",P);if(e)e.onclick=()=>openPanel(()=>tourPhotoEditPanel(t));}

async function tourPhotoAssign(t,files){const have=new Set((t.photos||[]).map(x=>x.src).filter(Boolean));const items=[];let dup=0;
  try{for(let i=0;i<files.length;i++){if(i%3===0)progress("Fotos lesen",i,files.length,"Aufnahmezeit und -ort …");const f=files[i];const src=f.name+"|"+f.size+"|"+f.lastModified;
      if(have.has(src)){dup++;continue;}const info=await exifInfo(f);items.push({file:f,src,t:info.time||f.lastModified||0,exif:!!info.time,lat:info.ll?info.ll[0]:null,lon:info.ll?info.ll[1]:null});}}
  finally{progressDone();}
  if(!items.length)return toast(dup?"Diese Fotos sind schon bei der Tour":"Keine Fotos gewählt");
  const line=await tourLine(t.id);if(!line)return toast("Linie fehlt (noch nicht abgeglichen?)");const cum=trackCum(line);const timed=trackTimed(line);
  const calc=off=>items.map(it=>placeOnTrack(line,cum,it,off));const count=off=>calc(off).filter(Boolean).length;
  let off=0,extra=false;
  /* Zeitverschiebung vorschlagen (z. B. Kamera noch auf Sommerzeit) */
  let sugg=null;if(timed&&count(0)<items.length){let best=count(0);for(const h of [-2,-1,1,2]){const c=count(h*3600000);if(c>best){best=c;sugg=h*60;}}}
  openPanel(()=>{const res=calc(off*60000);const zt=res.filter(r=>r&&r.how==="zeit").length,zo=res.filter(r=>r&&r.how==="ort").length,no=res.length-zt-zo;
    const tr=timed?`${fmtClock(line[0][3])}–${fmtClock(line[line.length-1][3])}`:"";const pts=items.filter(x=>x.t).map(x=>x.t+off*60000);
    const pr=pts.length?`${fmtClock(Math.min(...pts))}–${fmtClock(Math.max(...pts))}`:"";
    return {title:"Fotos zuordnen",icon:`<svg><use href="#i-cam"/></svg>`,html:`
     <div class="card"><div class="kv"><div><b>${zt}</b><small>über die Zeit</small></div><div><b>${zo}</b><small>über den Ort</small></div><div><b>${no}</b><small>passen nicht</small></div></div>
      <p class="muted small">${timed?`Tour ${tr}${pr?` · Fotos ${pr}`:""}`:"Diese Tour hat keine Zeiten – Zuordnung nur über den Aufnahmeort (bis 200 m neben der Route)."}${dup?` · ${dup} schon vorhanden`:""}</p>
      ${timed?`<label class="f">Zeit der Fotos verschieben</label><div class="offr"><button class="btn" data-off="-5">−5</button><button class="btn" data-off="-1">−1</button><b>${off>0?"+":""}${off} min</b><button class="btn" data-off="1">+1</button><button class="btn" data-off="5">+5</button></div>
      <p class="muted small" style="margin:0">Nur nötig, wenn die Handyzeit nicht mit der Uhr übereinstimmt.</p>`:""}
      ${sugg!=null&&off!==sugg?`<button class="btn full" id="aSug" style="margin-top:8px">${sugg>0?"+":""}${sugg/60} h verschieben (Zeitzone?) – dann passen ${count(sugg*60000)}</button>`:""}
      ${no?`<label class="chk" style="margin-top:8px"><input type="checkbox" id="aEx"${extra?" checked":""}><span>Die ${no} übrigen trotzdem zur Tour (ohne Stelle auf der Route)</span></label>`:""}</div>
     <button class="btn pri full" id="aOk"${zt+zo+(extra?no:0)?"":" disabled"}><svg><use href="#i-check"/></svg>${zt+zo+(extra?no:0)} Fotos übernehmen</button>`,
     after(P){$$("[data-off]",P).forEach(b=>b.onclick=()=>{off+=+b.dataset.off;refreshPanel();});const sg=$("#aSug",P);if(sg)sg.onclick=()=>{off=sugg;refreshPanel();};
       const ex=$("#aEx",P);if(ex)ex.onchange=()=>{extra=ex.checked;refreshPanel();};
       $("#aOk",P).onclick=async()=>{const r=calc(off*60000);const sel=items.map((it,i)=>({it,p:r[i]})).filter(x=>x.p||extra);let k=0;
         try{t.photos=t.photos||[];for(const x of sel){k++;progress("Fotos speichern",k,sel.length,x.it.file.name);
             const id=await storePhoto(x.it.file,t.id,{time:x.it.t,ll:x.it.lat!=null?[x.it.lat,x.it.lon]:null});const p=x.p||{};
             t.photos.push({id,t:x.it.t?x.it.t+off*60000:0,lat:p.lat!=null?r5(p.lat):null,lon:p.lon!=null?r5(p.lon):null,h:p.h!=null?Math.round(p.h):null,d:p.d!=null?Math.round(p.d):null,src:x.it.src});}
           sortTourPhotos(t);await saveTour(t);}catch(e){toast("Fotos: "+e.message,5000);}finally{progressDone();}
         showTour(t.id,true);toast(`${sel.length} Foto${sel.length>1?"s":""} zur Tour`);};}};});}

function tourPhotoEditPanel(t){return {title:"Fotos bearbeiten",html:`<div class="card">${(t.photos||[]).map((x,i)=>`<div class="phl"><img alt="" data-tpi="${x.id}"><span>${esc(tourPhotoCap(x)||"ohne Stelle")}</span>
    <button class="ib" data-tpd="${i}" aria-label="Foto entfernen"><svg><use href="#i-trash"/></svg></button></div>`).join("")||`<div class="muted">Keine Fotos.</div>`}</div>`,
  after(P){$$("[data-tpi]",P).forEach(async im=>{im.src=await thumbURL(im.dataset.tpi);});
    $$("[data-tpd]",P).forEach(b=>b.onclick=async()=>{if(!confirm("Foto von der Tour entfernen?"))return;const x=t.photos.splice(+b.dataset.tpd,1)[0];
      t.phDel=(t.phDel||[]).concat(x.id).slice(-200);try{await del("photos",x.id);}catch(e){}await saveTour(t);setTourPhotoMarks(t);refreshPanel();});}};}

/* Unterwegs fotografieren: Zeit und Standort festhalten, beim GPX-Import der Tour zuordnen */
async function tripCam(){const me=locateOnce();const f=$("#fCam");f.onchange=async()=>{const x=f.files[0];f.value="";if(!x)return;const tt=Date.now();
    progress("Foto speichern",0,0,"");try{const pos=await Promise.race([me,sleep(4000).then(()=>S.me||null)]);const info=await exifInfo(x);
      const id=await storePhoto(x,"",{time:info.time||tt,ll:pos?[pos.lat,pos.lon]:info.ll});const list=await metaGet("tripCam",[]);
      list.push({id,t:info.time||tt,lat:pos?r5(pos.lat):info.ll?r5(info.ll[0]):null,lon:pos?r5(pos.lon):info.ll?r5(info.ll[1]):null});await metaSet("tripCam",list);
      toast(`Foto gespeichert – kommt beim GPX-Import auf die Route (${list.length} wartend)`,4000);}catch(e){toast("Foto: "+e.message,5000);}finally{progressDone();}};
  f.click();}
async function attachTripPhotos(t,line){const list=await metaGet("tripCam",[]);if(!list.length||!line)return 0;const cum=trackCum(line);const rest=[];let n=0;
  for(const x of list){const p=placeOnTrack(line,cum,x,0);if(!p||(p.how==="ort"&&trackTimed(line))){rest.push(x);continue;}
    t.photos=t.photos||[];t.photos.push({id:x.id,t:x.t,lat:r5(p.lat),lon:r5(p.lon),h:p.h!=null?Math.round(p.h):null,d:Math.round(p.d)});
    const ph=await getOne("photos",x.id);if(ph){ph.pid=t.id;await put("photos",ph);}n++;}
  if(n){sortTourPhotos(t);await saveTour(t);}if(rest.length!==list.length)await metaSet("tripCam",rest);return n;}

/* ---------- Mehrere Tracks zu einer Tour zusammenfassen (Unterbrüche beim Aufzeichnen) ---------- */
const MERGE_GAP=6*3600000;
function maxT(pts){let m=null;for(const p of pts)if(p[3]&&(m==null||p[3]>m))m=p[3];return m;}
function minT(pts){let m=null;for(const p of pts)if(p[3]&&(m==null||p[3]<m))m=p[3];return m;}
/* Bereinigte Teilstücke zu einer Tour: Kennzahlen summieren, Gesamtzeit vom ersten Start bis zum letzten Ende */
function combineClean(cl){cl=cl.slice().sort((a,b)=>(a.stats.t0||0)-(b.stats.t0||0));const st={dist:0,up:0,down:0,moving:null,total:null,t0:null,emin:null,emax:null};let removed=0,pauses=0,pts=[];
  for(const c of cl){const s=c.stats;st.dist+=s.dist||0;st.up+=s.up||0;st.down+=s.down||0;if(s.moving!=null)st.moving=(st.moving||0)+s.moving;
    if(s.emin!=null&&(st.emin==null||s.emin<st.emin))st.emin=s.emin;if(s.emax!=null&&(st.emax==null||s.emax>st.emax))st.emax=s.emax;
    removed+=c.removed||0;pauses+=(c.pauses||[]).length;for(const p of c.pts)pts.push(p);}
  const a=minT(pts),b=maxT(pts);st.t0=a;st.total=a&&b?Math.round((b-a)/1000):null;
  return {pts,stats:st,removed,pauses:{length:pauses+cl.length-1},gaps:cl.length-1};}
function mergeGpxText(txts,name){const trk=[];for(const t of txts){const m=t.match(/<trk[\s>][\s\S]*?<\/trk>/g);if(m)trk.push(...m);}
  if(!trk.length)return txts[0];return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="BoschorMap" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(name||"")}</name></metadata>\n${trk.join("\n")}\n</gpx>\n`;}
/* Beim Import: Tracks desselben Tags mit Unterbruch unter 6 h als Gruppe vorschlagen */
function mergeGroups(items){const v=items.map((it,i)=>({it,i})).filter(x=>!x.it.err&&minT(x.it.g.pts)).sort((a,b)=>minT(a.it.g.pts)-minT(b.it.g.pts));const groups=[];let cur=null;
  for(const x of v){const s=minT(x.it.g.pts);if(cur&&cur.date===x.it.date&&s-cur.end<MERGE_GAP&&s-cur.end>-60000){cur.idx.push(x.i);cur.gaps.push(Math.max(0,s-cur.end));cur.end=Math.max(cur.end,maxT(x.it.g.pts));}
    else{cur={date:x.it.date,idx:[x.i],gaps:[],end:maxT(x.it.g.pts)};groups.push(cur);}}
  return groups.filter(g=>g.idx.length>1);}
const fmtGap=ms=>{const m=Math.round(ms/60000);return m<60?`${m} min`:`${Math.floor(m/60)} h ${String(m%60).padStart(2,"0")}`;};

/* Bestehende Touren zusammenführen */
async function mergeTours(ids){const ts=ids.map(id=>S.tours.find(t=>t.id===id)).filter(Boolean).sort((a,b)=>(a.t0||0)-(b.t0||0));if(ts.length<2)return null;
  progress("Touren zusammenführen",0,ts.length);try{
    const lines=[],raws=[];for(let i=0;i<ts.length;i++){progress("Touren zusammenführen",i,ts.length,ts[i].name);const L=await tourLine(ts[i].id);if(!L)throw new Error(`Linie von «${ts[i].name}» fehlt`);lines.push(L);
      const r=await getOne("raw",ts[i].id);if(r)raws.push(r.gpx);}
    const cl=ts.map((t,i)=>({pts:lines[i],removed:t.removed||0,pauses:{length:t.pauses||0},stats:{dist:t.dist,up:t.up,down:t.down,moving:t.moving,t0:t.t0,emin:t.emin,emax:t.emax}}));
    const c=combineClean(cl);const f=ts[0];const nt=Object.assign({},f,{id:uid(),created:0,dist:c.stats.dist,up:c.stats.up,down:c.stats.down,moving:c.stats.moving,total:c.stats.total,t0:c.stats.t0,
      emin:c.stats.emin,emax:c.stats.emax,removed:c.removed,pauses:c.pauses.length,merged:ts.length,photos:[],phDel:[],
      note:ts.map(t=>t.note).filter(Boolean).join("\n"),rate:Object.assign({},...ts.slice().reverse().map(t=>t.rate||{})),diff:f.diff||ts.map(t=>t.diff).find(Boolean)||""});
    delete nt.del;
    /* Fotos auf die neue Linie setzen */
    const cum=trackCum(c.pts);for(const t of ts)for(const x of t.photos||[]){const p=placeOnTrack(c.pts,cum,x,0);nt.photos.push(Object.assign({},x,p?{lat:r5(p.lat),lon:r5(p.lon),h:p.h!=null?Math.round(p.h):null,d:Math.round(p.d)}:{}));}
    sortTourPhotos(nt);await saveTour(nt,c.pts,raws.length?mergeGpxText(raws,nt.name):null);
    for(const p of S.points){let ch=false;for(const v of p.visits||[])if(ids.includes(v.tour)){v.tour=nt.id;ch=true;}if(ch){const seen=new Set();p.visits=p.visits.filter(v=>{const k=v.d+"|"+v.tour;if(seen.has(k))return false;seen.add(k);return true;});await savePoint(p);}}
    for(const t of ts){t.photos=[];t.del=Date.now();await saveTour(t);}
    return nt;}finally{progressDone();}}
function mergePanel(t){const cand=S.tours.filter(x=>!x.del&&x.id!==t.id&&x.status==="gemacht"&&x.date&&t.date&&Math.abs(Date.parse(x.date)-Date.parse(t.date))<=864e5).sort((a,b)=>(a.t0||0)-(b.t0||0));
  return {title:"Touren zusammenführen",icon:`<svg><use href="#i-route"/></svg>`,html:`<p class="muted">Für Touren, bei denen die Aufzeichnung unterbrochen wurde. Die Teile werden nach Zeit aneinandergehängt; Distanz, Höhenmeter und Zeit in Bewegung zusammengezählt, die Unterbrüche zählen als Pause.</p>
   <div class="card"><b>${esc(t.name)}</b><div class="muted small">${fmtDate(t.date)}${t.t0?" · "+fmtClock(t.t0):""} · ${fmtKm(t.dist||0)}</div></div>
   ${cand.length?`<div class="card">${cand.map(x=>`<label class="chk"><input type="checkbox" data-mt="${x.id}"${x.date===t.date?" checked":""}><span>${esc(x.name)}<br><small class="muted">${fmtDate(x.date)}${x.t0?" · "+fmtClock(x.t0):""} · ${fmtKm(x.dist||0)} · ${ARTS[x.art]?ARTS[x.art].n:""}</small></span></label>`).join("")}</div>
     <button class="btn pri full" id="mGo"><svg><use href="#i-check"/></svg>Zusammenführen</button>`:`<div class="note">Keine anderen gemachten Touren vom gleichen oder vom Nachbartag.</div>`}`,
   after(P){const g=$("#mGo",P);if(g)g.onclick=async()=>{const ids=[t.id,...$$("[data-mt]",P).filter(c=>c.checked).map(c=>c.dataset.mt)];if(ids.length<2)return toast("Mindestens eine weitere Tour wählen");
     try{const nt=await mergeTours(ids);closePanel();if(nt){toast(`${ids.length} Touren zusammengeführt`);showTour(nt.id);}}catch(e){toast(e.message,5000);}};}};}

/* Schlüssel für den Routen-Check: ändert sich, sobald die Route sich ändert */
function tourCheckKey(t){return `t:${t.id}:${t.mod||t.created||0}:${t.art}`;}
function planCheckKey(){const ps=planState;return ps?`p:${ps.art}:`+ps.wps.map(w=>w.lat.toFixed(5)+","+w.lon.toFixed(5)+w.mode).join("|"):"";}
