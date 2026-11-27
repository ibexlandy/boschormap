/* ---------- Routen-Check: Lawinen (steile Hänge × Bulletin) und Schutzgebiete (Wildruhezonen, Jagdbanngebiete) ----------
   Entscheidungshilfe, ersetzt die eigene Beurteilung im Gelände nicht. */
const HANG_ID="ch.swisstopo.hangneigung-ueber_30",HANG_Z=15;
/* Farben der swisstopo-Ebene «Hangneigung über 30°» → Klassen */
const HANG_CL=[{n:"30–35°",rgb:[240,224,0]},{n:"35–40°",rgb:[240,96,32]},{n:"40–45°",rgb:[208,0,80]},{n:"über 45°",rgb:[192,128,176]}];
const ASP8=["N","NE","E","SE","S","SW","W","NW"],ASP_DE={N:"N",NE:"NO",E:"O",SE:"SO",S:"S",SW:"SW",W:"W",NW:"NW"};
const tilePx=new Map();
async function hangTile(x,y){const k=`${x}/${y}`;if(tilePx.has(k))return tilePx.get(k);
  let px=null;try{const r=await fetch(`https://wmts.geo.admin.ch/1.0.0/${HANG_ID}/default/current/3857/${HANG_Z}/${x}/${y}.png`,{mode:"cors",credentials:"omit"});
    if(r.ok){const bm=await createImageBitmap(await r.blob());const c=document.createElement("canvas");c.width=bm.width;c.height=bm.height;const g=c.getContext("2d",{willReadFrequently:true});g.drawImage(bm,0,0);
      px={w:bm.width,d:g.getImageData(0,0,bm.width,bm.height).data};}}catch(e){}
  tilePx.set(k,px);if(tilePx.size>80)tilePx.delete(tilePx.keys().next().value);return px;}
/* Hangneigungs-Klasse an einem Punkt: -1 = unter 30°, null = unbekannt (keine Daten) */
async function hangAt(lat,lon){const n=2**HANG_Z,fx=(lon+180)/360*n,s=Math.log(Math.tan(lat*RAD)+1/Math.cos(lat*RAD)),fy=(1-s/Math.PI)/2*n;
  const t=await hangTile(Math.floor(fx),Math.floor(fy));if(!t)return null;let best=-1;
  /* kleines Fenster (3×3 px ≈ 10 m), damit ein Track knapp neben dem Hang nicht durchrutscht */
  const cx=Math.floor((fx%1)*t.w),cy=Math.floor((fy%1)*t.w);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=Math.min(t.w-1,Math.max(0,cx+dx)),Y=Math.min(t.w-1,Math.max(0,cy+dy)),i=(Y*t.w+X)*4;if(t.d[i+3]<60)continue;
    let k=-1,bd=1e9;HANG_CL.forEach((c,j)=>{const d=(t.d[i]-c.rgb[0])**2+(t.d[i+1]-c.rgb[1])**2+(t.d[i+2]-c.rgb[2])**2;if(d<bd){bd=d;k=j;}});if(bd<4000&&k>best)best=k;}
  return best;}
/* Exposition aus swissALTI3D: Höhen 30 m ringsum */
async function aspectAt(lat,lon){const m=30,dLat=m/111320,dLon=m/(111320*Math.cos(lat*RAD));
  const h=await Promise.all([heightAt(lat+dLat,lon),heightAt(lat-dLat,lon),heightAt(lat,lon+dLon),heightAt(lat,lon-dLon)]);if(h.some(v=>v==null))return null;
  const dzdx=(h[2]-h[3])/(2*m),dzdy=(h[0]-h[1])/(2*m);if(Math.hypot(dzdx,dzdy)<0.05)return null;
  const az=(Math.atan2(-dzdx,-dzdy)*180/Math.PI+360)%360;return ASP8[Math.round(az/45)%8];}
