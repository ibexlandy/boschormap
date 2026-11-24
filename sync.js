/* BoschorMap – Google-Drive-Abgleich (appDataFolder, eigenes Konto), Sicherung, Papierkorb, Foto-Import */
"use strict";
const GD_SCOPE="https://www.googleapis.com/auth/drive.appdata",GD_DATA="bm_daten.json",GD_BC="boschormap-gauth";
let gdToken=null,gdExp=0,syncing=false,autoTm=0;
const gdClient=()=>ls("gclient")||"";
const GD_REDIRECT=()=>location.origin+location.pathname.replace(/index\.html$/,"");
/* Anmeldefenster: kommt dieses Fenster von Google zurück, Zugang an die App weitergeben und schliessen */
function gdPopupReturn(){const h=location.hash;if(!/access_token=|error=/.test(h))return false;const q=new URLSearchParams(h.slice(1));const pop=ls("gpopup")||"";if(!pop||q.get("state")!==pop)return false;
  const want=ls("gstate");ls("gpopup",null);ls("gstate",null);let msg;
  if(q.get("state")!==want)msg={err:"state"};else if(q.get("error"))msg={err:q.get("error")};
  else{const exp=Date.now()+(+q.get("expires_in")||3600)*1000;ls("gconn","1");msg={ok:1,tok:q.get("access_token"),exp};}
  msg.t=Date.now();try{new BroadcastChannel(GD_BC).postMessage(msg);}catch(e){}ls("gauthmsg",JSON.stringify(msg));history.replaceState(null,"",location.pathname);
  document.body.innerHTML=`<p style="font:16px system-ui;padding:24px">${msg.ok?"Angemeldet – dieses Fenster schliesst sich.":"Anmeldung nicht möglich – Fenster schliessen und in BoschorMap nochmals abgleichen."}</p>`;
  setTimeout(()=>{try{window.close();}catch(e){}},msg.ok?200:4000);return true;}
/* Zugriffs-Token nur für die laufende Sitzung halten (nicht dauerhaft im Gerätespeicher) */
function tokSave(tok,exp){try{tok?sessionStorage.setItem("bm_gtok",JSON.stringify({tok,exp})):sessionStorage.removeItem("bm_gtok");}catch(e){}}
function gdRestore(){ls("gtok",null);let t=null;try{t=JSON.parse(sessionStorage.getItem("bm_gtok")||"null");}catch(e){}if(t&&Date.now()<t.exp-60000){gdToken=t.tok;gdExp=t.exp;}}
function gdFromRedirect(){if(!/access_token=|error=/.test(location.hash))return false;const q=new URLSearchParams(location.hash.slice(1));history.replaceState(null,"",location.pathname+location.search);
  const want=ls("gstate");ls("gstate",null);if(!want||q.get("state")!==want){toast("Google-Anmeldung abgelehnt (nicht von diesem Gerät gestartet)",6000);return false;}
  if(q.get("error")){toast("Google-Anmeldung abgebrochen: "+q.get("error"),6000);return false;}
  gdToken=q.get("access_token");gdExp=Date.now()+(+q.get("expires_in")||3600)*1000;ls("gconn","1");tokSave(gdToken,gdExp);return true;}
