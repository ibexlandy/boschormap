/* Boschor Map – Touren: GPX-Import, Liste, Detail mit Höhenprofil, Planung, Tempo, Ideen, Checklisten */
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

/* ---------- GPX-Import (mehrere Dateien) ---------- */
async function importGPX(files){const items=[];progress("GPX lesen",0,files.length);
  for(let i=0;i<files.length;i++){progress("GPX lesen",i,files.length,files[i].name);try{const txt=await files[i].text();const g=parseGPX(txt);if(g.pts.length<2)throw new Error("keine Trackpunkte");
      const t0=g.pts.find(p=>p[3]);const art=guessArt(g.type+" "+g.name+" "+files[i].name)||ls("lastArt")||"wandern";
      items.push({file:files[i],txt,g,art,name:g.name&&!/^(suunto|track|move|activity)/i.test(g.name)?g.name:"",date:t0?new Date(t0[3]).toISOString().slice(0,10):today()});}
    catch(e){items.push({file:files[i],err:e.message});}}
  progressDone();
  openPanel(()=>({title:`GPX importieren (${items.length})`,icon:`<svg><use href="#i-gpx"/></svg>`,html:`
    <p class="muted">Pro Tour Art und Name prüfen. Pausen und GPS-Ausreisser werden automatisch bereinigt, das Original bleibt gespeichert.</p>
    ${items.length>1?`<div class="card row"><span class="grow">Art für alle</span><select class="inp" id="gAll" style="width:auto"><option value="">–</option>${artOpts("")}</select></div>`:""}
    ${items.map((it,i)=>it.err?`<div class="card"><b>${esc(it.file.name)}</b><div class="st-err">${esc(it.err)}</div></div>`:`<div class="card"><div class="muted small">${esc(it.file.name)} · ${fmtDate(it.date)} · ${fmtN(it.g.pts.length)} Punkte</div>
      <div class="row" style="margin-top:6px"><input class="inp grow" data-n="${i}" placeholder="Name der Tour" value="${esc(it.name)}"><select class="inp" data-a="${i}" style="width:auto">${artOpts(it.art)}</select></div></div>`).join("")}
    <button class="btn pri full" id="gGo"${items.some(x=>!x.err)?"":" disabled"}><svg><use href="#i-down"/></svg>Importieren</button>`,
    after(P){const ga=$("#gAll",P);if(ga)ga.onchange=()=>{if(ga.value)$$("[data-a]",P).forEach(s=>s.value=ga.value);};
      $("#gGo",P).onclick=async()=>{for(const s of $$("[data-a]",P))items[+s.dataset.a].art=s.value;for(const s of $$("[data-n]",P))items[+s.dataset.n].name=s.value.trim();
        closePanel();await doImport(items.filter(x=>!x.err));};}}));}