/* Steile Abschnitte entlang der Route (aus dem Profil mit lat/lon/h/d) */
/* Linie alle ~15 m abtasten, Höhe aus dem Profil (nach Distanz) interpolieren */
function densify(line,prof,step){step=step||15;const out=[];let d=0;const hAt=dd=>{if(!prof||!prof.length)return null;let lo=0,hi=prof.length-1;if(dd<=prof[0].d)return prof[0].h;if(dd>=prof[hi].d)return prof[hi].h;
    while(hi-lo>1){const m=(lo+hi)>>1;if(prof[m].d<=dd)lo=m;else hi=m;}const f=(dd-prof[lo].d)/((prof[hi].d-prof[lo].d)||1);return prof[lo].h+(prof[hi].h-prof[lo].h)*f;};
  for(let i=0;i<line.length;i++){if(i){const a=line[i-1],b=line[i];const L=distM(a[0],a[1],b[0],b[1]);const n=Math.floor(L/step);for(let k=1;k<=n;k++){const f=k*step/L;out.push({lat:a[0]+(b[0]-a[0])*f,lon:a[1]+(b[1]-a[1])*f,d:d+k*step});}d+=L;}
    out.push({lat:line[i][0],lon:line[i][1],d});}
  const tot=prof&&prof.length?prof[prof.length-1].d:d;const sc=d>0?tot/d:1;for(const p of out)p.h=hAt(p.d*sc);return out;}
async function steepSections(line,prof,onProg){const pts=densify(line,prof);const cls=[];let unknown=0;
  for(let i=0;i<pts.length;i++){if(onProg&&i%25===0)onProg(i,pts.length);const c=await hangAt(pts[i].lat,pts[i].lon);if(c==null)unknown++;cls.push(c==null?-1:c);}
  const runs=[];let cur=null;for(let i=0;i<pts.length;i++){if(cls[i]>=0){if(!cur){cur={i0:i,i1:i,max:cls[i]};runs.push(cur);}cur.i1=i;cur.max=Math.max(cur.max,cls[i]);}else if(cur&&i-cur.i1>1)cur=null;}
  return {runs:runs.map(r=>{const a=pts[r.i0],b=pts[r.i1],m=pts[Math.round((r.i0+r.i1)/2)];let hi=a;for(let i=r.i0;i<=r.i1;i++)if(pts[i].h>hi.h)hi=pts[i];
    return {d0:a.d,d1:b.d,len:Math.max(10,b.d-a.d),max:r.max,lat:m.lat,lon:m.lon,h:Math.round(m.h),hmin:Math.round(Math.min(a.h,b.h)),hmax:Math.round(hi.h),pts:pts.slice(r.i0,r.i1+1).map(p=>[p.lat,p.lon])};}),
    unknown:unknown>pts.length*0.5};}
function aspMatch(a,list){return !!a&&(list||[]).includes(a);}
function elevMatch(r,e){if(!e)return true;const lo=parseFloat(e.lowerBound),hi=parseFloat(e.upperBound);return (!isFinite(lo)||r.hmax>=lo)&&(!isFinite(hi)||r.hmin<=hi);}
/* Schutzgebiete entlang der Route */
async function zonesAlong(line){if(!navigator.onLine)return null;const L=line.length>180?simplify(line,25).slice(0,400):line;const path=L.map(p=>toLV95(p[0],p[1]).map(v=>Math.round(v)));
  const xs=path.map(p=>p[0]),ys=path.map(p=>p[1]);const ext=[Math.min(...xs)-500,Math.min(...ys)-500,Math.max(...xs)+500,Math.max(...ys)+500].join(",");const out=[];
  for(const [lay,typ] of [["ch.bafu.wrz-wildruhezonen_portal","Wildruhezone"],["ch.bafu.wrz-jagdbanngebiete_select","Jagdbanngebiet"],["ch.bafu.alpweiden-herdenschutzhunde","Alp mit Herdenschutzhunden"]]){
    const u=`https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometryType=esriGeometryPolyline&geometry=${encodeURIComponent(JSON.stringify({paths:[path]}))}&layers=all:${lay}&tolerance=0&sr=2056&returnGeometry=true&geometryFormat=geojson&lang=de&imageDisplay=500,500,96&mapExtent=${ext}&limit=20`;
    try{const r=await fetch(u);if(!r.ok)continue;const j=await r.json();for(const f of j.results||[]){const a=f.properties||f.attributes||{};const g=f.geometry;
      const rings=g&&g.type==="Polygon"?[g.coordinates[0]]:g&&g.type==="MultiPolygon"?g.coordinates.map(p=>p[0]):[];
      const hsh=/herdenschutz/.test(lay);const nm=a.wrz_name||a.jb_name||a.alpname||a.alp_name||a.alp||a.name||a.bezeichnung||a.label||f.label||typ;
      out.push({typ,hsh,name:hsh&&nm===typ?"Alp":nm,best:hsh?"Herdenschutzhunde bei der Herde: ruhig bleiben, vom Bike absteigen und schieben, Herde weiträumig umgehen, Hunde nicht füttern oder streicheln.":a.best_de||a.bestimmung_de||"",zeit:hsh?"":a.schutzzeit||"",kanton:a.kanton||"",
        rings:rings.map(rg=>(rg.length>300?rg.filter((_,i)=>i%Math.ceil(rg.length/300)===0):rg).map(c=>fromLV95(c[0],c[1])))});}}catch(e){}}
  return out;}