const gdOk=()=>gdToken&&Date.now()<gdExp-60000;
function gdState(){const v=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");ls("gstate",v);return v;}
const standalone=()=>{try{return matchMedia("(display-mode: standalone)").matches;}catch(e){return false;}};
function gdUrl(st,prompt){const u=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search=new URLSearchParams(Object.assign({client_id:gdClient(),redirect_uri:GD_REDIRECT(),response_type:"token",scope:GD_SCOPE,include_granted_scopes:"true",state:st,prompt},ls("gmail")?{login_hint:ls("gmail")}:{})).toString();return u.toString();}
function popupWait(w){return new Promise((res,rej)=>{let done=false,bc=null;const t0=Date.now();
  const fin=m=>{if(done||!m||!m.t||m.t<t0)return;done=true;clearInterval(iv);ls("gauthmsg",null);try{bc&&bc.close();}catch(e){}if(m.ok&&m.tok){gdToken=m.tok;gdExp=m.exp;tokSave(m.tok,m.exp);}m.ok?res():rej(new Error(m.err||"abgebrochen"));};
  try{bc=new BroadcastChannel(GD_BC);bc.onmessage=e=>fin(e.data);}catch(e){}
  const iv=setInterval(()=>{fin(lsJ("gauthmsg",null));try{if(w.closed&&!done&&Date.now()-t0>1500)setTimeout(()=>{if(!done){done=true;clearInterval(iv);rej(new Error("Fenster geschlossen"));}},1200);}catch(e){}
    if(Date.now()-t0>180000&&!done){done=true;clearInterval(iv);rej(new Error("Zeit abgelaufen"));}},500);});}
async function gdAuth(force){if(!force&&gdOk())return gdToken;if(!gdClient())throw new Error("Google Drive ist noch nicht eingerichtet (Mehr › Google Drive)");
  if(!force&&!standalone()){const st=gdState();ls("gpopup",st);const w=window.open(gdUrl(st,ls("gconn")?"none":"select_account"),"bmgauth","popup,width=500,height=650");
    if(w){toast("Google-Anmeldung …",4000);try{await popupWait(w);gdRestore();if(gdOk())return gdToken;}catch(e){ls("gpopup",null);if(!/interaction_required|login_required|consent_required/.test(e.message))throw new Error("Anmeldung nicht abgeschlossen ("+e.message+")");}}else ls("gpopup",null);}
  toast("Weiter zur Google-Anmeldung …",4000);try{sessionStorage.setItem("bm_after_login","sync");}catch(e){}location.href=gdUrl(gdState(),ls("gconn")&&!force?"none":"select_account");return new Promise(()=>{});}
async function gd(path,opt){const t=await gdAuth();const r=await fetch("https://www.googleapis.com/"+path,Object.assign({},opt||{},{headers:Object.assign({Authorization:"Bearer "+t},(opt||{}).headers||{})}));
  if(r.status===401){gdToken=null;tokSave(null);throw new Error("Anmeldung abgelaufen – nochmals abgleichen");}if(!r.ok)throw new Error("Google Drive: Fehler "+r.status);return r;}
async function gdList(){let out=[],pt="";do{const r=await(await gd(`drive/v3/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,size,appProperties,modifiedTime)${pt?"&pageToken="+encodeURIComponent(pt):""}`)).json();out=out.concat(r.files||[]);pt=r.nextPageToken||"";}while(pt);return out;}
async function gdUpload(name,blob,id,props){const fd=new FormData();const md=id?{}:{name,parents:["appDataFolder"]};if(props)md.appProperties=props;
  fd.append("metadata",new Blob([JSON.stringify(md)],{type:"application/json"}));fd.append("file",blob);await gd(`upload/drive/v3/files${id?"/"+id:""}?uploadType=multipart`,{method:id?"PATCH":"POST",body:fd});}
const gdGet=id=>gd(`drive/v3/files/${id}?alt=media`).then(r=>r.blob());
const gdDel=id=>gd(`drive/v3/files/${id}`,{method:"DELETE"}).catch(()=>{});

function markDirty(){ls("dirty","1");$("#bSync").classList.add("pending");if(ls("autosync")!=="0"&&gdOk()&&navigator.onLine){clearTimeout(autoTm);autoTm=setTimeout(()=>syncDrive(true),20000);}}
function gdBoot(){const b=$("#bSync");b.hidden=!gdClient();if(ls("dirty"))b.classList.add("pending");b.onclick=()=>syncDrive(false);
  gdRestore();const fresh=gdFromRedirect();let after=false;try{after=!!sessionStorage.getItem("bm_after_login");sessionStorage.removeItem("bm_after_login");}catch(e){}
  if((fresh||after)&&gdOk())setTimeout(()=>syncDrive(false),500);else if(gdOk()&&navigator.onLine&&ls("autosync")!=="0")setTimeout(()=>syncDrive(true),3000);
  window.addEventListener("online",()=>{if(ls("dirty")&&gdOk()&&ls("autosync")!=="0")setTimeout(()=>syncDrive(true),3000);});}

/* ---------- Abgleich ---------- */
const stripTour=t=>{const o=Object.assign({},t);delete o.disp;return o;};
function mergeArr(loc,rem){const m=new Map(loc.map(x=>[x.id,x]));const changed=[];for(const r of rem||[]){const l=m.get(r.id);if(!l||(r.mod||0)>(l.mod||0)){changed.push(r);m.set(r.id,r);}}return {all:[...m.values()],changed};}
async function syncDrive(quiet){if(syncing)return;if(!gdClient()){if(!quiet)openPanel(drivePanel);return;}if(!navigator.onLine){if(!quiet)toast("Kein Internet");return;}
  syncing=true;const btn=$("#bSync");btn.classList.add("spin");const P=(s,n,N)=>{if(!quiet)progress("Abgleich mit Google Drive",n||0,N||0,s);};
  try{P("Anmeldung …");await gdAuth();if(!ls("gmail")){try{const a=await(await gd("drive/v3/about?fields=user(emailAddress)")).json();if(a.user)ls("gmail",a.user.emailAddress);}catch(e){}}
    P("Dateien auf Drive lesen …");let files=await gdList();const byName=new Map(files.map(f=>[f.name,f]));
    /* 1. Daten (Orte, Touren, Einstellungen) zusammenführen – neuere Änderung gewinnt */
    const df=byName.get(GD_DATA);let rem=null;if(df){P("Daten laden …");rem=JSON.parse(await gunzip(await gdGet(df.id)));}
    if(rem&&rem.app==="boschormap"){const mp=mergeArr(S.points,rem.points);if(mp.changed.length)await putMany("points",mp.changed);S.points=mp.all;
      const locT=new Map(S.tours.map(t=>[t.id,t]));const mt=mergeArr(S.tours,rem.tours);for(const t of mt.changed){const l=locT.get(t.id);if(l&&l.lineRev===t.lineRev&&l.disp){t.disp=l.disp;}}
      if(mt.changed.length)await putMany("tours",mt.changed);S.tours=mt.all;
      if(rem.settings&&(rem.settings.mod||0)>(S.settings.mod||0)){S.settings=Object.assign(settingsDefault(),rem.settings);await metaSet("settings",S.settings);}}
    /* 2. Linien und Original-GPX */
    const tours=S.tours.filter(t=>!t.del);let n=0;
    for(const t of tours){n++;if(!t.lineRev)continue;const f=byName.get("bm_linie_"+t.id+".json.gz");const rrev=f&&f.appProperties?+f.appProperties.rev:0;const loc=await getOne("lines",t.id);
      if(loc&&loc.rev>=t.lineRev&&rrev<loc.rev){P("Touren hochladen",n,tours.length);await gdUpload(f?null:"bm_linie_"+t.id+".json.gz",await gzip(JSON.stringify(loc.line)),f&&f.id,{rev:String(loc.rev)});}
      else if(f&&(!loc||loc.rev<rrev||!t.disp)){P("Touren laden",n,tours.length);const line=JSON.parse(await gunzip(await gdGet(f.id)));await put("lines",{id:t.id,line,rev:rrev});
        t.disp=simplify(line,4).map(p=>[r5(p[0]),r5(p[1])]);t.bbox=bboxOf(line);await put("tours",t);}
      const gf=byName.get("bm_gpx_"+t.id+".gpx.gz");const raw=await getOne("raw",t.id);
      if(raw&&!gf){await gdUpload("bm_gpx_"+t.id+".gpx.gz",await gzip(raw.gpx));}else if(gf&&!raw&&t.status==="gemacht"){try{await put("raw",{id:t.id,gpx:await gunzip(await gdGet(gf.id))});}catch(e){}}}
    for(const t of S.tours.filter(t=>t.del)){for(const nm of ["bm_linie_"+t.id+".json.gz","bm_gpx_"+t.id+".gpx.gz"]){const f=byName.get(nm);if(f)await gdDel(f.id);}}
    /* 3. Fotos */
    const need=new Set();for(const p of S.points)if(!p.del)for(const id of p.photos||[])need.add(id);for(const t of S.tours)if(!t.del)for(const x of t.photos||[])need.add(x.id);const locPh=new Set(await getKeys("photos"));let k=0;
    const up=[...locPh].filter(id=>need.has(id)&&!byName.has("bm_foto_"+id+".jpg")),down=[...need].filter(id=>!locPh.has(id)&&byName.has("bm_foto_"+id+".jpg"));
    for(const id of up){k++;P("Fotos hochladen",k,up.length);const ph=await getOne("photos",id);await gdUpload("bm_foto_"+id+".jpg",ph.blob,null,{pid:ph.pid||"",t:String(ph.t||0)});}
    k=0;for(const id of down){k++;P("Fotos laden",k,down.length);const f=byName.get("bm_foto_"+id+".jpg");const blob=await gdGet(f.id);let thumb=null;try{thumb=await resizeImg(blob,320,0.7);}catch(e){}
      await put("photos",{id,pid:(f.appProperties||{}).pid||"",blob,thumb,t:+(f.appProperties||{}).t||0,mod:Date.now()});}
    for(const f of files)if(/^bm_foto_/.test(f.name)){const id=f.name.slice(8,-4);if(!need.has(id)&&(S.points.some(p=>p.del&&(p.photos||[]).includes(id))||S.tours.some(t=>(t.del&&(t.photos||[]).some(x=>x.id===id))||(t.phDel||[]).includes(id))))await gdDel(f.id);}
    /* 4. zusammengeführte Daten hochladen */
    P("Daten hochladen …");const cut=Date.now()-60*864e5;
    const data={app:"boschormap",v:1,t:Date.now(),points:S.points.filter(p=>!(p.del&&p.del<cut)),tours:S.tours.filter(t=>!(t.del&&t.del<cut)).map(stripTour),settings:S.settings};
    await gdUpload(GD_DATA,await gzip(JSON.stringify(data)),df&&df.id);
    ls("dirty",null);btn.classList.remove("pending");ls("lastsync",Date.now());refreshMarkers();map.render();if(!quiet)toast("Abgeglichen");if(nav.length)refreshPanel();}
  catch(e){console.warn(e);if(!quiet||!/Anmeldung/.test(e.message))toast(e.message,6000);}
  finally{syncing=false;btn.classList.remove("spin");progressDone();}}
function drivePanel(){const c=gdClient(),con=gdOk(),last=+ls("lastsync")||0;
  return {title:"Google Drive",icon:`<svg><use href="#i-sync"/></svg>`,html:`
   <div class="note">BoschorMap verwendet ein <b>eigenes Google-Konto</b> und ein eigenes Google-Cloud-Projekt – getrennt von IbexMap. Die Daten liegen im versteckten App-Ordner dieses Kontos.</div>
   <div class="card"><h3>Einrichtung (einmal pro Gerät)</h3><label class="f">OAuth-Client-ID</label><input class="inp" id="gC" value="${esc(c)}" placeholder="…apps.googleusercontent.com" autocomplete="off" spellcheck="false">
    <p class="muted small">Weiterleitungs-URI für die Google Cloud: <b>${esc(GD_REDIRECT())}</b></p><button class="btn pri full" id="gSave">Speichern und verbinden</button></div>
   ${c?`<div class="card"><h3>Status</h3><p>${con?"Verbunden":"Nicht angemeldet"}${ls("gmail")?` als <b>${esc(ls("gmail"))}</b>`:""}<br><small class="muted">Letzter Abgleich: ${last?fmtDT(last):"noch nie"}</small></p>
    <div class="btns"><button class="btn pri" id="gSync"><svg><use href="#i-sync"/></svg>Jetzt abgleichen</button><button class="btn" id="gSw">Konto wechseln</button></div>
    <label class="tg" style="margin-top:8px"><span>Automatisch abgleichen (nach Änderungen und beim Start)</span><span class="sw2"><input type="checkbox" id="gA"${ls("autosync")!=="0"?" checked":""}><i></i></span></label></div>`:""}`,
   after(P){$("#gSave",P).onclick=()=>{const v=$("#gC",P).value.trim();if(v&&!/\.apps\.googleusercontent\.com$/.test(v))return toast("Das sieht nicht nach einer Client-ID aus");ls("gclient",v||null);ls("gconn",null);
       $("#bSync").hidden=!v;if(v)syncDrive(false);else refreshPanel();};
     const s=$("#gSync",P);if(s)s.onclick=()=>syncDrive(false);const w=$("#gSw",P);if(w)w.onclick=()=>{ls("gmail",null);ls("gconn",null);gdToken=null;tokSave(null);gdAuth(true);};
     const a=$("#gA",P);if(a)a.onchange=()=>ls("autosync",a.checked?"1":"0");}};}

/* ---------- Sicherung als Datei, Papierkorb, Export ---------- */
function dataPanel(){const cut=Date.now()-30*864e5;const trash=[...S.points.filter(p=>p.del&&p.del>cut).map(p=>({k:"p",x:p})),...S.tours.filter(t=>t.del&&t.del>cut).map(t=>({k:"t",x:t}))].sort((a,b)=>b.x.del-a.x.del);
  return {title:"Daten und Sicherung",icon:`<svg><use href="#i-box"/></svg>`,html:`
   <div class="card"><h3>Sicherung</h3><p class="muted">Alle Orte, Touren (mit Original-GPX), Fotos und Einstellungen als eine Datei – unabhängig von Google.</p>
    <label class="chk"><input type="checkbox" id="dEnc"><span>Mit Passwort verschlüsseln <small class="muted">(empfohlen – die Datei enthält deine Orte samt Zuhause)</small></span></label>
    <div id="dPw" hidden style="margin:6px 0 8px"><input class="inp" type="password" id="dPw1" placeholder="Passwort (mind. 8 Zeichen)" autocomplete="new-password"><input class="inp" type="password" id="dPw2" placeholder="Passwort wiederholen" autocomplete="new-password" style="margin-top:6px">
     <p class="muted small" style="margin:4px 0 0">Ohne dieses Passwort lässt sich die Sicherung nicht mehr öffnen – gut aufbewahren.</p></div>
    <div class="btns"><button class="btn pri" id="dExp"><svg><use href="#i-down"/></svg>Sicherung speichern</button><button class="btn" id="dImp"><svg><use href="#i-up"/></svg>Sicherung einlesen</button></div></div>
   <div class="card"><h3>Export</h3><div class="btns"><button class="btn" id="dGpx"><svg><use href="#i-gpx"/></svg>Alle Orte als GPX</button><button class="btn" id="dCsv"><svg><use href="#i-table"/></svg>Tabelle (Verwaltung)</button></div>
    <p class="muted small">GPX: alle Orte in einer einzigen Gruppe «BoschorMap».</p></div>
   <div class="card"><h3>Papierkorb (30 Tage)</h3>${trash.length?trash.map(z=>`<div class="q"><span class="grow"><b>${esc(z.x.name)}</b><br><small class="muted">${z.k==="p"?"Ort":"Tour"} · gelöscht ${fmtDT(z.x.del)}</small></span><button class="btn sm" data-r="${z.k}:${z.x.id}">Wiederherstellen</button></div>`).join(""):`<div class="muted">Leer.</div>`}</div>`,
   after(P){const en=$("#dEnc",P);en.onchange=()=>{$("#dPw",P).hidden=!en.checked;};
     $("#dExp",P).onclick=()=>{let pw=null;if(en.checked){pw=$("#dPw1",P).value;if(pw.length<8)return toast("Passwort: mindestens 8 Zeichen");if(pw!==$("#dPw2",P).value)return toast("Die Passwörter stimmen nicht überein");}exportBackup(pw);};$("#dImp",P).onclick=()=>{const f=$("#fBackup");f.onchange=()=>{const x=f.files[0];f.value="";if(x)importBackup(x);};f.click();};
     $("#dGpx",P).onclick=()=>{const pts=S.points.filter(p=>!p.del);const x=s=>esc(s);
       download(`BoschorMap_Orte_${today()}.gpx`,`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="BoschorMap" xmlns="http://www.topografix.com/GPX/1/1">\n`+pts.map(p=>`<wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.hoehe!=null?`<ele>${p.hoehe}</ele>`:""}<name>${x(p.name)}</name><desc>${x(CATS[p.cat].n+(p.note?" – "+p.note:""))}</desc><type>BoschorMap</type></wpt>`).join("\n")+`\n</gpx>\n`,"application/gpx+xml");};
     $("#dCsv",P).onclick=showAdmin;
     $$("[data-r]",P).forEach(b=>b.onclick=async()=>{const [k,id]=b.dataset.r.split(":");if(k==="p"){const p=S.points.find(x=>x.id===id);delete p.del;await savePoint(p);}else{const t=S.tours.find(x=>x.id===id);delete t.del;await saveTour(t);}refreshPanel();toast("Wiederhergestellt");});}};}
const b64=blob=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(String(f.result).split(",")[1]);f.readAsDataURL(blob);});
/* Verschlüsselung der Sicherung: PBKDF2 (SHA-256, 310'000 Runden) + AES-GCM 256, alles im Browser */
const ENC_MAGIC="BMENC1";
async function encKey(pw,salt){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:310000,hash:"SHA-256"},k,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);}
async function encryptBlob(blob,pw){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await encKey(pw,salt);
  const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,await blob.arrayBuffer());return new Blob([ENC_MAGIC,salt,iv,ct],{type:"application/octet-stream"});}