async function doImport(items){const added=[],skipped=[];
  for(let i=0;i<items.length;i++){const it=items[i];progress("Touren bereinigen und speichern",i,items.length,it.name||it.file.name);await sleep(10);
    const c=cleanTrack(it.g.pts,it.art);const st=c.stats;
    const dup=S.tours.find(t=>!t.del&&t.status==="gemacht"&&t.t0&&st.t0&&Math.abs(t.t0-st.t0)<60000&&Math.abs((t.dist||0)-st.dist)<Math.max(50,st.dist*0.02));
    if(dup){skipped.push(it.name||it.file.name);continue;}
    const t={id:uid(),status:"gemacht",src:"gpx",art:it.art,name:it.name||`${ARTS[it.art].n} ${fmtDate(it.date)}`,date:it.date,dist:st.dist,up:st.up,down:st.down,moving:st.moving,total:st.total,
      t0:st.t0,emin:st.emin,emax:st.emax,removed:c.removed,pauses:c.pauses.length,note:"",rate:{},diff:""};
    await saveTour(t,c.pts,it.txt);added.push({t,line:c.pts});}
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
   <div class="chips"><button class="chip${tf.status==="gemacht"?" on":""}" data-s="gemacht">Gemacht</button><button class="chip${tf.status==="idee"?" on":""}" data-s="idee">Ideen</button>
    <span class="grow"></span>${tf.status==="gemacht"?`<select class="inp" id="tY" style="width:auto;min-height:34px;padding:4px 8px"><option value="">Alle Jahre</option>${years.map(y=>`<option${y===tf.year?" selected":""}>${y}</option>`).join("")}</select>`:""}</div>
   <div class="chips"><button class="chip${!tf.art?" on":""}" data-a="">Alle</button>${Object.entries(ARTS).map(([k,a])=>`<button class="chip${tf.art===k?" on":""}" data-a="${k}" style="${tf.art===k?`background:${a.c};border-color:${a.c}`:`border-color:${a.c}`}">${a.n}</button>`).join("")}</div>
   ${tf.status==="gemacht"?`<div class="kv" style="margin-bottom:10px"><div><b>${fmtN(sum.n)}</b><small>Touren</small></div><div><b>${fmtN(sum.km)}</b><small>km</small></div><div><b>${fmtN(sum.up)}</b><small>Höhenmeter</small></div><div><b>${fmtDur(sum.mv)}</b><small>in Bewegung</small></div></div>
    ${Object.keys(byYear).length>1?`<div class="card"><h3>Pro Jahr</h3><table style="width:100%;font-size:14px"><tr class="muted"><td>Jahr</td><td>Touren</td><td>km</td><td>Hm</td></tr>${Object.entries(byYear).sort((a,b)=>b[0].localeCompare(a[0])).map(([y,v])=>`<tr><td><b>${y}</b></td><td>${v.n}</td><td>${fmtN(v.km)}</td><td>${fmtN(v.up)}</td></tr>`).join("")}</table></div>`:""}`:""}
   <div class="btns" style="margin-bottom:10px"><button class="btn" id="tImp"><svg><use href="#i-gpx"/></svg>GPX importieren</button><button class="btn" id="tPlan"><svg><use href="#i-flag"/></svg>Neue Idee planen</button></div>
   ${L.map(t=>`<button class="li" data-id="${t.id}"><span class="sw" style="background:${ARTS[t.art].c}"></span><span class="t"><b>${esc(t.name)}</b><small>${t.status==="gemacht"?fmtDate(t.date)+" · ":""}${ARTS[t.art].n} · ${fmtKm(t.dist)} · ↑${fmtN(t.up)} m · ${t.status==="gemacht"?fmtDur(t.moving):"≈ "+fmtDur(estFor(t))}</small></span>${(t.rate||{}).gesamt?starsHTML(t.rate.gesamt,"",1):""}</button>`).join("")||`<div class="empty">${tf.status==="gemacht"?"Noch keine Touren. GPX-Dateien aus der Suunto-App importieren.":"Noch keine Ideen. Unter «Planen» eine Tour zeichnen."}</div>`}`,
   after(P){$$("[data-s]",P).forEach(b=>b.onclick=()=>{tf.status=b.dataset.s;refreshPanel();});$$("[data-a]",P).forEach(b=>b.onclick=()=>{tf.art=b.dataset.a;refreshPanel();});
     const y=$("#tY",P);if(y)y.onchange=()=>{tf.year=y.value;refreshPanel();};$("#tImp",P).onclick=()=>$("#fGpx").click();$("#tPlan",P).onclick=()=>{closePanel();startPlan({});};
     $$(".li[data-id]",P).forEach(b=>b.onclick=()=>showTour(b.dataset.id));}};}

/* ---------- Tour anzeigen ---------- */
let profMk=null;function removeProfDot(){if(profMk){map.removeMarker(profMk);profMk=null;}}
async function showTour(id,replace){const t=S.tours.find(x=>x.id===id);if(!t)return;selTour=id;S._selLine=null;selPoint=null;refreshMarkers();
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
  return {title:t.name,icon:artIc(t.art),half:true,html:`
   <div class="row" style="margin-bottom:8px"><span class="tag" style="background:${a.c};color:#fff">${a.n}</span><span class="tag">${idea?"Idee":fmtDate(t.date)}</span>${t.diff?`<span class="tag">${esc(t.diff)}</span>`:""}${t.fromIdea?`<span class="tag">aus Idee</span>`:""}</div>
   <div class="kv"><div><b>${fmtKm(t.dist)}</b><small>Distanz</small></div><div><b>${fmtN(t.up)} m</b><small>Aufstieg</small></div><div><b>${fmtN(t.down)} m</b><small>Abstieg</small></div>
    ${idea?`<div><b>≈ ${fmtDur(est)}</b><small>mit deinem Tempo</small></div>`:`<div><b>${fmtDur(t.moving)}</b><small>in Bewegung${t.total?` · gesamt ${fmtDur(t.total)}`:""}</small></div>`}
    ${t.emax!=null?`<div><b>${fmtN(t.emax)} m</b><small>höchster Punkt</small></div>`:""}${!idea&&t.moving?`<div><b>${fmtDur(est)}</b><small>Schätzung vorher</small></div>`:""}</div>
   ${prof.length>1?`<div class="card" style="margin-top:10px;padding:8px"><canvas class="prof" id="tProf"></canvas><div class="muted small" id="tProfI">Antippen oder darüberfahren: Stelle auf der Karte</div></div>`:""}
   ${!idea&&(t.removed||t.pauses)?`<p class="muted small">Bereinigt: ${t.pauses?t.pauses+" Pausen zusammengefasst":""}${t.removed&&t.pauses?", ":""}${t.removed?t.removed+" Ausreisser entfernt":""}.</p>`:""}
   <div class="card"><h3>Bewertung</h3><div class="crit"><span>Gesamt</span>${starsHTML((t.rate||{}).gesamt,"gesamt")}</div>${TOUR_CRIT.map(([k,n])=>`<div class="crit"><span>${n}</span>${starsHTML((t.rate||{})[k],k)}</div>`).join("")}
    ${t.note?`<p style="white-space:pre-wrap;margin:8px 0 0">${esc(t.note)}</p>`:""}</div>
   ${along.length?`<div class="card"><h3>Am Weg</h3>${along.map(x=>`<button class="li" data-p="${x.p.id}">${catIc(x.p.cat)}<span class="t"><b>${esc(x.p.name)}</b><small>${x.p.hoehe?fmtN(x.p.hoehe)+" m · ":""}${CATS[x.p.cat].n}${(x.p.photos||[]).length?` · ${x.p.photos.length} Fotos`:""}</small></span></button>`).join("")}</div>`:""}
   <div class="btns">
    <button class="btn" id="tEd"><svg><use href="#i-edit"/></svg>Bearbeiten</button>
    ${idea?`<button class="btn pri" id="tRe"><svg><use href="#i-flag"/></svg>Route ändern</button>`:`<button class="btn" id="tAgain"><svg><use href="#i-flag"/></svg>Nochmals machen</button>`}
    <button class="btn" id="tGpx"><svg><use href="#i-down"/></svg>GPX</button>
    <button class="btn" id="tCond"><svg><use href="#i-${winter?"snow":"sun"}"/></svg>${winter?"Bulletin & Wetter":"Wetter"}</button>
    <button class="btn" id="tChk"><svg><use href="#i-check"/></svg>Checkliste</button>
    ${winter?`<a class="btn" href="https://www.skitourenguru.ch/" target="_blank" rel="noopener">Skitourenguru</a>`:""}
    ${hasRaw?`<button class="btn" id="tRaw">Original-Track</button>`:""}
    <button class="btn red" id="tDel"><svg><use href="#i-trash"/></svg>Löschen</button></div>`,
   async after(P){P.addEventListener("stars",async e=>{const k=e.target.dataset.stars;t.rate=Object.assign({},t.rate||{});t.rate[k]=e.detail;await saveTour(t);});
     if(prof.length>1){const top=prof.reduce((m,p)=>p.h>m.h?p:m,prof[0]);const b=winter?await bulletinAt(top.lat,top.lon):null;const band=b&&b.critLow!=null?[b.critLow,b.critHigh]:null;
       drawProfile($("#tProf",P),prof,{band,info:$("#tProfI",P)});}
     $("#tEd",P).onclick=()=>openPanel(()=>editTourPanel(t));
     const re=$("#tRe",P);if(re)re.onclick=()=>{closePanel();startPlan({edit:t.id});};
     const ag=$("#tAgain",P);if(ag)ag.onclick=async()=>{const n={id:uid(),status:"idee",src:"copy",art:t.art,name:t.name,dist:t.dist,up:t.up,down:t.down,emin:t.emin,emax:t.emax,note:t.note,rate:{},diff:t.diff,
         plan:{art:t.art,wps:line?[[line[0][0],line[0][1]],[line[line.length-1][0],line[line.length-1][1]]].map(p=>({lat:p[0],lon:p[1],mode:"luft"})):[]}};
       await saveTour(n,line?line.map(p=>[p[0],p[1],p[2],null]):null);toast("Als Idee gespeichert");showTour(n.id,true);};
     $("#tGpx",P).onclick=async()=>{const L=await tourLine(t.id);if(!L)return toast("Linie fehlt (noch nicht abgeglichen?)");
       const wp=along.map(x=>({lat:x.p.lat,lon:x.p.lon,ele:x.p.hoehe,name:x.p.name}));download(`${fileSafe(t.name)}.gpx`,toGPX(t.name,L,wp),"application/gpx+xml");};
     $("#tCond",P).onclick=()=>{const top=prof.length?prof.reduce((m,p)=>p.h>m.h?p:m,prof[0]):null;const c=top||{lat:(t.bbox[0]+t.bbox[2])/2,lon:(t.bbox[1]+t.bbox[3])/2,h:t.emax};openPanel(()=>conditionsPanel(c.lat,c.lon,c.h,t.name));};
     $("#tChk",P).onclick=()=>openPanel(()=>checklistPanel(t.art));
     const rw=$("#tRaw",P);if(rw)rw.onclick=async()=>{const r=await getOne("raw",t.id);const g=parseGPX(r.gpx);S._selLine=g.pts.map(p=>[p[0],p[1]]);map.render();
       const st=trackStats(g.pts,g.pts.some(p=>p[3]));toast(`Original: ${fmtKm(st.dist)}, ↑${fmtN(st.up)} m, ${fmtDur(st.moving)} in Bewegung`,5000);};
     $("#tDel",P).onclick=async()=>{if(!confirm(`Tour «${t.name}» löschen?`))return;t.del=Date.now();await saveTour(t);selTour=null;closePanel();toast("Gelöscht");};
     $$("[data-p]",P).forEach(b=>b.onclick=()=>showPoint(b.dataset.p));}};}
function editTourPanel(t){const sc=SCALES[t.art]||[];return {title:"Tour bearbeiten",html:`<div class="card">
   <label class="f">Name</label><input class="inp" id="eN" value="${esc(t.name)}"><label class="f">Art</label><select class="inp" id="eA">${artOpts(t.art)}</select>
   <label class="f">Status</label><select class="inp" id="eS"><option value="gemacht"${t.status==="gemacht"?" selected":""}>Gemacht</option><option value="idee"${t.status==="idee"?" selected":""}>Idee</option></select>
   <label class="f">Datum</label><input type="date" class="inp" id="eD" value="${esc(t.date||"")}">
   <label class="f">Schwierigkeit</label><select class="inp" id="eF"><option value="">–</option>${Object.values(SCALES).flat().filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<option${v===t.diff?" selected":""}>${v}</option>`).join("")}</select>
   <label class="f">Notiz</label><textarea class="inp" id="eT">${esc(t.note||"")}</textarea></div><button class="btn pri full" id="eOk"><svg><use href="#i-check"/></svg>Speichern</button>`,
   after(P){const fill=()=>{const s=SCALES[$("#eA",P).value]||[];const cur=$("#eF",P).value;$("#eF",P).innerHTML=`<option value="">–</option>`+s.map(v=>`<option${v===cur?" selected":""}>${v}</option>`).join("");};fill();$("#eA",P).onchange=fill;
     $("#eOk",P).onclick=async()=>{t.name=$("#eN",P).value.trim()||t.name;t.art=$("#eA",P).value;t.status=$("#eS",P).value;t.date=$("#eD",P).value||t.date;t.diff=$("#eF",P).value;t.note=$("#eT",P).value.trim();
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
    c.beginPath();prof.forEach((p,i)=>i?c.lineTo(X(p.d),Y(p.h)):c.moveTo(X(p.d),Y(p.h)));c.strokeStyle="#1f3a52";c.lineWidth=2;c.stroke();
    if(sel){c.strokeStyle="#c8102e";c.lineWidth=1.5;c.beginPath();c.moveTo(X(sel.d),T);c.lineTo(X(sel.d),H-B);c.stroke();c.beginPath();c.arc(X(sel.d),Y(sel.h),4,0,7);c.fillStyle="#c8102e";c.fill();}};
  draw();const pick=e=>{const r=cv.getBoundingClientRect();const d=Math.max(0,Math.min(D,(e.clientX-r.left-L)/(W-L-R)*D));let b=prof[0];for(const p of prof)if(Math.abs(p.d-d)<Math.abs(b.d-d))b=p;
    draw(b);if(o.info)o.info.textContent=`${fmtKm(b.d)} · ${fmtN(b.h)} m ü. M.`;if(b.lat!=null){if(!profMk)profMk=map.addMarker({lat:b.lat,lon:b.lon,anchor:[7,7],html:`<div class="prof-dot"></div>`,z:60});else map.moveMarker(profMk,b.lat,b.lon);}};
  cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);pick(e);};cv.onpointermove=e=>{if(e.pointerType==="mouse"||e.buttons)pick(e);};}

