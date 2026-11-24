/* BoschorMap – Verwaltung am PC: sortierbare, filterbare Tabelle mit direktem Bearbeiten, Mehrfachauswahl und CSV */
"use strict";
let adm={tab:"tours",sort:"date",dir:-1,q:"",f:"",st:"",sel:new Set()};
function showAdmin(){closePanel();let w=$(".tbl-wrap");if(!w){w=document.createElement("div");w.className="tbl-wrap";document.body.appendChild(w);}renderAdmin();}
function admCols(){return adm.tab==="points"?[
   {k:"name",n:"Name",ed:"text"},{k:"cat",n:"Kategorie",ed:"cat"},{k:"hoehe",n:"Höhe",ed:"num",num:1},{k:"_vis",n:"Besuche",v:p=>(p.visits||[]).length,num:1},
   {k:"_last",n:"Zuletzt",v:p=>(p.visits||[]).map(v=>v.d).sort().pop()||""},{k:"_r",n:"Bewertung",v:p=>(p.rate||{}).gesamt||"",ed:"rate",num:1},
   {k:"_ph",n:"Fotos",v:p=>(p.photos||[]).length,num:1},{k:"note",n:"Notiz",ed:"text"},{k:"_ll",n:"Koordinaten",v:p=>p.lat.toFixed(5)+", "+p.lon.toFixed(5)}]:[
   {k:"name",n:"Name",ed:"text"},{k:"art",n:"Art",ed:"art"},{k:"status",n:"Status",ed:"status"},{k:"date",n:"Datum",ed:"date"},
   {k:"_km",n:"km",v:t=>(t.dist||0)/1000,num:1,fmt:v=>fmtN(v,1)},{k:"up",n:"Aufstieg",num:1},{k:"down",n:"Abstieg",num:1},
   {k:"_t",n:"Zeit",v:t=>t.status==="gemacht"?t.moving||0:estFor(t),num:1,fmt:v=>fmtDur(v)},{k:"emax",n:"Höchster Punkt",num:1},
   {k:"diff",n:"Schwierigkeit",ed:"text"},{k:"_r",n:"Gesamt",v:t=>(t.rate||{}).gesamt||"",ed:"rate",num:1},{k:"_s",n:"Streng",v:t=>(t.rate||{}).streng||"",ed:"rate",num:1},
   {k:"_sch",n:"Schön",v:t=>(t.rate||{}).schoen||"",ed:"rate",num:1},{k:"note",n:"Notiz",ed:"text"}];}
const cellV=(c,x)=>c.v?c.v(x):x[c.k];
function admRows(){const src=adm.tab==="points"?S.points:S.tours;const q=adm.q.toLowerCase();
  let L=src.filter(x=>!x.del&&(!q||(x.name+" "+(x.note||"")).toLowerCase().includes(q))&&(!adm.f||(adm.tab==="points"?x.cat:x.art)===adm.f)&&(!adm.st||(adm.tab==="points"?(adm.st==="oben"?pointDone(x):x.cat==="gipfel"&&!pointDone(x)):x.status===adm.st)));
  const c=admCols().find(c=>c.k===adm.sort)||admCols()[0];L.sort((a,b)=>{const va=cellV(c,a),vb=cellV(c,b);if(c.num)return ((+va||0)-(+vb||0))*adm.dir;return String(va||"").localeCompare(String(vb||""),"de")*adm.dir;});return L;}