async function decryptFile(file,pw){const b=new Uint8Array(await file.arrayBuffer());const salt=b.slice(6,22),iv=b.slice(22,34);const key=await encKey(pw,salt);
  try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv},key,b.slice(34)));}catch(e){throw new Error("Passwort falsch oder Datei beschädigt");}}
async function isEncrypted(file){return new TextDecoder().decode(new Uint8Array(await file.slice(0,6).arrayBuffer()))===ENC_MAGIC;}
function b64Blob(b64,type){const bin=atob(b64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new Blob([u],{type});}
async function exportBackup(pw){progress("Sicherung erstellen",0,0,"Daten sammeln …");try{const [lines,raws,ids]=await Promise.all([getAll("lines"),getAll("raw"),getKeys("photos")]);
  const parts=[`{"app":"boschormap","v":1,"t":${Date.now()},"version":"${APP_VERSION}","points":`,JSON.stringify(S.points),`,"tours":`,JSON.stringify(S.tours.map(stripTour)),`,"lines":`,JSON.stringify(lines),`,"raw":`,JSON.stringify(raws),`,"settings":`,JSON.stringify(S.settings),`,"photos":[`];
  let i=0;for(const id of ids){i++;if(i%5===0)progress("Sicherung erstellen",i,ids.length,"Fotos …");const p=await getOne("photos",id);parts.push((i>1?",":"")+JSON.stringify({id:p.id,pid:p.pid,t:p.t,lat:p.lat,lon:p.lon,mod:p.mod,data:await b64(p.blob)}));}
  parts.push("]}");let blob=new Blob(parts,{type:"application/json"});
  if(pw){progress("Sicherung verschlüsseln",0,0,"");blob=await encryptBlob(blob,pw);download(`BoschorMap_Sicherung_${today()}.bmsafe`,blob);toast("Verschlüsselte Sicherung gespeichert");}
  else{download(`BoschorMap_Sicherung_${today()}.json`,blob);toast("Sicherung gespeichert");}}catch(e){toast("Sicherung: "+e.message,5000);}finally{progressDone();}}
async function importBackup(file){let text;if(await isEncrypted(file)){const pw=prompt("Passwort der Sicherung:");if(!pw)return;progress("Sicherung entschlüsseln",0,0,file.name);
    try{text=await decryptFile(file,pw);}catch(e){progressDone();return toast(e.message,5000);}}
  progress("Sicherung einlesen",0,0,file.name);try{const j=JSON.parse(text!=null?text:await file.text());if(j.app!=="boschormap")throw new Error("Keine Boschor-Map-Sicherung");
    const replace=confirm("Alles ersetzen?\n\nOK = alle Daten auf diesem Gerät durch die Sicherung ersetzen\nAbbrechen = zusammenführen (neuere Version gewinnt)");
    if(replace){for(const st of ["points","tours","lines","raw","photos"]){const d=await db();await new Promise(r=>{const t=d.transaction(st,"readwrite");t.objectStore(st).clear();t.oncomplete=r;});}S.points=[];S.tours=[];}
    const mp=mergeArr(S.points,j.points);await putMany("points",mp.changed);S.points=mp.all;
    const lm=new Map((j.lines||[]).map(l=>[l.id,l]));const mt=mergeArr(S.tours,j.tours);
    for(const t of mt.changed){const l=lm.get(t.id);if(l){t.disp=simplify(l.line,4).map(p=>[r5(p[0]),r5(p[1])]);t.bbox=bboxOf(l.line);await put("lines",l);}}await putMany("tours",mt.changed);S.tours=mt.all;
    for(const r of j.raw||[])if(mt.changed.some(t=>t.id===r.id))await put("raw",r);
    const have=new Set(await getKeys("photos"));let i=0;for(const p of j.photos||[]){i++;if(have.has(p.id))continue;if(i%5===0)progress("Sicherung einlesen",i,j.photos.length,"Fotos …");
      const blob=b64Blob(p.data,"image/jpeg");let thumb=null;try{thumb=await resizeImg(blob,320,0.7);}catch(e){}await put("photos",{id:p.id,pid:p.pid,t:p.t,lat:p.lat,lon:p.lon,mod:p.mod,blob,thumb});}
    if(j.settings&&(replace||(j.settings.mod||0)>(S.settings.mod||0))){S.settings=Object.assign(settingsDefault(),j.settings);await metaSet("settings",S.settings);}
    refreshMarkers();map.render();markDirty();toast(`Eingelesen: ${mp.changed.length} Orte, ${mt.changed.length} Touren`,4000);if(nav.length)refreshPanel();}
  catch(e){toast("Sicherung: "+e.message,6000);}finally{progressDone();}}

/* ---------- Fotos importieren: nur Fotos mit Aufnahmeort, an nahe Orte anhängen oder neue Orte ---------- */
async function exifInfo(file){const out={ll:null,date:"",time:0};try{const buf=await file.slice(0,524288).arrayBuffer();const v=new DataView(buf);if(v.byteLength<4||v.getUint16(0)!==0xFFD8)return out;let o=2;
  while(o<v.byteLength-10){const m=v.getUint16(o);if((m&0xFF00)!==0xFF00)break;const len=v.getUint16(o+2);
    if(m===0xFFE1&&v.getUint32(o+4)===0x45786966){const t=o+10,le=v.getUint16(t)===0x4949,u16=a=>v.getUint16(a,le),u32=a=>v.getUint32(a,le);
      const str=(e,n)=>{n=n||19;const c=u32(e+4);const off=c<=4?e+8:t+u32(e+8);let s="";for(let i=0;i<Math.min(n,c||n);i++){const ch=v.getUint8(off+i);if(!ch)break;s+=String.fromCharCode(ch);}return s;};let oz="";
      const ifd0=t+u32(t+4);let gps=0,sub=0,dt="";for(let i=0;i<u16(ifd0);i++){const e=ifd0+2+i*12;const tg=u16(e);if(tg===0x8825)gps=t+u32(e+8);if(tg===0x8769)sub=t+u32(e+8);if(tg===0x0132)dt=str(e);}
      if(sub)for(let i=0;i<u16(sub);i++){const e=sub+2+i*12;const tg=u16(e);if(tg===0x9003)dt=str(e);if(tg===0x9011)oz=str(e,6);}
      if(gps){const g={};for(let i=0;i<u16(gps);i++){const e=gps+2+i*12,tag=u16(e),type=u16(e+2);if(tag===1||tag===3)g[tag]=String.fromCharCode(v.getUint8(e+8));
          if((tag===2||tag===4)&&type===5){const off=t+u32(e+8);const r=k=>{const d=u32(off+k*8+4);return d?u32(off+k*8)/d:0;};g[tag]=r(0)+r(1)/60+r(2)/3600;}}
        if(g[2]!=null&&g[4]!=null&&!(g[2]===0&&g[4]===0))out.ll=[g[2]*(g[1]==="S"?-1:1),g[4]*(g[3]==="W"?-1:1)];}
      const mm=dt.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):?(\d\d)?/);if(mm&&mm[1]>"1990"){out.date=`${mm[1]}-${mm[2]}-${mm[3]}`;const z=oz.match(/^([+-])(\d\d):(\d\d)$/);
        out.time=z?Date.UTC(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+(mm[6]||0))-(z[1]==="-"?-1:1)*(+z[2]*60+ +z[3])*60000:new Date(+mm[1],+mm[2]-1,+mm[3],+mm[4],+mm[5],+(mm[6]||0)).getTime();}break;}
    o+=2+len;}}catch(e){}return out;}