/* ---------- Planung wie bei SchweizMobil: antippen, Linie folgt dem Weg, Höhenprofil und Zeit laufend ---------- */
let planState=null;const routeCache=new Map();
function planEntry(){if(planState){openPanel(planPanel,{half:true});return;}startPlan({});}
async function startPlan(o){if(placing)endPlace();closePanel();selTour=null;
  const art=o.art||ls("planArt")||"wandern";planState={art,mode:ARTS[art].prof?"weg":"luft",wps:[],segs:[],editId:null,prof:null,busy:0,undo:[]};
  if(o.edit){const t=S.tours.find(x=>x.id===o.edit);if(t){planState.editId=t.id;planState.art=t.art;planState.name=t.name;
      if(t.plan&&t.plan.wps&&t.plan.wps.length){planState.wps=t.plan.wps.map(w=>Object.assign({},w));}
      else if(t.disp){const L=t.disp;planState.wps=[{lat:L[0][0],lon:L[0][1],mode:"luft"},{lat:L[L.length-1][0],lon:L[L.length-1][1],mode:"luft"}];}
      const line=await tourLine(t.id);if(line&&t.plan&&t.plan.segs)planState.segs=t.plan.segs;}}
  if(o.start)planState.wps.push({lat:o.start[0],lon:o.start[1],mode:planState.mode,pid:o.pid});
  if(o.end)planState.wps.push({lat:o.end[0],lon:o.end[1],mode:planState.mode});
  $$("#bar button").forEach(x=>x.classList.toggle("on",x.dataset.go==="plan"));
  planBar();miscDraw.push(drawPlan);await planRoute();openPanel(planPanel,{half:true});
  if(!planState.wps.length)toast("Startpunkt auf der Karte antippen",3500);}
