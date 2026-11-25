/* BoschorMap – GPX lesen, Track bereinigen (Ausreisser, Pausen), Kennzahlen, persönliches Tempo */
"use strict";
function parseGPX(text){const d=new DOMParser().parseFromString(text,"application/xml");if(d.getElementsByTagName("parsererror").length)throw new Error("Keine gültige GPX-Datei");
  const val=(el,tag)=>{const x=el.getElementsByTagName(tag)[0];return x?x.textContent.trim():"";};
  let nodes=[...d.getElementsByTagName("trkpt")];if(!nodes.length)nodes=[...d.getElementsByTagName("rtept")];
  const pts=[];for(const n of nodes){const la=parseFloat(n.getAttribute("lat")),lo=parseFloat(n.getAttribute("lon"));if(!isFinite(la)||!isFinite(lo))continue;
    const e=parseFloat(val(n,"ele"));const ts=val(n,"time");const t=ts?Date.parse(ts):NaN;pts.push([la,lo,isFinite(e)?e:null,isFinite(t)?t:null]);}
  const trk=d.getElementsByTagName("trk")[0]||d.getElementsByTagName("rte")[0];
  const name=trk?val(trk,"name"):"",type=trk?val(trk,"type"):"",meta=val(d.documentElement,"name");
  return {pts,name:name||meta,type};}
function guessArt(s){s=String(s||"").toLowerCase();
  if(/ski|splitboard|randonn/.test(s))return "skitour";if(/gravel/.test(s))return "gravel";if(/mtb|mountain ?bik|enduro|bike|downhill/.test(s))return "bike";
  if(/cycl|velo|rad|road/.test(s))return "gravel";if(/mountaineer|alpin|climb|hochtour|kletter/.test(s))return "hochtour";if(/hik|walk|trek|wander|run|trail|lauf/.test(s))return "wandern";return "";}

const VMAX={skitour:33,wandern:8,hochtour:8,winterhochtour:33,gravel:28,bike:28};/* m/s – schneller ist ein GPS-Sprung */
/* Bereinigung: gibt bereinigte Punkte, Pausen und Kennzahlen zurück. Original bleibt unverändert gespeichert. */
function cleanTrack(raw,art){const vmax=VMAX[art]||10;let p=raw.filter(x=>isFinite(x[0])&&isFinite(x[1])&&Math.abs(x[0])<=90);
  const hasT=p.filter(x=>x[3]).length>p.length*0.8;let removed=0;
  if(hasT){p=p.filter(x=>x[3]);p.sort((a,b)=>a[3]-b[3]);
    /* 1. Sprünge: Punkte mit unmöglichem Tempo weglassen */
    const dd=[];for(const x of p){if(dd.length&&x[3]<=dd[dd.length-1][3]){removed++;continue;}dd.push(x);}p=dd;
    const sp=(a,b)=>distM(a[0],a[1],b[0],b[1])/Math.max(1,(b[3]-a[3])/1000);
    /* ein Punkt ist ein Ausreisser, wenn er sowohl vom Vorgänger als auch zum Nachfolger «unmöglich schnell» wäre */
    for(let pass=0;pass<3;pass++){const out=[];for(let i=0;i<p.length;i++){const a=out[out.length-1],b=p[i],c=p[i+1];
        const bad=a&&c?sp(a,b)>vmax&&sp(b,c)>vmax&&sp(a,c)<=vmax*1.5:!a&&c&&p[i+2]?sp(b,c)>vmax&&sp(c,p[i+2])<=vmax:false;
        if(bad){removed++;continue;}out.push(b);}if(out.length===p.length)break;p=out;}}
  /* 2. Höhen: Sprünge > 8 m/s entfernen, Lücken füllen, glätten */
  const e=p.map(x=>x[2]);
  if(hasT)for(let i=1;i<p.length;i++){if(e[i]==null||e[i-1]==null)continue;const dt=(p[i][3]-p[i-1][3])/1000;if(dt>0&&Math.abs(e[i]-e[i-1])/dt>8&&Math.abs(e[i]-e[i-1])>20){e[i]=null;removed++;}}
  let last=null;for(let i=0;i<e.length;i++){if(e[i]!=null){if(last!=null&&i-last>1)for(let k=last+1;k<i;k++)e[k]=e[last]+(e[i]-e[last])*(k-last)/(i-last);last=i;}}
  const f=e.findIndex(v=>v!=null);if(f>0)for(let k=0;k<f;k++)e[k]=e[f];if(last!=null)for(let k=last+1;k<e.length;k++)e[k]=e[last];
  const sm=e.map((v,i)=>{if(v==null)return null;let s=0,n=0;for(let k=Math.max(0,i-2);k<=Math.min(e.length-1,i+2);k++)if(e[k]!=null){s+=e[k];n++;}return n?s/n:v;});
  p=p.map((x,i)=>[x[0],x[1],sm[i]!=null?Math.round(sm[i]*10)/10:null,x[3]]);
  /* 3. Pausen: bleibt man ≥ 2 Minuten innerhalb von 20 m und 10 Höhenmetern, wird das GPS-Zittern zu einem Ort zusammengefasst */
  const pauses=[];
  if(hasT&&p.length>2){const out=[];let i=0;while(i<p.length){let j=i+1,sl=p[i][0],so=p[i][1],n=1;
      /* nur echte Pause: kaum Ortswechsel UND kaum Höhenwechsel (steiles, langsames Steigen ist keine Pause) */
      while(j<p.length&&distM(sl/n,so/n,p[j][0],p[j][1])<20&&(p[j][2]==null||p[i][2]==null||Math.abs(p[j][2]-p[i][2])<10)){sl+=p[j][0];so+=p[j][1];n++;j++;}
      const dur=(p[j-1][3]-p[i][3])/1000;
      if(j-i>2&&dur>=120){const la=sl/n,lo=so/n,h=p[i+Math.floor((j-i)/2)][2];out.push([la,lo,h,p[i][3]],[la,lo,h,p[j-1][3]]);pauses.push({lat:la,lon:lo,t0:p[i][3],t1:p[j-1][3]});i=j;}
      else{out.push(p[i]);i++;}}p=out;}
  return {pts:p,pauses,removed,stats:trackStats(p,hasT)};}