function photoImportStart(){return {title:"Fotos importieren",icon:`<svg><use href="#i-cam"/></svg>`,html:`
  <p class="muted">Fotos vom gleichen Ort und Tag werden zusammengefasst; liegt ein eigener Ort in der Nähe (bis 150 m), werden sie dort angehängt.</p>
  <div class="note">Auf dem Handy entfernt Android beim Auswählen im Browser meist den Aufnahmeort aus den Fotos. Dann wählst du den Ort selbst: aktueller Standort, Kartenmitte oder ein eigener Ort. Am PC bleibt der Aufnahmeort erhalten.</div>
  <label class="tg card"><span>Einfacher Modus<br><small class="muted">nur eine Bemerkung pro Ort, Name und Kategorie automatisch</small></span><span class="sw2"><input type="checkbox" id="piS"${ls("phSimple")==="1"?" checked":""}><i></i></span></label>
  <div class="btns"><button class="btn pri" id="piC"><svg><use href="#i-cam"/></svg>Foto aufnehmen</button><button class="btn" id="piF">Fotos auswählen</button><button class="btn" id="piD">Ganzen Ordner wählen</button></div>`,
  after(P){$("#piS",P).onchange=e=>ls("phSimple",e.target.checked?"1":"0");const go=inp=>{inp.onchange=()=>{const fl=[...inp.files].filter(f=>/^image\//.test(f.type)||/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));inp.value="";if(fl.length)scanPhotos(fl);else toast("Keine Fotos gefunden");};inp.click();};
    $("#piC",P).onclick=()=>{locateOnce();go($("#fCam"));};$("#piF",P).onclick=()=>{locateOnce();go($("#fPhotos"));};$("#piD",P).onclick=()=>go($("#fFolder"));}};}
/* aktueller Standort einmal holen (für Fotos ohne Aufnahmeort) */
let locP=null;function locateOnce(){if(S.me&&Date.now()-(S.meT||0)<120000)return Promise.resolve(S.me);if(locP)return locP;
  locP=new Promise(res=>{if(!navigator.geolocation)return res(null);navigator.geolocation.getCurrentPosition(p=>{S.me={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy};S.meT=Date.now();res(S.me);},()=>res(null),{enableHighAccuracy:true,timeout:15000,maximumAge:60000});}).finally(()=>{setTimeout(()=>{locP=null;},1000);});return locP;}
async function scanPhotos(files){const seen=new Set(await metaGet("photoSrc",[]));const rows=[],noLoc=[];let dup=0;
  for(let i=0;i<files.length;i++){if(i%4===0)progress("Fotos lesen",i,files.length,"Aufnahmeort und -zeit …");const f=files[i];const key=f.name+"|"+f.size+"|"+f.lastModified;if(seen.has(key)){dup++;continue;}
    const ex=await exifInfo(f);if(!ex.time)ex.time=f.lastModified||Date.now();if(!ex.date){const d=new Date(ex.time);ex.date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
    (ex.ll?rows:noLoc).push({f,ex,key});}
  progressDone();rows.sort((a,b)=>a.ex.time-b.ex.time);const groups=[];
  for(const r of rows){let g=groups.find(g=>!g.noLoc&&g.date===r.ex.date&&distM(g.lat,g.lon,r.ex.ll[0],r.ex.ll[1])<80);if(!g){g={date:r.ex.date,lat:r.ex.ll[0],lon:r.ex.ll[1],rows:[]};groups.push(g);}g.rows.push(r);
    g.lat=g.rows.reduce((s,x)=>s+x.ex.ll[0],0)/g.rows.length;g.lon=g.rows.reduce((s,x)=>s+x.ex.ll[1],0)/g.rows.length;}
  for(const g of groups){let b=null;for(const p of S.points){if(p.del)continue;const d=distM(g.lat,g.lon,p.lat,p.lon);if(d<=150&&(!b||d<b.d))b={p,d};}g.near=b;}
  /* Fotos ohne Aufnahmeort: pro Tag eine Gruppe, Ort wählbar (Standort, Kartenmitte, eigener Ort) */
  let me=null;if(noLoc.length){progress("Standort bestimmen",0,0,"für Fotos ohne Aufnahmeort …");me=await locateOnce();progressDone();}
  const c=map.getCenter();const ref=me||c;const nearRef=S.points.filter(p=>!p.del).map(p=>({p,d:distM(ref.lat,ref.lon,p.lat,p.lon)})).filter(x=>x.d<3000).sort((a,b)=>a.d-b.d).slice(0,8);
  const days=[...new Set(noLoc.map(r=>r.ex.date))].sort();
  for(const d of days){const rs=noLoc.filter(r=>r.ex.date===d);const fresh=rs.some(r=>Date.now()-r.ex.time<3*3600e3);
    let def=me&&fresh?"me":"skip";if(def==="me"&&nearRef[0]&&nearRef[0].d<=150&&me)def=nearRef[0].p.id;groups.push({date:d,rows:rs,noLoc:true,def});}
  if(!groups.length)return toast(dup?`Alle ${dup} Fotos sind schon übernommen`:"Keine Fotos gefunden",4000);
  const simple=ls("phSimple")==="1";const urls=[];const nPhotos=rows.length+noLoc.length;
  const opt=g=>g.noLoc?`<option value="skip"${g.def==="skip"?" selected":""}>Überspringen</option>${me?`<option value="me"${g.def==="me"?" selected":""}>Neuer Ort am aktuellen Standort (±${fmtN(me.acc||0)} m)</option>`:""}<option value="map">Neuer Ort in der Kartenmitte</option>
      ${nearRef.map(x=>`<option value="${x.p.id}"${g.def===x.p.id?" selected":""}>an «${esc(x.p.name)}» anhängen (${fmtN(x.d)} m)</option>`).join("")}`
    :`<option value="">Neuer Ort</option>${g.near?`<option value="${g.near.p.id}" selected>an «${esc(g.near.p.name)}» anhängen (${fmtN(g.near.d)} m)</option>`:""}`;
  const isNew=v=>v===""||v==="me"||v==="map";
  openPanel(()=>({title:`${nPhotos} Fotos`,icon:`<svg><use href="#i-cam"/></svg>`,html:`
   ${dup?`<p class="muted small">${dup} schon übernommen.</p>`:""}
   ${noLoc.length?`<div class="note">${noLoc.length} Foto${noLoc.length>1?"s":""} ohne Aufnahmeort${me?"":" – Standort nicht verfügbar (Standort im Browser erlauben)"}. Bitte unten den Ort wählen.</div>`:""}
   ${groups.map((g,i)=>`<div class="card"><div class="thumbs">${g.rows.slice(0,6).map((r,k)=>`<img data-g="${i}" data-k="${k}" alt="">`).join("")}${g.rows.length>6?`<span class="muted">+${g.rows.length-6}</span>`:""}</div>
     <div class="muted small">${fmtDate(g.date)} · ${g.rows.length} Foto${g.rows.length>1?"s":""}${g.noLoc?" · <b>ohne Aufnahmeort</b>":""}</div>
     <select class="inp" data-t="${i}" style="margin-top:6px">${opt(g)}</select>
     ${simple?"":`<div class="row" data-new="${i}" style="margin-top:6px${(g.noLoc?isNew(g.def):!g.near)?"":";display:none"}"><input class="inp grow" data-n="${i}" placeholder="Name"><select class="inp" data-c="${i}" style="width:auto">${Object.entries(CATS).map(([k,c])=>`<option value="${k}"${k==="ort"?" selected":""}>${c.n}</option>`).join("")}</select></div>`}
     <input class="inp" data-b="${i}" placeholder="Bemerkung" style="margin-top:6px"></div>`).join("")}
   <button class="btn pri full" id="phGo"><svg><use href="#i-check"/></svg>Übernehmen</button>`,
   after(P){$$("img[data-g]",P).forEach(im=>{const r=groups[+im.dataset.g].rows[+im.dataset.k];const u=URL.createObjectURL(r.f);urls.push(u);im.src=u;im.loading="lazy";});
     $$("[data-t]",P).forEach(s=>s.onchange=()=>{const n=$(`[data-new="${s.dataset.t}"]`,P);if(n)n.style.display=isNew(s.value)?"":"none";});
     $("#phGo",P).onclick=async()=>{const N=groups.reduce((s,g)=>s+g.rows.length,0);let k=0,bad=0,done=0;const newPts=[];const cc=map.getCenter();
       for(let i=0;i<groups.length;i++){const g=groups[i];const tgt=$(`[data-t="${i}"]`,P).value;const rem=$(`[data-b="${i}"]`,P).value.trim();if(tgt==="skip"){k+=g.rows.length;continue;}
         let p=isNew(tgt)?null:S.points.find(x=>x.id===tgt);
         if(!p){const ll=tgt==="me"?[me.lat,me.lon]:tgt==="map"?[cc.lat,cc.lon]:[g.lat,g.lon];const nm=simple?"":($(`[data-n="${i}"]`,P).value.trim());const cat=simple?"ort":$(`[data-c="${i}"]`,P).value;
           p={id:uid(),cat,name:nm||(rem?rem.slice(0,40):`Foto ${fmtDate(g.date)}`),lat:ll[0],lon:ll[1],hoehe:null,hq:"",visits:cat==="gipfel"&&g.date?[{d:g.date,note:""}]:[],photos:[],note:rem,rate:{},created:Date.now()};newPts.push(p);}
         else if(rem)p.note=(p.note?p.note+"\n":"")+`${fmtDate(g.date)}: ${rem}`;
         for(const r of g.rows){k++;progress("Fotos übernehmen",k,N);try{const id=await storePhoto(r.f,p.id,r.ex);p.photos=(p.photos||[]).concat(id);seen.add(r.key);done++;}catch(e){bad++;}}
         if((p.photos||[]).length||!newPts.includes(p))await savePoint(p);}
       await metaSet("photoSrc",[...seen]);urls.forEach(u=>URL.revokeObjectURL(u));
       if(navigator.onLine)for(let i=0;i<newPts.length;i++){const p=newPts[i];if(!(p.photos||[]).length)continue;progress("Höhen holen (swisstopo)",i,newPts.length);const h=await heightAt(p.lat,p.lon);if(h!=null){p.hoehe=h;p.hq="swisstopo";await savePoint(p);}await sleep(250);}
       progressDone();closePanel();toast(bad?`${done} Fotos übernommen, ${bad} nicht lesbar (Format HEIF? In der Samsung-Kamera «Bilder mit hoher Effizienz» ausschalten)`:`${done} Fotos übernommen`,bad?7000:3000);
       const np=newPts.find(p=>(p.photos||[]).length);if(np&&groups.length===1)showPoint(np.id);};}}));}