function planBar(){const ps=planState;if(!ps)return modebar(null);
  modebar(`<select class="inp" id="plA" style="min-height:36px;padding:4px 6px">${artOpts(ps.art)}</select>
   <button class="chip${ps.mode==="weg"?" on":""}" id="plW"${ARTS[ps.art].prof?"":" disabled"}>am Weg</button><button class="chip${ps.mode==="luft"?" on":""}" id="plL">Luftlinie</button>
   <span class="grow"></span><button class="btn sm" id="plU" aria-label="Rückgängig"><svg><use href="#i-undo"/></svg></button><button class="btn sm" id="plX">Beenden</button>`);
  $("#plA").onchange=async e=>{ps.art=e.target.value;ls("planArt",ps.art);if(!ARTS[ps.art].prof)ps.mode="luft";else if(ps.mode==="luft"&&!ps.wps.length)ps.mode="weg";
    for(const w of ps.wps)if(w.mode==="weg"||!ARTS[ps.art].prof)w.mode=ARTS[ps.art].prof?w.mode:"luft";ps.segs=[];planBar();await planRoute();refreshPlanPanel();};
  $("#plW").onclick=()=>{ps.mode="weg";planBar();};$("#plL").onclick=()=>{ps.mode="luft";planBar();};
  $("#plU").onclick=async()=>{const u=ps.undo.pop();if(!u)return;ps.wps=u;ps.segs=[];await planRoute();refreshPlanPanel();};
  $("#plX").onclick=()=>{if(ps.wps.length>1&&!confirm("Planung beenden ohne zu speichern?"))return;endPlan();};}