function trackStats(p,hasT){let dist=0,up=0,down=0,moving=0,ref=null,emin=Infinity,emax=-Infinity;const TH=5;
  for(let i=0;i<p.length;i++){const h=p[i][2];if(h!=null){if(h<emin)emin=h;if(h>emax)emax=h;
      if(ref==null)ref=h;else if(h-ref>=TH){up+=h-ref;ref=h;}else if(ref-h>=TH){down+=ref-h;ref=h;}}
    if(i){const d=distM(p[i-1][0],p[i-1][1],p[i][0],p[i][1]);dist+=d;
      if(hasT&&p[i][3]&&p[i-1][3]){const dt=(p[i][3]-p[i-1][3])/1000;const v=dt>0?d/dt:0;if(!(dt>45&&v<0.3)&&!(d<0.5&&dt>5))moving+=dt;}}}
  const t0=hasT&&p.length?p[0][3]:null,t1=hasT&&p.length?p[p.length-1][3]:null;
  return {dist:Math.round(dist),up:Math.round(up),down:Math.round(down),moving:hasT?Math.round(moving):null,total:hasT?Math.round((t1-t0)/1000):null,
    t0,emin:isFinite(emin)?Math.round(emin):null,emax:isFinite(emax)?Math.round(emax):null};}
/* Kennzahlen für das Tempo-Diagramm: Steigen (Abschnitte > 8 % Steigung), Abstieg (< −8 %), Flach (|Steigung| < 4 %) */
function paceStats(p){let su=0,st=0,du=0,dt2=0,fd=0,ft=0;
  for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];if(!a[3]||!b[3]||a[2]==null||b[2]==null)continue;const dt=(b[3]-a[3])/1000;const d=distM(a[0],a[1],b[0],b[1]);
    if(dt<=0||dt>120||d<0.5)continue;const dh=b[2]-a[2],g=dh/Math.max(d,1);
    if(g>0.08){su+=dh;st+=dt;}else if(g<-0.08){du+=-dh;dt2+=dt;}else if(Math.abs(g)<0.04){fd+=d;ft+=dt;}}
  return {vu:st>600?Math.round(su/st*3600):null,vd:dt2>600?Math.round(du/dt2*3600):null,vf:ft>600?Math.round(fd/ft*36)/10:null};}