function inSeason(zeit){const m=(zeit||"").match(/(\d{1,2})\.(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.(\d{1,2})\./);if(!m)return null;const d=new Date(),v=(d.getMonth()+1)*100+d.getDate();
  const a=+m[2]*100+ +m[1],b=+m[4]*100+ +m[3];return a<=b?v>=a&&v<=b:v>=a||v<=b;}
/* Gesamter Check */
const checkMem=new Map();
async function routeCheck(key,prof,line,winter){if(checkMem.has(key))return checkMem.get(key);const res={t:Date.now(),winter};
  try{progress("Route prüfen",0,0,"Hangneigung entlang der Route …");
    if(winter&&prof&&prof.length>2){const st=await steepSections(line||prof.map(p=>[p.lat,p.lon]),prof,(i,n)=>progress("Route prüfen",i,n,"Hangneigung entlang der Route …"));res.steep=st.runs;res.unknown=st.unknown;
      const mid=prof[Math.floor(prof.length/2)];res.bul=mid&&mid.lat!=null?await bulletinAt(mid.lat,mid.lon):null;
      if(navigator.onLine)for(let i=0;i<res.steep.length&&i<20;i++){progress("Route prüfen",i,res.steep.length,"Exposition der steilen Hänge …");res.steep[i].asp=await aspectAt(res.steep[i].lat,res.steep[i].lon);}
      const ap=res.bul&&!res.bul.none&&!res.bul.stale?res.bul.ap.filter(a=>a.t!=="favourable_situation"&&a.t!=="no_distinct_avalanche_problem"):[];
      for(const r of res.steep){r.hits=ap.filter(a=>aspMatch(r.asp,a.asp)&&elevMatch(r,a.elev)).map(a=>PROB[a.t]||a.t);r.crit=r.hits.length>0;}}
    progress("Route prüfen",0,0,"Wildruhezonen und Jagdbanngebiete …");res.zones=await zonesAlong(line||prof.map(p=>[p.lat,p.lon]));}
  finally{progressDone();}checkMem.set(key,res);return res;}
function checkHTML(res){if(!res)return "";const z=res.zones;let h="";
  if(res.winter){const st=res.steep||[];const crit=st.filter(r=>r.crit);const b=res.bul;const lvl=b&&!b.none&&!b.stale?b.level:null;
    h+=`<div class="card"><h3><svg><use href="#i-shield"/></svg>Lawinen-Check</h3>
     ${!st.length?`<p style="margin:4px 0">${res.unknown?"Für diese Route fehlen Hangneigungsdaten (offline und Region ohne Ebene «Hangneigung»?).":"Keine Hänge über 30° direkt an der Route."}</p>`:
     `<p style="margin:4px 0"><b>${st.length} Hang${st.length>1?"abschnitte":"abschnitt"} über 30°</b> an der Route${lvl?`, davon <b style="color:${crit.length?"#c8102e":"inherit"}">${crit.length} in Exposition und Höhe der Lawinenprobleme</b> laut Bulletin (Stufe ${lvl}${b.sub||""})`:" – Bulletin nicht aktuell, Abgleich mit den Lawinenproblemen nicht möglich"}.</p>
      ${st.map((r,i)=>`<div class="q chk-r${r.crit?" crit":""}"><span class="hcl" style="background:rgb(${HANG_CL[r.max].rgb})">${HANG_CL[r.max].n}</span><span class="grow"><b>km ${fmtN(r.d0/1000,1)}–${fmtN(r.d1/1000,1)}</b> · ${fmtN(Math.round(r.len))} m · ${fmtN(r.hmin)}–${fmtN(r.hmax)} m${r.asp?` · Exposition ${ASP_DE[r.asp]}`:""}
        ${r.crit?`<br><small style="color:#c8102e">⚠ ${esc(r.hits.join(", "))}</small>`:""}</span><button class="btn sm" data-ck="${i}">Zeigen</button></div>`).join("")}
      <div class="btns" style="margin-top:8px"><button class="btn sm" id="ckAll">Alle auf der Karte</button></div>`}
     <p class="muted small" style="margin:8px 0 0">Hangneigung: swisstopo (Ebene «Hangneigung über 30°», ±10 m um die Linie). Exposition aus swissALTI3D. Entscheidungshilfe – ersetzt die eigene Beurteilung von Verhältnissen und Gelände nicht.</p></div>`;}
  h+=`<div class="card"><h3><svg><use href="#i-warn"/></svg>Schutzgebiete und Herdenschutz</h3>${z==null?`<p class="muted" style="margin:4px 0">Prüfung braucht Internet.</p>`:!z.length?`<p style="margin:4px 0">Die Route berührt keine Wildruhezone, kein Jagdbanngebiet und keine Alp mit Herdenschutzhunden.</p>`:
    z.map((x,i)=>{const s=x.hsh?inSeason("01.06. - 30.09."):inSeason(x.zeit);return `<div class="q"><span class="grow"><b>${esc(x.name)}</b> <small class="muted">${x.typ}${x.kanton?" · "+esc(x.kanton):""}</small><br>
     <small>${esc(x.best||"Bestimmungen beachten")}${x.hsh?` · Alpsaison ca. Juni–September${s?` · <b style="color:#c8102e">jetzt Alpsaison</b>`:" · zurzeit keine Alpsaison"}`:`${x.zeit?` · gilt ${esc(x.zeit)}`:""}${s===true?` · <b style="color:#c8102e">jetzt in Kraft</b>`:s===false?" · zurzeit nicht in Kraft":""}`}</small></span><button class="btn sm" data-zn="${i}">Zeigen</button></div>`;}).join("")}
    <p class="muted small" style="margin:8px 0 0">Quelle: BAFU / Kantone über geo.admin.ch. Massgebend sind die Signalisation vor Ort und die kantonalen Bestimmungen.</p></div>`;
  return h;}
function bindCheck(P,res){if(!res)return;const show=(runs,zones)=>{S._chk={runs:runs||[],zones:zones||[]};const all=[...(runs||[]).flatMap(r=>r.pts),...(zones||[]).flatMap(z=>z.rings.flat())];if(all.length)map.fitBounds(bboxOf(all),60,sheetPad(),sheetPadR());map.render();};
  $$("[data-ck]",P).forEach(b=>b.onclick=()=>show([res.steep[+b.dataset.ck]],[]));const a=$("#ckAll",P);if(a)a.onclick=()=>show(res.steep,[]);
  $$("[data-zn]",P).forEach(b=>b.onclick=()=>show([],[res.zones[+b.dataset.zn]]));}
function drawCheck(c,m){const k=S._chk;if(!k)return;c.lineCap="round";c.lineJoin="round";
  for(const z of k.zones)for(const rg of z.rings){c.beginPath();rg.forEach((q,i)=>{const p=m.project(q[0],q[1]);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.closePath();c.fillStyle="rgba(200,16,46,.14)";c.fill();c.strokeStyle="#c8102e";c.lineWidth=2;c.setLineDash([6,4]);c.stroke();c.setLineDash([]);}
  for(const r of k.runs){c.beginPath();r.pts.forEach((q,i)=>{const p=m.project(q[0],q[1]);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.strokeStyle="#fff";c.lineWidth=11;c.stroke();c.strokeStyle=r.crit?"#c8102e":`rgb(${HANG_CL[r.max].rgb})`;c.lineWidth=7;c.stroke();}}
/* Karte im Tour-/Planungsfenster: Knopf «Route prüfen», danach Ergebnis */
function checkCard(key,winter=true){const r=checkMem.get(key);return r?checkHTML(r):`<div class="card"><h3><svg><use href="#i-shield"/></svg>Route prüfen</h3><p class="muted" style="margin:4px 0 8px">${winter?"Lawinen-Check (steile Hänge × Lawinenbulletin) und ":""}Wildruhezonen/Jagdbanngebiete entlang der Route.</p><button class="btn" id="ckGo"><svg><use href="#i-shield"/></svg>Route prüfen</button></div>`;}
function bindCheckCard(P,key,getData){const r=checkMem.get(key);if(r)return bindCheck(P,r);const b=$("#ckGo",P);if(!b)return;
  b.onclick=async()=>{const d=await getData();if(!d)return toast("Route noch ohne Höhenprofil");try{await routeCheck(key,d.prof,d.line,d.winter);}catch(e){toast("Prüfung: "+e.message,5000);}refreshPanel();};}