function endPlan(){if(!planState)return;for(const w of planState.wps)if(w.mk)map.removeMarker(w.mk);miscDraw=miscDraw.filter(f=>f!==drawPlan);planState=null;modebar(null);closePanel();map.render();removeProfDot();}
const snap=()=>planState.undo.push(planState.wps.map(w=>({lat:w.lat,lon:w.lon,mode:w.mode,pid:w.pid})));
async function planClick(e){const ps=planState;if(!ps||ps.busy>3)return;
  /* auf die Linie getippt → Zwischenpunkt einfügen */
  if(!e.pid&&ps.wps.length>1&&e.x!=null){let best=null;for(let i=0;i<ps.segs.length;i++){const L=ps.segs[i]||[];for(let k=1;k<L.length;k++){const a=map.project(L[k-1][0],L[k-1][1]),b=map.project(L[k][0],L[k][1]);const d=segPx(e.x,e.y,a,b);if(d<12&&(!best||d<best.d))best={i,d};}}
    if(best){snap();ps.wps.splice(best.i+1,0,{lat:e.lat,lon:e.lon,mode:ps.wps[best.i+1].mode});ps.segs.splice(best.i,1,null,null);await planRoute();refreshPlanPanel();return;}}
  snap();ps.wps.push({lat:e.lat,lon:e.lon,mode:ps.mode,pid:e.pid});await planRoute();refreshPlanPanel();}