/* ---------- Tempo-Modell: Zeit = km/vf + Aufstieg/vu + Abstieg/vd ---------- */
function tempoDefault(art){return Object.assign({},(ARTS[art]||ARTS.wandern).t);}
function estTime(km,up,down,t){return 3600*(km/t.vf+up/t.vu+down/t.vd);}
/* Lernen aus eigenen Touren: Einzelwerte direkt aus den gemessenen Abschnitten der Tracks (Median über die Touren,
   bei wenigen Touren sanft zur Vorgabe gezogen). Danach nur ein gemeinsamer Korrekturfaktor (0.8–1.25), damit die
   Gesamtzeit zu den echten Touren passt – so bleiben Ebene/Aufstieg/Abstieg einzeln realistisch. */
function learnTempo(tours,art){const T=tours.filter(t=>!t.del&&!t.noPace&&t.art===art&&t.status==="gemacht"&&t.moving>600&&t.dist>500).slice(-25);const d0=tempoDefault(art);
  if(!T.length)return {t:d0,n:0};
  const est0=t=>estTime(t.dist/1000,t.up,t.down,d0);
  const fs=T.map(t=>t.moving/est0(t)).filter(isFinite).sort((a,b)=>a-b);const fac=fs[Math.floor(fs.length/2)]||1;
  const med=a=>{a=a.filter(v=>v!=null&&isFinite(v)&&v>0).sort((x,y)=>x-y);return a.length?{v:a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2,n:a.length}:null;};
  /* Messwert mit Vorgabe×Gesamtfaktor mischen: je mehr Touren, desto mehr zählt der Messwert */
  const mix=(m,def)=>m?(m.n*m.v+2*def)/(m.n+2):def;
  const P=T.map(t=>t.pace||{});
  let t={vf:mix(med(P.map(p=>p.vf)),d0.vf/fac),vu:mix(med(P.map(p=>p.vu)),d0.vu/fac),vd:mix(med(P.map(p=>p.vd)),d0.vd/fac)};
  const ks=T.map(x=>x.moving/estTime(x.dist/1000,x.up,x.down,t)).filter(isFinite).sort((a,b)=>a-b);let k=ks[Math.floor(ks.length/2)]||1;k=Math.max(0.8,Math.min(1.25,k));
  t={vf:Math.round(t.vf/k*10)/10,vu:Math.round(t.vu/k),vd:Math.round(t.vd/k)};
  return {t,n:T.length,fac,k};}
function solve3(A,b){const m=A.map((r,i)=>[...r,b[i]]);for(let i=0;i<3;i++){let mx=i;for(let k=i+1;k<3;k++)if(Math.abs(m[k][i])>Math.abs(m[mx][i]))mx=k;[m[i],m[mx]]=[m[mx],m[i]];
    if(Math.abs(m[i][i])<1e-12)return null;for(let k=0;k<3;k++){if(k===i)continue;const f=m[k][i]/m[i][i];for(let c=i;c<4;c++)m[k][c]-=f*m[i][c];}}return m.map((r,i)=>r[3]/r[i]);}

/* ---------- GPX schreiben ---------- */
function toGPX(name,line,wpts){const x=s=>esc(s);const t=line.some(p=>p[3]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="BoschorMap" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${x(name)}</name></metadata>\n`+
   (wpts||[]).map(w=>`<wpt lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}">${w.ele!=null?`<ele>${w.ele}</ele>`:""}<name>${x(w.name)}</name></wpt>\n`).join("")+
   `<trk><name>${x(name)}</name><trkseg>\n`+line.map(p=>`<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${p[2]!=null?`<ele>${(+p[2]).toFixed(1)}</ele>`:""}${t&&p[3]?`<time>${new Date(p[3]).toISOString()}</time>`:""}</trkpt>`).join("\n")+`\n</trkseg></trk>\n</gpx>\n`;}
