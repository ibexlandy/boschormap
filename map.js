/* BoschorMap – eigene, schlanke Kartenanzeige (Web Mercator, 256-px-Kacheln).
   Kacheln als <img>, Linien auf einem Canvas, Punkte als DOM-Elemente.
   Bedienung: ziehen, zwei Finger (Pinch), Mausrad, Doppelklick, langes Drücken. */
"use strict";
const BMap=(()=>{
const TS=256,R=Math.PI/180;
const lonX=lon=>(lon+180)/360;
const latY=lat=>{const s=Math.sin(Math.max(-85,Math.min(85,lat))*R);return 0.5-Math.log((1+s)/(1-s))/(4*Math.PI);};
const xLon=x=>x*360-180;
const yLat=y=>90-360*Math.atan(Math.exp((y-0.5)*2*Math.PI))/Math.PI;

class TileLayer{
  constructor(o){this.o=Object.assign({min:0,max:19,opacity:1,z:1},o);this.tiles=new Map();this.el=document.createElement("div");
    this.el.className="bm-tl";this.el.style.zIndex=this.o.z;this.el.style.opacity=this.o.opacity;this.tz=-1;this.map=null;}
  url(z,x,y){return this.o.url.replace("{z}",z).replace("{x}",x).replace("{y}",y);}
  setOpacity(v){this.o.opacity=v;this.el.style.opacity=v;}
  mk(z,x,y,k){const d=document.createElement("div");d.className="bm-t";const im=new Image();im.crossOrigin="anonymous";im.decoding="async";im.alt="";
    const t={z,x,y,el:d,im,ok:false,lv:0};d.appendChild(im);
    im.onload=()=>{t.ok=true;d.classList.add("ok");this.check();};
    /* Fehlt die Kachel (offline nicht gespeichert, ausserhalb des Gebiets): nächstgröbere vergrössert zeigen */
    im.onerror=()=>{if(t.lv>=5||z-t.lv-1<this.o.min){t.ok=true;d.classList.add("fail");this.check();return;}t.lv++;const s=1<<t.lv;
      im.style.width=im.style.height=(s*100)+"%";im.style.left=-((x%s)*100)+"%";im.style.top=-((y%s)*100)+"%";
      im.src=this.url(z-t.lv,x>>t.lv,y>>t.lv);};
    im.src=this.url(z,x,y);this.tiles.set(k,t);this.el.appendChild(d);return t;}
  check(){if(this._ck)return;this._ck=requestAnimationFrame(()=>{this._ck=0;this.prune(false);});}
  /* Alte Zoomstufen erst entfernen, wenn die aktuellen Kacheln da sind (keine grauen Flächen beim Zoomen) */
  prune(force){const need=this.need;if(!need)return;let all=true;for(const k of need){const t=this.tiles.get(k);if(!t||!t.ok){all=false;break;}}
    for(const [k,t] of this.tiles){if(need.has(k))continue;if(all||force||t.z===this.tz){t.im.onload=t.im.onerror=null;t.im.src="";t.el.remove();this.tiles.delete(k);}}}
  render(m){const o=this.o;let tz=Math.round(m.z);tz=Math.max(o.min,Math.min(o.max,tz));
    if(m.z<o.min-0.5||(o.hideBelow&&m.z<o.hideBelow)){this.el.style.display="none";return;}this.el.style.display="";
    const n=1<<tz,S=TS*Math.pow(2,m.z),ts=S/n,cx=m.cx*S-m.w/2,cy=m.cy*S-m.h/2;
    const x0=Math.max(0,Math.floor(cx/ts)),x1=Math.min(n-1,Math.floor((cx+m.w)/ts)),y0=Math.max(0,Math.floor(cy/ts)),y1=Math.min(n-1,Math.floor((cy+m.h)/ts));
    const b=o.bounds;let bx0=0,bx1=n-1,by0=0,by1=n-1;if(b){bx0=Math.floor(lonX(b[1])*n);bx1=Math.floor(lonX(b[3])*n);by0=Math.floor(latY(b[2])*n);by1=Math.floor(latY(b[0])*n);}
    const need=new Set();this.tz=tz;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){if(x<bx0||x>bx1||y<by0||y>by1)continue;const k=tz+"/"+x+"/"+y;need.add(k);if(!this.tiles.has(k))this.mk(tz,x,y,k);}
    this.need=need;
    for(const t of this.tiles.values()){const f=Math.pow(2,tz-t.z),s=ts*f,l=Math.round(t.x*s-cx),tp=Math.round(t.y*s-cy),r=Math.round((t.x+1)*s-cx),bt=Math.round((t.y+1)*s-cy);
      const st=t.el.style;st.transform=`translate(${l}px,${tp}px)`;st.width=(r-l)+"px";st.height=(bt-tp)+"px";st.zIndex=t.z===tz?2:1;}
    if(this.tiles.size>need.size*3)this.prune(true);}
  clear(){for(const t of this.tiles.values()){t.im.onload=t.im.onerror=null;t.im.src="";}this.tiles.clear();this.el.textContent="";}
}

class Map_{
  constructor(el,o){this.el=el;this.o=Object.assign({minZoom:7,maxZoom:20,bounds:null},o||{});el.classList.add("bm-map");
    this.pane=document.createElement("div");this.pane.className="bm-pane";el.appendChild(this.pane);
    this.cv=document.createElement("canvas");this.cv.className="bm-cv";el.appendChild(this.cv);
    this.mpane=document.createElement("div");this.mpane.className="bm-mk-pane";el.appendChild(this.mpane);
    this.layers=[];this.markers=new Set();this.drawers=[];this.ev={};this.cx=0.5;this.cy=0.5;this.z=8;this.w=0;this.h=0;this.raf=0;this.anim=null;
    this.resize();new ResizeObserver(()=>{this.resize();this.render();}).observe(el);this.gestures();}
  on(n,f){(this.ev[n]=this.ev[n]||[]).push(f);return this;}
  off(n,f){this.ev[n]=(this.ev[n]||[]).filter(x=>x!==f);}
  fire(n,d){(this.ev[n]||[]).slice().forEach(f=>{try{f(d);}catch(e){console.error(e);}});}
  resize(){const r=this.el.getBoundingClientRect();this.w=Math.max(1,r.width);this.h=Math.max(1,r.height);const dpr=Math.min(2,window.devicePixelRatio||1);this.dpr=dpr;
    this.cv.width=Math.round(this.w*dpr);this.cv.height=Math.round(this.h*dpr);this.cv.style.width=this.w+"px";this.cv.style.height=this.h+"px";}
  addLayer(l){l.map=this;this.layers.push(l);this.pane.appendChild(l.el);this.render();return l;}
  removeLayer(l){l.clear();l.el.remove();this.layers=this.layers.filter(x=>x!==l);}
  get S(){return TS*Math.pow(2,this.z);}
  getCenter(){return {lat:yLat(this.cy),lon:xLon(this.cx)};}
  getZoom(){return this.z;}
  clampView(){const b=this.o.bounds;this.z=Math.max(this.o.minZoom,Math.min(this.o.maxZoom,this.z));if(!b)return;
    const x0=lonX(b[1]),x1=lonX(b[3]),y0=latY(b[2]),y1=latY(b[0]);this.cx=Math.max(x0,Math.min(x1,this.cx));this.cy=Math.max(y0,Math.min(y1,this.cy));}
  setView(lat,lon,z){this.stop();this.cx=lonX(lon);this.cy=latY(lat);if(z!=null)this.z=z;this.clampView();this.render();this.moved();}
  project(lat,lon){const S=this.S;return {x:(lonX(lon)-this.cx)*S+this.w/2,y:(latY(lat)-this.cy)*S+this.h/2};}
  unproject(px,py){const S=this.S;return {lat:yLat(this.cy+(py-this.h/2)/S),lon:xLon(this.cx+(px-this.w/2)/S)};}
  /* sichtbarer Ausschnitt [s,w,n,e] */
  getBounds(){const a=this.unproject(0,this.h),b=this.unproject(this.w,0);return [a.lat,a.lon,b.lat,b.lon];}
  /* padB: zusätzlicher Rand unten (z. B. für ein Panel über der Karte) */
  fitBounds(bb,pad,padB,padR){pad=pad||40;padB=padB||0;padR=padR||0;const [s,w,n,e]=bb;const dx=Math.max(1e-9,lonX(e)-lonX(w)),dy=Math.max(1e-9,latY(s)-latY(n));
    const z=Math.min(17,Math.max(this.o.minZoom,Math.floor(Math.log2(Math.min(Math.max(60,this.w-2*pad-padR)/(dx*TS),Math.max(60,this.h-2*pad-padB)/(dy*TS)))*4)/4));
    const S=TS*Math.pow(2,z);const cy=(latY(s)+latY(n))/2+padB/2/S,cx=(lonX(w)+lonX(e))/2+padR/2/S;this.flyTo(yLat(cy),xLon(cx),z);}
  zoomAround(nz,px,py){nz=Math.max(this.o.minZoom,Math.min(this.o.maxZoom,nz));const a=this.unproject(px,py);this.z=nz;
    const S=this.S;this.cx=lonX(a.lon)-(px-this.w/2)/S;this.cy=latY(a.lat)-(py-this.h/2)/S;this.clampView();this.render();}
  panBy(dx,dy){const S=this.S;this.cx-=dx/S;this.cy-=dy/S;this.clampView();this.render();}
  stop(){if(this.anim){cancelAnimationFrame(this.anim.id);this.anim=null;}}
  animate(dur,step,done){this.stop();const t0=performance.now();const a={};this.anim=a;
    const f=t=>{if(this.anim!==a)return;let k=Math.min(1,(t-t0)/dur);const e=1-Math.pow(1-k,3);step(e);if(k<1)a.id=requestAnimationFrame(f);else{this.anim=null;done&&done();}};a.id=requestAnimationFrame(f);}
  zoomAnim(nz,px,py){nz=Math.max(this.o.minZoom,Math.min(this.o.maxZoom,nz));const z0=this.z;if(Math.abs(nz-z0)<0.01)return;
    if(px==null){px=this.w/2;py=this.h/2;}const a=this.unproject(px,py);
    this.animate(220,e=>{this.z=z0+(nz-z0)*e;const S=this.S;this.cx=lonX(a.lon)-(px-this.w/2)/S;this.cy=latY(a.lat)-(py-this.h/2)/S;this.clampView();this.render();},()=>this.moved());}
  flyTo(lat,lon,z){const x0=this.cx,y0=this.cy,z0=this.z,x1=lonX(lon),y1=latY(lat),z1=z==null?z0:z;
    const far=Math.hypot(x1-x0,y1-y0)*TS*Math.pow(2,Math.min(z0,z1))>this.w*3;
    if(far){this.setView(lat,lon,z1);return;}
    this.animate(350,e=>{this.cx=x0+(x1-x0)*e;this.cy=y0+(y1-y0)*e;this.z=z0+(z1-z0)*e;this.clampView();this.render();},()=>this.moved());}
  render(){if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw();});}
  draw(){for(const l of this.layers)l.render(this);
    for(const m of this.markers)this.placeMarker(m);
    const c=this.cv.getContext("2d");c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.w,this.h);
    for(const d of this.drawers){try{d(c,this);}catch(e){console.error(e);}}
    this.fire("move");}
  moved(){clearTimeout(this._mt);this._mt=setTimeout(()=>this.fire("moveend"),180);}
  addDrawer(f){this.drawers.push(f);this.render();return f;}
  removeDrawer(f){this.drawers=this.drawers.filter(x=>x!==f);this.render();}
  /* Punkt: {lat,lon,html|el,cls,anchor:[x,y],z,data,drag} */
  addMarker(m){if(!m.el){m.el=document.createElement("div");m.el.innerHTML=m.html||"";}m.el.classList.add("bm-mk");if(m.cls)m.el.className+=" "+m.cls;
    m.el._mk=m;if(m.z)m.el.style.zIndex=m.z;this.mpane.appendChild(m.el);this.markers.add(m);this.placeMarker(m);return m;}
  removeMarker(m){if(!m)return;m.el.remove();this.markers.delete(m);}
  moveMarker(m,lat,lon){m.lat=lat;m.lon=lon;this.placeMarker(m);}
  placeMarker(m){const p=this.project(m.lat,m.lon);const a=m.anchor||[0,0];
    if(p.x<-80||p.y<-80||p.x>this.w+80||p.y>this.h+80||(m.minZoom&&this.z<m.minZoom)){if(!m._hid){m.el.style.display="none";m._hid=1;}return;}
    if(m._hid){m.el.style.display="";m._hid=0;}m.el.style.transform=`translate(${Math.round(p.x-a[0])}px,${Math.round(p.y-a[1])}px)`;}
  gestures(){const el=this.el,P=new Map();let g=null,lastW=0,wAcc=0,lp=null,vel=[];
    const pt=e=>{const r=el.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
    el.addEventListener("pointerdown",e=>{if(e.button>0)return;if(e.target.closest(".bm-ui"))return;
      const mkEl=e.target.closest(".bm-mk");const p=pt(e);P.set(e.pointerId,p);try{el.setPointerCapture(e.pointerId);}catch(x){}this.stop();
      if(P.size===1){const mk=mkEl&&mkEl._mk;g={mode:"tap",x:p.x,y:p.y,t:Date.now(),mk,drag:mk&&mk.drag};vel=[{x:p.x,y:p.y,t:performance.now()}];
        clearTimeout(lp);lp=setTimeout(()=>{if(g&&g.mode==="tap"){g.mode="long";this._lpT=Date.now();const ll=this.unproject(g.x,g.y);this.fire(g.mk?"markerlong":"longpress",{lat:ll.lat,lon:ll.lon,x:g.x,y:g.y,marker:g.mk});}},550);}
      else if(P.size===2){clearTimeout(lp);const a=[...P.values()];g={mode:"pinch",d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),z:this.z,mx:(a[0].x+a[1].x)/2,my:(a[0].y+a[1].y)/2};}});
    el.addEventListener("pointermove",e=>{if(!P.has(e.pointerId)||!g)return;const p=pt(e);const prev=P.get(e.pointerId);P.set(e.pointerId,p);
      if(g.mode==="pinch"&&P.size>=2){const a=[...P.values()];const d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),mx=(a[0].x+a[1].x)/2,my=(a[0].y+a[1].y)/2;
        this.panBy(mx-g.mx,my-g.my);g.mx=mx;g.my=my;if(g.d>10)this.zoomAround(g.z+Math.log2(d/g.d),mx,my);return;}
      if(g.mode==="tap"&&Math.hypot(p.x-g.x,p.y-g.y)>7){clearTimeout(lp);g.mode=g.drag?"mdrag":"pan";el.classList.add("drg");if(g.mode==="mdrag")this.fire("markerdragstart",{marker:g.mk});}
      if(g.mode==="pan"){this.panBy(p.x-prev.x,p.y-prev.y);vel.push({x:p.x,y:p.y,t:performance.now()});if(vel.length>6)vel.shift();}
      else if(g.mode==="mdrag"){const ll=this.unproject(p.x,p.y);this.moveMarker(g.mk,ll.lat,ll.lon);this.fire("markerdrag",{marker:g.mk,lat:ll.lat,lon:ll.lon});}});
    const up=e=>{if(!P.has(e.pointerId))return;P.delete(e.pointerId);if(!P.size)el.classList.remove("drg");clearTimeout(lp);if(!g)return;
      if(g.mode==="pinch"){if(P.size===1){const a=[...P.values()][0];g={mode:"pan",x:a.x,y:a.y,t:Date.now(),pinched:true};vel=[];}else if(P.size===0){g=null;const zz=Math.round(this.z);if(Math.abs(zz-this.z)>0.02)this.zoomAnim(zz,this.w/2,this.h/2);else this.moved();}return;}
      if(P.size>0)return;const p=pt(e);
      if(g.mode==="tap"&&e.type==="pointerup"){const ll=this.unproject(p.x,p.y);
        if(g.mk)this.fire("markerclick",{marker:g.mk,lat:g.mk.lat,lon:g.mk.lon,x:p.x,y:p.y});else this.fire("click",{lat:ll.lat,lon:ll.lon,x:p.x,y:p.y});}
      else if(g.mode==="mdrag"){this.fire("markerdragend",{marker:g.mk,lat:g.mk.lat,lon:g.mk.lon});}
      else if(g.mode==="pan"&&g.pinched){const zz=Math.round(this.z);if(Math.abs(zz-this.z)>0.02)this.zoomAnim(zz,p.x,p.y);else this.moved();}
      else if(g.mode==="pan"){const now=performance.now();const v0=vel.filter(v=>now-v.t<120);if(v0.length>1){const a=v0[0],b=v0[v0.length-1],dt=Math.max(16,b.t-a.t);
          let vx=(b.x-a.x)/dt*16,vy=(b.y-a.y)/dt*16;if(Math.hypot(vx,vy)>2){const step=()=>{vx*=0.92;vy*=0.92;if(Math.hypot(vx,vy)<0.5){this.anim=null;this.moved();return;}this.panBy(vx,vy);this.anim.id=requestAnimationFrame(step);};
            this.stop();this.anim={id:requestAnimationFrame(step)};g=null;return;}}this.moved();}
      g=null;};
    el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up);
    el.addEventListener("dblclick",e=>{if(e.target.closest(".bm-ui")||e.target.closest(".bm-mk"))return;const p=pt(e);this.zoomAnim(Math.round(this.z)+(e.shiftKey?-1:1),p.x,p.y);});
    el.addEventListener("wheel",e=>{e.preventDefault();const p=pt(e);const now=Date.now();if(now-lastW>400)wAcc=0;lastW=now;
      const d=e.deltaMode===1?e.deltaY*30:e.deltaY;wAcc+=d;
      if(e.ctrlKey||Math.abs(d)<40&&!Number.isInteger(e.deltaY)){/* Trackpad: fliessend */this.zoomAround(this.z-d*0.01,p.x,p.y);clearTimeout(this._wt);this._wt=setTimeout(()=>{const zz=Math.round(this.z);this.zoomAnim(zz,p.x,p.y);},250);wAcc=0;return;}
      if(Math.abs(wAcc)>=50){const dir=wAcc>0?-1:1;wAcc=0;const base=this.anim?Math.round(this._tz||this.z):Math.round(this.z);this._tz=base+dir;this.zoomAnim(this._tz,p.x,p.y);}},{passive:false});
    /* Rechtsklick (PC) wie langes Drücken – aber nicht doppelt nach einem Finger-Langdruck */
    el.addEventListener("contextmenu",e=>{e.preventDefault();if(Date.now()-(this._lpT||0)<1500||e.target.closest(".bm-ui")||e.target.closest(".bm-mk"))return;const p=pt(e);const ll=this.unproject(p.x,p.y);this.fire("longpress",{lat:ll.lat,lon:ll.lon,x:p.x,y:p.y});});}
}
return {Map:Map_,TileLayer,lonX,latY,xLon,yLat};
})();