function planMarkers(){const ps=planState;for(const w of ps.wps)if(w.mk){map.removeMarker(w.mk);w.mk=null;}
  ps.wps.forEach((w,i)=>{const last=i===ps.wps.length-1&&i>0;const m=map.addMarker({lat:w.lat,lon:w.lon,anchor:[11,11],drag:true,z:70,html:`<div class="wp${i===0?" s":last?" e":""}">${i===0?"S":last?"Z":i}</div>`});m.wp=w;w.mk=m;
    m.onClick=()=>toast("Punkt verschieben: ziehen · entfernen: lange drücken",3000);});}
function routeKey(a,b,prof){return `${prof}|${a.lat.toFixed(5)},${a.lon.toFixed(5)}|${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;}
async function routeSeg(a,b,mode,art){const prof=ARTS[art].prof;if(mode==="luft"||!prof)return [[a.lat,a.lon,null],[b.lat,b.lon,null]];const k=routeKey(a,b,prof);if(routeCache.has(k))return routeCache.get(k);
  if(!navigator.onLine)throw new Error("offline");const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),30000);
  try{const r=await fetch(`https://brouter.de/brouter?lonlats=${a.lon.toFixed(6)},${a.lat.toFixed(6)}|${b.lon.toFixed(6)},${b.lat.toFixed(6)}&profile=${prof}&alternativeidx=0&format=geojson`,{signal:ctl.signal});
    const tx=await r.text();if(!r.ok)throw new Error(tx.slice(0,120));const g=JSON.parse(tx);const c=g.features[0].geometry.coordinates;const L=c.map(p=>[p[1],p[0],p[2]!=null?p[2]:null]);
    L[0]=[a.lat,a.lon,L[0][2]];L[L.length-1]=[b.lat,b.lon,L[L.length-1][2]];routeCache.set(k,L);return L;}finally{clearTimeout(tm);}}
async function planRoute(){const ps=planState;if(!ps)return;ps.busy++;planMarkers();map.render();
  try{const n=ps.wps.length;const segs=[];let fail=0;
    for(let i=1;i<n;i++){const a=ps.wps[i-1],b=ps.wps[i];const old=ps.segs[i-1];
      if(old&&old.length>1&&Math.abs(old[0][0]-a.lat)<1e-7&&Math.abs(old[old.length-1][0]-b.lat)<1e-7&&Math.abs(old[0][1]-a.lon)<1e-7&&Math.abs(old[old.length-1][1]-b.lon)<1e-7&&old._m===b.mode){segs.push(old);continue;}
      let L;try{L=await routeSeg(a,b,b.mode,ps.art);}catch(e){fail++;L=[[a.lat,a.lon,null],[b.lat,b.lon,null]];}L._m=b.mode;segs.push(L);}
    if(planState!==ps)return;ps.segs=segs;if(fail)toast(navigator.onLine?"Für einen Abschnitt kein Weg gefunden – Luftlinie":"Offline: Abschnitte als Luftlinie",3500);
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
    c.lineJoin=c.lineCap="round";c.setLineDash([]);c.strokeStyle="#fff";c.lineWidth=8;c.stroke();c.strokeStyle=col;c.lineWidth=4.5;if(L._m==="luft")c.setLineDash([10,8]);c.stroke();c.setLineDash([]);});}