function renderAdmin(){const w=$(".tbl-wrap");if(!w)return;const cols=admCols(),L=admRows();const pts=adm.tab==="points";
  const tot=pts?null:L.reduce((s,t)=>{s.km+=(t.dist||0)/1000;s.up+=t.up||0;s.down+=t.down||0;s.t+=t.status==="gemacht"?t.moving||0:0;return s;},{km:0,up:0,down:0,t:0});
  const edit=(c,x)=>{const v=cellV(c,x);const id=x.id;
    if(c.ed==="text")return `<input data-e="${c.k}" data-id="${id}" value="${esc(v||"")}">`;
    if(c.ed==="num")return `<input data-e="${c.k}" data-id="${id}" inputmode="numeric" value="${v!=null?v:""}">`;
    if(c.ed==="date")return `<input type="date" data-e="${c.k}" data-id="${id}" value="${esc(v||"")}">`;
    if(c.ed==="rate")return `<select data-e="${c.k}" data-id="${id}">${["","1","2","3","4","5"].map(o=>`<option${String(v)===o?" selected":""}>${o}</option>`).join("")}</select>`;
    if(c.ed==="cat")return `<select data-e="cat" data-id="${id}">${Object.entries(CATS).map(([k,o])=>`<option value="${k}"${k===v?" selected":""}>${o.n}</option>`).join("")}</select>`;
    if(c.ed==="art")return `<select data-e="art" data-id="${id}">${artOpts(v)}</select>`;
    if(c.ed==="status")return `<select data-e="status" data-id="${id}"><option value="gemacht"${v==="gemacht"?" selected":""}>Gemacht</option><option value="idee"${v==="idee"?" selected":""}>Idee</option></select>`;
    return esc(c.fmt?c.fmt(v):c.num&&v!==""&&v!=null?fmtN(v):v==null?"":v);};
  w.innerHTML=`<div class="tbl-top"><svg class="logo"><use href="#i-logo"/></svg><b style="font-size:17px">BoschorMap – Verwaltung</b><span class="grow" style="flex:1"></span>
    <button class="chip${!pts?" on":""}" data-tab="tours">Touren</button><button class="chip${pts?" on":""}" data-tab="points">Orte</button><button class="btn sm" id="aX">Schliessen</button></div>
   <div class="tbl-tools"><input class="inp" id="aQ" placeholder="Suchen …" value="${esc(adm.q)}" style="max-width:220px">
    <select class="inp" id="aF" style="width:auto"><option value="">${pts?"Alle Kategorien":"Alle Arten"}</option>${(pts?Object.entries(CATS):Object.entries(ARTS)).map(([k,o])=>`<option value="${k}"${adm.f===k?" selected":""}>${o.n}</option>`).join("")}</select>
    <select class="inp" id="aS" style="width:auto">${pts?`<option value="">Alle</option><option value="oben"${adm.st==="oben"?" selected":""}>Gipfel oben</option><option value="offen"${adm.st==="offen"?" selected":""}>Gipfel offen</option>`:`<option value="">Gemacht und Ideen</option><option value="gemacht"${adm.st==="gemacht"?" selected":""}>Gemacht</option><option value="idee"${adm.st==="idee"?" selected":""}>Ideen</option>`}</select>
    <span class="muted">${fmtN(L.length)} Einträge${adm.sel.size?` · ${adm.sel.size} ausgewählt`:""}</span><span style="flex:1"></span>
    ${adm.sel.size?`<select class="inp" id="aBulk" style="width:auto"><option value="">Für Auswahl …</option>${pts?Object.entries(CATS).map(([k,o])=>`<option value="cat:${k}">Kategorie: ${o.n}</option>`).join(""):Object.entries(ARTS).map(([k,o])=>`<option value="art:${k}">Art: ${o.n}</option>`).join("")+`<option value="status:idee">Status: Idee</option><option value="status:gemacht">Status: Gemacht</option>`}<option value="del">Löschen (Papierkorb)</option></select>`:""}
    <button class="btn sm" id="aCsv"><svg><use href="#i-down"/></svg>CSV für Google Tabellen</button></div>
   <div class="tbl-sc"><table class="adm"><thead><tr><th><input type="checkbox" id="aAll"${adm.sel.size&&adm.sel.size===L.length?" checked":""}></th>${cols.map(c=>`<th data-s="${c.k}">${c.n}${adm.sort===c.k?(adm.dir>0?" ▲":" ▼"):""}</th>`).join("")}<th></th></tr></thead>
    <tbody>${L.map(x=>`<tr class="${adm.sel.has(x.id)?"sel":""}"><td><input type="checkbox" data-sel="${x.id}"${adm.sel.has(x.id)?" checked":""}></td>${cols.map(c=>`<td class="${c.num?"num":""}">${edit(c,x)}</td>`).join("")}<td><button class="btn sm" data-map="${x.id}">Karte</button></td></tr>`).join("")}</tbody>
    ${tot?`<tfoot><tr><td></td><td>Summe</td><td></td><td></td><td></td><td class="num">${fmtN(tot.km,1)}</td><td class="num">${fmtN(tot.up)}</td><td class="num">${fmtN(tot.down)}</td><td class="num">${fmtDur(tot.t)}</td><td colspan="7"></td></tr></tfoot>`:""}</table></div>`;
  $("#aX",w).onclick=()=>{w.remove();if(location.search.includes("admin"))history.replaceState(null,"",location.pathname);};
  $$("[data-tab]",w).forEach(b=>b.onclick=()=>{adm.tab=b.dataset.tab;adm.f="";adm.st="";adm.sel.clear();adm.sort=adm.tab==="points"?"name":"date";adm.dir=adm.tab==="points"?1:-1;renderAdmin();});
  let tm;$("#aQ",w).oninput=e=>{clearTimeout(tm);tm=setTimeout(()=>{adm.q=e.target.value;renderAdmin();const q=$("#aQ");q.focus();q.setSelectionRange(q.value.length,q.value.length);},300);};
  $("#aF",w).onchange=e=>{adm.f=e.target.value;renderAdmin();};$("#aS",w).onchange=e=>{adm.st=e.target.value;renderAdmin();};
  $$("th[data-s]",w).forEach(th=>th.onclick=()=>{if(adm.sort===th.dataset.s)adm.dir*=-1;else{adm.sort=th.dataset.s;adm.dir=1;}renderAdmin();});
  $("#aAll",w).onchange=e=>{if(e.target.checked)L.forEach(x=>adm.sel.add(x.id));else adm.sel.clear();renderAdmin();};
  $$("[data-sel]",w).forEach(c=>c.onchange=()=>{if(c.checked)adm.sel.add(c.dataset.sel);else adm.sel.delete(c.dataset.sel);renderAdmin();});
  $$("[data-map]",w).forEach(b=>b.onclick=()=>{w.remove();if(pts)showPoint(b.dataset.map);else showTour(b.dataset.map);});
  $$("[data-e]",w).forEach(inp=>inp.onchange=async()=>{const x=(pts?S.points:S.tours).find(o=>o.id===inp.dataset.id);if(!x)return;const k=inp.dataset.e;let v=inp.value;
    if(k==="hoehe"){const n=parseFloat(v);x.hoehe=isFinite(n)?Math.round(n):null;x.hq="hand";}
    else if(k==="_r"||k==="_s"||k==="_sch"){x.rate=Object.assign({},x.rate||{});x.rate[{_r:"gesamt",_s:"streng",_sch:"schoen"}[k]]=+v||0;}
    else x[k]=v;if(pts)await savePoint(x);else await saveTour(x);inp.closest("td").style.background="#e8f5e9";setTimeout(()=>{if(inp.closest("td"))inp.closest("td").style.background="";},700);});
  const bk=$("#aBulk",w);if(bk)bk.onchange=async()=>{const v=bk.value;if(!v)return;const arr=(pts?S.points:S.tours).filter(x=>adm.sel.has(x.id));
    if(v==="del"&&!confirm(`${arr.length} Einträge löschen? (30 Tage im Papierkorb)`)){bk.value="";return;}
    for(const x of arr){if(v==="del")x.del=Date.now();else{const [k,val]=v.split(":");x[k]=val;}if(pts)await savePoint(x);else await saveTour(x);}adm.sel.clear();renderAdmin();toast("Geändert");};
  $("#aCsv",w).onclick=()=>{const q=s=>{s=String(s==null?"":s);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
    const head=cols.map(c=>c.n).concat(pts?["Breite","Länge"]:[]);const rows=L.map(x=>cols.map(c=>{let v=cellV(c,x);if(c.k==="cat")v=CATS[v].n;if(c.k==="art")v=ARTS[v].n;if(c.k==="_km")v=(+v).toFixed(2);if(c.k==="_t")v=Math.round(v/60);return q(v);}).concat(pts?[x.lat.toFixed(6),x.lon.toFixed(6)]:[]).join(","));
    if(!pts)head[cols.findIndex(c=>c.k==="_t")]="Zeit (min)";download(`BoschorMap_${pts?"Orte":"Touren"}_${today()}.csv`,"﻿"+[head.map(q).join(",")].concat(rows).join("\n"),"text/csv");};}