function refreshPlanPanel(){if(nav.length&&nav[nav.length-1].fn===planPanel)refreshPanel();else if(planState&&!nav.length)openPanel(planPanel,{half:true});}
function planPanel(){const ps=planState;if(!ps)return {title:"Planen",html:`<div class="empty">Keine Planung offen</div>`};const t=tempoFor(ps.art);const fac=(S.settings.tempoFactor||{})[ps.art]||1;
  const est=ps.up!=null?estTime(ps.dist/1000,ps.up,ps.down,t):null;
  return {title:ps.editId?"Route ändern":"Tour planen",icon:`<svg><use href="#i-flag"/></svg>`,half:true,html:`
   ${ps.wps.length<2?`<div class="note">Punkte der Reihe nach auf der Karte antippen. Die Linie folgt ${ARTS[ps.art].prof?"den Wegen (Umschalten auf «Luftlinie» für Abschnitte abseits der Wege)":"als Luftlinie (Skitouren und Winterhochtouren verlaufen meist abseits der Wege)"}.<br>Punkte ziehen = verschieben · lange drücken = entfernen · auf die Linie tippen = Zwischenpunkt.</div>`:""}
   <div class="kv"><div><b>${fmtKm(ps.dist||0)}</b><small>Distanz</small></div><div><b>${ps.up!=null?fmtN(ps.up)+" m":"…"}</b><small>Aufstieg</small></div><div><b>${ps.down!=null?fmtN(ps.down)+" m":"…"}</b><small>Abstieg</small></div><div><b>${est!=null?fmtDur(est):"…"}</b><small>Zeit (dein Tempo)</small></div></div>
   ${ps.prof&&ps.prof.length>1?`<div class="card" style="margin-top:10px;padding:8px"><canvas class="prof" id="plProf"></canvas><div class="muted small" id="plProfI">Höhen: swissALTI3D</div></div>`:ps.wps.length>1?`<p class="muted small">${navigator.onLine?"Höhenprofil wird geladen …":"Höhenprofil nur online (swisstopo)"}</p>`:""}
   <div class="card"><div class="crit"><span>Tempo ${(fac*100).toFixed(0)} %<br><small class="muted">${fmtN(t.vf,1)} km/h · ↑${fmtN(t.vu)} · ↓${fmtN(t.vd)} Hm/h</small></span><input type="range" id="plF" min="60" max="150" step="5" value="${Math.round(fac*100)}" style="flex:1;max-width:180px"></div></div>
   <div class="btns"><button class="btn pri" id="plS"${ps.wps.length<2?" disabled":""}><svg><use href="#i-check"/></svg>Als Idee speichern</button><button class="btn" id="plG"${ps.wps.length<2?" disabled":""}><svg><use href="#i-down"/></svg>GPX</button>
    <button class="btn" id="plRev"${ps.wps.length<2?" disabled":""}>Umkehren</button><button class="btn" id="plZ"${ps.wps.length<2?" disabled":""}>Zurück zum Start</button></div>`,
   after(P){if(ps.prof&&ps.prof.length>1)drawProfile($("#plProf",P),ps.prof,{info:$("#plProfI",P)});
     $("#plF",P).onchange=async e=>{S.settings.tempoFactor=Object.assign({},S.settings.tempoFactor||{});S.settings.tempoFactor[ps.art]=+e.target.value/100;await saveSettings();refreshPanel();};
     $("#plRev",P).onclick=async()=>{snap();ps.wps.reverse();ps.segs=[];await planRoute();refreshPanel();};
     $("#plZ",P).onclick=async()=>{snap();const a=ps.wps[0];ps.wps.push({lat:a.lat,lon:a.lon,mode:ps.mode});await planRoute();refreshPanel();};
     $("#plG",P).onclick=()=>{const L=planLine();download(`${fileSafe(ps.name||"Planung")}.gpx`,toGPX(ps.name||"Boschor Map Planung",L.map(p=>[p[0],p[1],p[2],null])),"application/gpx+xml");};
     $("#plS",P).onclick=savePlan;}};}
async function savePlan(){const ps=planState;if(!ps||ps.wps.length<2)return;if(!ps.prof&&navigator.onLine){clearTimeout(ps.pt);toast("Höhenprofil wird geladen …");await planProfile();if(planState!==ps)return;}const def=ps.name||planName();const name=prompt("Name der Tour-Idee",def);if(name===null)return;
  const L=planLine();let line=L.map(p=>[p[0],p[1],p[2]!=null?p[2]:null,null]);
  if(ps.prof&&ps.prof.length>1){/* Höhen aus swissALTI3D auf die Linie übertragen */let d=0,j=0;line=line.map((p,i)=>{if(i)d+=distM(line[i-1][0],line[i-1][1],p[0],p[1]);const f=d/ps.dist*ps.prof[ps.prof.length-1].d;
      while(j<ps.prof.length-2&&ps.prof[j+1].d<f)j++;const a=ps.prof[j],b=ps.prof[j+1]||a;const h=b.d>a.d?a.h+(b.h-a.h)*(f-a.d)/(b.d-a.d):a.h;return [p[0],p[1],Math.round(h*10)/10,null];});}
  const old=ps.editId?S.tours.find(x=>x.id===ps.editId):null;
  const hs=line.map(p=>p[2]).filter(v=>v!=null);
  const t=Object.assign(old||{id:uid(),status:"idee",rate:{},note:"",diff:""},{name:name.trim()||def,art:ps.art,src:"plan",dist:Math.round(ps.dist),up:ps.up||0,down:ps.down||0,
    emin:hs.length?Math.round(Math.min(...hs)):null,emax:hs.length?Math.round(Math.max(...hs)):null,prof:ps.prof?ps.prof.filter((p,i)=>i%2===0||i===ps.prof.length-1).map(p=>({d:Math.round(p.d),h:Math.round(p.h),lat:r5(p.lat),lon:r5(p.lon)})):null,
    plan:{art:ps.art,wps:ps.wps.map(w=>({lat:r5(w.lat),lon:r5(w.lon),mode:w.mode}))}});
  await saveTour(t,line);const id=t.id;endPlan();toast("Idee gespeichert");showTour(id);}
function planName(){const ps=planState;const near=(w)=>{let b=null;for(const p of S.points){if(p.del)continue;const d=distM(w.lat,w.lon,p.lat,p.lon);if(d<300&&(!b||d<b.d))b={p,d};}return b&&b.p.name;};
  const a=near(ps.wps[0]),top=ps.prof?ps.prof.reduce((m,p)=>p.h>m.h?p:m,ps.prof[0]):null;const z=top?near(top):near(ps.wps[ps.wps.length-1]);
  return z?(a&&a!==z?`${a} – ${z}`:z):`${ARTS[ps.art].n} ${fmtDate(today())}`;}
/* Wegpunkte verschieben und entfernen */
function bootPlanEvents(){map.on("markerdragstart",e=>{if(e.marker.wp&&planState)snap();});
  map.on("markerdragend",async e=>{const w=e.marker.wp;if(!w||!planState)return;w.lat=e.lat;w.lon=e.lon;await planRoute();refreshPlanPanel();});
  map.on("markerlong",async e=>{const w=e.marker.wp;if(!w||!planState)return;snap();const i=planState.wps.indexOf(w);if(i<0)return;map.removeMarker(w.mk);planState.wps.splice(i,1);planState.segs=[];await planRoute();refreshPlanPanel();});}

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
  return {title:"Ideen",icon:`<svg><use href="#i-idea"/></svg>`,html:`
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
       const parts=[];if(b&&b.level)parts.push(`Lawinengefahr ${b.level}${b.sub||""}`);if(w){for(const d of sat){const day=w.days.find(z=>z.date===d.date);if(day)parts.push(`${d.n}: ${fmtN(day.tn)}…${fmtN(day.tx)}°, ${fmtN(day.rr,1)} mm`);}}
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
