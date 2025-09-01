// app.mjs — ES module (full file)

import * as Y from "https://esm.sh/yjs@13.6.27";

// ---------- Small helpers ----------
const $ = (s) => /** @type {HTMLElement} */ (document.querySelector(s));
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const COLORS = ["#6EE7B7","#93C5FD","#FBCFE8","#FDE68A","#C7D2FE","#FCA5A5"];

// Base64 helpers for Yjs updates over P2PT
function u8ToB64(u8){let s="";const ch=0x8000;for(let i=0;i<u8.length;i+=ch)s+=String.fromCharCode.apply(null,u8.subarray(i,i+ch));return btoa(s)}
function b64ToU8(b){const s=atob(b);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u}

// ---------- Room code ----------
const url = new URL(location.href);
let room = url.searchParams.get("room");
if (!room) { room = code4(); url.searchParams.set("room", room); history.replaceState(null,"",url.toString()); }
byId("room").textContent = `Room: ${room}`;
function code4(){ const cs="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:4},()=>cs[Math.floor(Math.random()*cs.length)]).join(""); }

// ---------- Presence ----------
const LS_NAME = "icekmeans:name";
let myName = localStorage.getItem(LS_NAME) || `Guest ${room}`;
const nameInput = /** @type {HTMLInputElement} */ (byId("name"));
nameInput.value = myName;
byId("saveName").addEventListener("click",()=>{ myName = nameInput.value.trim() || myName; localStorage.setItem(LS_NAME,myName); sendHello(); renderPresence(); });
function initials(n){ return (n||"??").trim().split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||"").join("") || "??"; }

// ---------- Yjs doc (DEFINE THIS BEFORE ANY LISTENERS USE IT) ----------
const ydoc = new Y.Doc();
const yCards = ydoc.getArray("cards");        // FlavorCard[]
const yCentroids = ydoc.getArray("centroids");// Centroid[]
const yMeta = ydoc.getMap("meta");            // mode, iteration, seededJessica, pos:*, prevSnapshot

// ---------- P2P over P2PT ----------
let p2p = null;
const TRACKERS = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.fastcast.nz",
  "wss://tracker.webtorrent.dev",
  "wss://tracker.files.fm:7073/announce",
  "wss://tracker.btorrent.xyz/",
];
const ICE = [{urls:"stun:stun.cloudflare.com:3478"},{urls:"stun:stun.l.google.com:19302"}];
const peers = new Map();         // id -> {name?}
const namesSeen = new Set();     // display names we've learned
let trackersUp = 0;              // trackerconnect count

function setStatusChip(){
  const s = byId("status");
  const N = peers.size;
  s.textContent = `Peers: ${N} | Trackers: ${trackersUp}/${TRACKERS.length}`;
  s.classList.toggle("ok", N > 0);
  s.classList.toggle("warn", N === 0);
  s.classList.add("chip");
}
function renderPresence(){
  const box = byId("presence"); box.innerHTML = "";
  const order = [myName, ...Array.from(namesSeen).filter(n=>n!==myName)];
  for(const n of order.slice(0,6)){
    const el = document.createElement("div"); el.className="avatar"; el.title=n; el.textContent=initials(n); box.appendChild(el);
  }
}
function sendHello(){ try{ if(!p2p) return; for(const peer of p2p.peers.values()) p2p.send(peer,`HELLO:${myName}`);}catch{} }
function sendRoster(){ try{ if(!p2p) return; const roster=JSON.stringify([myName, ...namesSeen]); for(const peer of p2p.peers.values()) p2p.send(peer,`ROSTER:${roster}`);}catch{} }
function broadcastUpdate(updateU8){ try{ if(!p2p) return; const payload = "U:" + u8ToB64(updateU8); for(const peer of p2p.peers.values()) p2p.send(peer,payload);}catch{} }

function initP2P(){
  try{
    if(!("P2PT" in window)) throw new Error("P2PT missing");
    const topic = `icekmeans:${room}`;
    p2p = new window.P2PT(TRACKERS, topic, { rtcConfig: { iceServers: ICE } });

    p2p.on("trackerconnect", ()=>{ trackersUp = Math.min(TRACKERS.length, trackersUp+1); setStatusChip(); });
    p2p.on("trackerclose",   ()=>{ trackersUp = Math.max(0, trackersUp-1); setStatusChip(); });

    p2p.on("peerconnect", peer=>{
      peers.set(peer.id,{});
      setStatusChip();
      try{
        p2p.send(peer,`HELLO:${myName}`);
        p2p.send(peer,`ROSTER:${JSON.stringify([myName, ...namesSeen])}`);
        p2p.send(peer,"U:"+u8ToB64(Y.encodeStateAsUpdate(ydoc))); // one-shot full sync
      }catch{}
    });

    p2p.on("peerclose", peer=>{ peers.delete(peer.id); setStatusChip(); });

    p2p.on("msg",(peer,msg)=>{
      try{
        const s = typeof msg === "string" ? msg : "";
        if(s.startsWith("U:")){ Y.applyUpdate(ydoc, b64ToU8(s.slice(2))); return; }
        if(s.startsWith("HELLO:")){ const name=s.slice(6).trim(); if(name){ const p=peers.get(peer.id)||{}; p.name=name; peers.set(peer.id,p); namesSeen.add(name); renderPresence(); } return; }
        if(s.startsWith("ROSTER:")){ try{ const list=JSON.parse(s.slice(7)); if(Array.isArray(list)) list.forEach(n=> typeof n==="string" && namesSeen.add(n)); renderPresence(); }catch{} return; }
      }catch{}
    });

    p2p.start();
  }catch(e){ console.warn("P2P disabled:", e); }
}

// Broadcast Yjs updates
ydoc.on("update", (u)=> broadcastUpdate(u));

// ---------- Model helpers ----------
function txn(fn){ ydoc.transact(fn); }
function nextColor(){ const used=new Set(yCentroids.toArray().map(c=>c.color)); for(const c of COLORS) if(!used.has(c)) return c; return COLORS[Math.floor(Math.random()*COLORS.length)]; }
function addCentroid(name){
  if(yCentroids.length>=3){ alert("You can have at most 3 centroids."); return; }
  txn(()=> yCentroids.push([{ id:`c:${Date.now()}-${Math.random().toString(36).slice(2,7)}`, name: name||`Centroid ${yCentroids.length+1}`, color: nextColor(), locked:false }]));
}
function removeCentroid(id){
  txn(()=>{
    const arr=yCards.toArray();
    arr.forEach((card,i)=>{
      if(card.assignedTo===id){
        yCards.delete(i,1); yCards.insert(i,[{...arr[i],assignedTo:null}]);
        yMeta.delete(`pos:${card.id}`);
      }
    });
    const idx=yCentroids.toArray().findIndex(c=>c.id===id);
    if(idx>=0) yCentroids.delete(idx,1);
  });
}
function addCard({id,title,traits,assignedTo=null,createdBy}){
  txn(()=> yCards.push([{id,title,traits,assignedTo,createdBy}]));
}
function updateCardAssign(cardId, centroidIdOrNull){
  txn(()=>{
    const arr=yCards.toArray();
    const idx=arr.findIndex(c=>c.id===cardId);
    if(idx>=0){
      const updated={...arr[idx], assignedTo: centroidIdOrNull};
      yCards.delete(idx,1); yCards.insert(idx,[updated]);
      if(!centroidIdOrNull) yMeta.delete(`pos:${cardId}`);
    }
  });
}
function setCardPos(cardId, x, y){ txn(()=> yMeta.set(`pos:${cardId}`, {x,y})); }
function getCardPos(cardId){ return yMeta.get(`pos:${cardId}`) || null; }
function shuffleUnassigned(){
  txn(()=>{
    const arr=yCards.toArray(), A=[], U=[];
    for(const c of arr){ (c.assignedTo ? A : U).push(c); }
    for(let i=U.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [U[i],U[j]]=[U[j],U[i]]; }
    yCards.delete(0,yCards.length); yCards.push([...A, ...U]);
  });
}
function restartAll(){
  txn(()=>{
    const arr=yCards.toArray();
    for(let i=0;i<arr.length;i++){
      if(arr[i].assignedTo){
        const up={...arr[i], assignedTo:null};
        yCards.delete(i,1); yCards.insert(i,[up]);
      }
    }
    yMeta.forEach((v,k)=>{ if(String(k).startsWith("pos:")) yMeta.delete(k); });
  });
}
function deleteCard(id){
  txn(()=>{
    const arr=yCards.toArray(); const i=arr.findIndex(c=>c.id===id);
    if(i>=0) yCards.delete(i,1);
    yMeta.delete(`pos:${id}`);
  });
}

// ---------- Seeds / Test data (Jessica) ----------
const JESSICA = { id:"seed:jessica", title:"Jessica", traits:["Fresh","Sorbet"] };

function ensureJessicaOnce(){
  const seeded = yMeta.get("seededJessica");
  const has = yCards.toArray().some(c=>c.id==="seed:jessica");
  if(!seeded && !has){
    txn(()=>{ addCard({...JESSICA, createdBy:"seed"}); yMeta.set("seededJessica", true); });
  }
}
function dedupeSeeds(){
  const seen=new Map(), del=[];
  yCards.toArray().forEach((c,i)=>{ if(c.id?.startsWith?.("seed:")){ if(seen.has(c.id)) del.push(i); else seen.set(c.id,i); } });
  if(del.length) txn(()=> del.sort((a,b)=>b-a).forEach(i=> yCards.delete(i,1)));
}
function populateTestData(){
  // 11 entries with fixed IDs seed:t1..seed:t11
  const items=[
    ["seed:t1","Nguyen","Sweet","Creamy"],
    ["seed:t2","Patel","Fresh","Sorbet"],
    ["seed:t3","Garcia","Chocolatey","Crunchy"],
    ["seed:t4","Rossi","Milky","Silky"],
    ["seed:t5","Kim","Nutty","Creamy"],
    ["seed:t6","Smith","Fruity","Swirled"],
    ["seed:t7","Ahmed","Bitter","Rich"],
    ["seed:t8","Lopez","Sweet","Colorful"],
    ["seed:t9","Chen","Rich","Spicy"],
    ["seed:t10","Nils","Espresso","Hot"],       // outlier
    ["seed:t11","sally","Vegan","Not Sweet"],   // outlier
  ];
  txn(()=>{
    const existing=new Set(yCards.toArray().map(c=>c.id));
    for(const [id,title,a,b] of items){
      if(!existing.has(id)) yCards.push([{id,title,traits:[a,b],assignedTo:null,createdBy:"seed"}]);
    }
  });
  dedupeSeeds();
}
function hardReset(){
  txn(()=>{
    yMeta.forEach((v,k)=>{ if(String(k).startsWith("pos:")) yMeta.delete(k); });
    yCards.delete(0,yCards.length);
    yCentroids.delete(0,yCentroids.length);
    yMeta.set("iteration",0);
    yMeta.set("mode", byId("mode")?.value || "learn");
    yMeta.set("seededJessica", false);
    yCards.push([{...JESSICA,assignedTo:null,createdBy:"seed"}]);
    yMeta.set("seededJessica", true);
    yMeta.delete("prevSnapshot");
  });
}

// ---------- Top controls ----------
byId("copy").addEventListener("click", async ()=>{
  try{ await navigator.clipboard.writeText(location.href); const b=byId("copy"); b.textContent="Copied!"; setTimeout(()=>b.textContent="Copy link",1200); }
  catch{ alert("Copy failed. Use the address bar."); }
});
byId("populate").addEventListener("click", populateTestData);
byId("addCentroid").addEventListener("click",()=>{ const i=/** @type {HTMLInputElement} */(byId("centroidName")); addCentroid(i.value.trim()); i.value=""; });
byId("addCard").addEventListener("click",()=>{
  const t=/** @type {HTMLInputElement} */(byId("flavorTitle"));
  const a=/** @type {HTMLInputElement} */(byId("traitA"));
  const b=/** @type {HTMLInputElement} */(byId("traitB"));
  const title=t.value.trim(); if(!title) return;
  addCard({ id:`card:${Date.now()}-${Math.random().toString(36).slice(2,7)}`, title, traits:[a.value.trim(), b.value.trim()], assignedTo:null, createdBy: myName||"anon" });
  t.value=a.value=b.value="";
});
byId("coin").addEventListener("click",()=> alert(Math.random()<0.5?"Heads":"Tails"));
byId("d12").addEventListener("click",()=> alert(`d12 → ${1+Math.floor(Math.random()*12)}`));
byId("shuffle").addEventListener("click",()=>{
  const n=yCards.toArray().map(c=>c.title);
  for(let i=n.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [n[i],n[j]]=[n[j],n[i]]; }
  alert("Suggested order:\n\n"+n.join("\n"));
});
byId("shuffleUnassigned").addEventListener("click", shuffleUnassigned);
byId("restartAll").addEventListener("click", restartAll);
byId("export").addEventListener("click",()=>{
  const data={ cards:yCards.toArray(), centroids:yCentroids.toArray(), meta:Object.fromEntries(yMeta.entries()) };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`kmeans-room-${room}.json`; a.click(); URL.revokeObjectURL(a.href);
});
byId("import").addEventListener("change", async ev=>{
  const f=/** @type {HTMLInputElement} */(ev.target).files?.[0]; if(!f) return;
  try{
    const text=await f.text(); const json=JSON.parse(text);
    txn(()=>{
      yCards.delete(0,yCards.length);
      yCentroids.delete(0,yCentroids.length);
      if(Array.isArray(json.cards)) yCards.push(json.cards);
      if(Array.isArray(json.centroids)) yCentroids.push(json.centroids);
      if(json.meta && typeof json.meta==="object"){ for(const [k,v] of Object.entries(json.meta)) yMeta.set(k,v); }
    });
    dedupeSeeds();
  }catch(e){ alert("Import failed: "+e.message); }
  finally { /** @type {HTMLInputElement} */(ev.target).value=""; }
});
byId("reset").addEventListener("click",()=>{ if(confirm("Reset board and re-seed Jessica?")) hardReset(); });

const modeSel = /** @type {HTMLSelectElement} */(byId("mode"));
const iterInput = /** @type {HTMLInputElement} */(byId("iter"));
modeSel.addEventListener("change",()=> txn(()=> yMeta.set("mode", modeSel.value)));
iterInput.addEventListener("change",()=> txn(()=> yMeta.set("iteration", parseInt(iterInput.value||"0")||0)));

// ---------- Rendering ----------
function renderAll(){
  setStatusChip();
  renderPresence();
  renderCanvas();
  renderUnassigned();
  renderKMeans();
  syncMeta();
}
function syncMeta(){ const m=yMeta.get("mode"); if(m) modeSel.value=m; const it=yMeta.get("iteration"); if(typeof it==="number") iterInput.value=String(it); }

// Keep canvas tall enough
function computeMinHeightPx(){
  const n = yCards.length;
  const cardH = 110, gap = 10, header = 64, base = 260;
  return Math.max(base, header + n * (cardH + gap));
}

function renderCanvas(){
  const wrap = byId("canvas"); wrap.innerHTML = "";
  const cents = yCentroids.toArray();

  if(!cents.length){
    const empty=document.createElement("div");
    empty.className="muted"; empty.style.padding="6px";
    empty.textContent="Add up to 3 centroids. Each appears here as a section where you can drop cards.";
    wrap.appendChild(empty);
    return;
  }

  const minH = computeMinHeightPx();

  for(const c of cents){
    const zone=document.createElement("div");
    zone.className="centroid";
    zone.dataset.centroidId=c.id;
    zone.style.minHeight = `${minH}px`;

    const head=document.createElement("div"); head.className="head";
    const nameRow=document.createElement("div"); nameRow.className="name-row";
    const sw=document.createElement("span"); sw.className="color"; sw.style.background=c.color;
    const nameInp=document.createElement("input"); nameInp.className="name"; nameInp.value=c.name; nameInp.placeholder="Centroid name";
    nameInp.addEventListener("change",()=>{
      txn(()=>{
        const arr=yCentroids.toArray();
        const idx=arr.findIndex(x=>x.id===c.id);
        if(idx>=0){ const upd={...arr[idx], name: nameInp.value.trim()||arr[idx].name}; yCentroids.delete(idx,1); yCentroids.insert(idx,[upd]); }
      });
    });
    nameRow.append(sw,nameInp);
    const right=document.createElement("div"); right.className="row";
    const lockBtn=document.createElement("button"); lockBtn.className="btn ghost"; lockBtn.textContent=c.locked?"Unlock":"Lock";
    lockBtn.addEventListener("click",()=>{
      txn(()=>{
        const arr=yCentroids.toArray(); const idx=arr.findIndex(x=>x.id===c.id);
        if(idx>=0){ const upd={...arr[idx], locked: !arr[idx].locked}; yCentroids.delete(idx,1); yCentroids.insert(idx,[upd]); }
      });
    });
    const rmBtn=document.createElement("button"); rmBtn.className="btn danger"; rmBtn.textContent="Remove";
    rmBtn.addEventListener("click",()=>{ if(confirm(`Remove centroid "${c.name}"?`)) removeCentroid(c.id); });
    right.append(lockBtn, rmBtn);
    head.append(nameRow, right);

    const hint=document.createElement("div"); hint.className="hint"; hint.textContent="Drop flavor cards here";
    zone.append(head, hint);

    zone.addEventListener("dragover", ev=>{ ev.preventDefault(); zone.classList.add("drop-target"); });
    zone.addEventListener("dragleave", ()=> zone.classList.remove("drop-target"));
    zone.addEventListener("drop", ev=>{
      ev.preventDefault(); zone.classList.remove("drop-target");
      if(c.locked) return;
      const id=ev.dataTransfer?.getData("text/plain"); if(!id) return;
      const rect=zone.getBoundingClientRect();
      const dx = dragCtx.dx ?? 90; const dy = dragCtx.dy ?? 24;
      let x = ( (ev.clientX - rect.left) - dx ) / rect.width;
      let y = ( (ev.clientY - rect.top)  - dy ) / rect.height;
      x = Math.min(0.92, Math.max(0.02, x));
      y = Math.min(0.92, Math.max(0.10, y));
      txn(()=>{
        updateCardAssign(id, c.id);
        yMeta.set(`pos:${id}`, {x,y});
      });
    });

    const cards=yCards.toArray().filter(card=>card.assignedTo===c.id);
    for(const card of cards){
      const el = cardEl(card, true);
      const pos = getCardPos(card.id) || {x:0.05, y:0.18};
      el.style.left = (pos.x*100).toFixed(4)+"%";
      el.style.top  = (pos.y*100).toFixed(4)+"%";
      zone.appendChild(el);
    }

    wrap.appendChild(zone);
  }
}

function cardEl(card, floating=false){
  const el=document.createElement("div");
  el.className="card"+(floating?" float":"");
  el.id = `card-${card.id}`;
  el.draggable = true;
  el.dataset.cardId = card.id;

  const title=document.createElement("div"); title.className="title"; title.textContent=card.title;
  const traits=document.createElement("div"); traits.className="muted"; traits.textContent=`${card.traits?.[0]||""} • ${card.traits?.[1]||""}`;

  const row=document.createElement("div"); row.className="row";
  const sel=document.createElement("select");
  const optN=document.createElement("option"); optN.value=""; optN.textContent="Unassigned"; sel.appendChild(optN);
  for(const c of yCentroids.toArray()){ const o=document.createElement("option"); o.value=c.id; o.textContent=c.name; sel.appendChild(o); }
  sel.value = card.assignedTo || "";
  sel.addEventListener("change",()=> updateCardAssign(card.id, sel.value || null));

  const del=document.createElement("button"); del.className="btn danger"; del.textContent="Delete";
  del.addEventListener("click",()=>{ if(confirm(`Delete "${card.title}"?`)) deleteCard(card.id); });

  row.append(sel, del);
  el.append(title, traits, row);

  el.addEventListener("dragstart", ev=>{
    ev.dataTransfer?.setData("text/plain", card.id);
    el.classList.add("dragging");
    const r = el.getBoundingClientRect?.() || {left:0,top:0};
    dragCtx = { id: card.id, dx: (ev.clientX||0)-r.left, dy: (ev.clientY||0)-r.top };
  });
  el.addEventListener("dragend", ()=> el.classList.remove("dragging"));

  return el;
}

function renderUnassigned(){
  const wrap=byId("unassigned"); wrap.innerHTML="";
  const cards=yCards.toArray().filter(c=>!c.assignedTo);
  if(!cards.length){ const empty=document.createElement("div"); empty.className="muted"; empty.textContent="No unassigned cards."; wrap.appendChild(empty); }
  else for(const c of cards) wrap.appendChild(cardEl(c,false));

  wrap.addEventListener("dragover", ev=> ev.preventDefault());
  wrap.addEventListener("drop", ev=>{
    ev.preventDefault();
    const id=ev.dataTransfer?.getData("text/plain");
    if(id){ txn(()=>{ updateCardAssign(id, null); yMeta.delete(`pos:${id}`); }); }
  });
}

// ---------- Dashboard: traits + cohesion (BOTH traits), deltas, suggestions ----------
function normTokens(s){
  if(!s) return [];
  return String(s)
    .split(/[/,&•+]|(?:\s+and\s+)|\||,/gi)
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => x.toLowerCase());
}
function titleCase(s){ return s.replace(/\w\S*/g, w => w[0].toUpperCase()+w.slice(1)); }
function tokensForCard(card){
  const a = normTokens(card?.traits?.[0]);
  const b = normTokens(card?.traits?.[1]);
  return new Set([...a, ...b]); // include BOTH traits, dedup within card
}
function traitCountsFor(cards){
  const map = new Map();
  for(const c of cards){
    const toks = tokensForCard(c);
    for(const t of toks){
      const prev = map.get(t) || { label: titleCase(t), count: 0 };
      prev.count += 1;
      map.set(t, prev);
    }
  }
  return map;
}
function cohesionFor(cards){
  const n = cards.length; if(n<=1) return 1;
  const sets = cards.map(tokensForCard);
  let share=0;
  for(let i=0;i<n;i++){
    let ok=false;
    for(let j=0;j<n && !ok;j++){
      if(i===j) continue;
      for(const t of sets[i]){ if(sets[j].has(t)){ ok=true; break; } }
    }
    if(ok) share++;
  }
  return share/n;
}
function suggestionFromCounts(map){
  const arr=[...map.values()].sort((a,b)=> b.count-a.count || a.label.localeCompare(b.label));
  if(!arr.length) return null;
  return arr[1] ? `${arr[0].label} + ${arr[1].label}` : arr[0].label;
}
function snapshotMetrics(){
  const cards=yCards.toArray(), cents=yCentroids.toArray();
  const counts={}, coh={};
  for(const c of cents){
    const cs = cards.filter(x=>x.assignedTo===c.id);
    counts[c.id]=cs.length;
    coh[c.id]=cohesionFor(cs);
  }
  const vals=Object.values(counts);
  const max=vals.length?Math.max(...vals):0;
  const min=vals.length?Math.min(...vals):0;
  const gap=max-min;
  const ratio=min?(max/min):(max?Infinity:1);
  const avgC = Object.values(coh).length ? Object.values(coh).reduce((a,b)=>a+b,0)/Object.values(coh).length : 1;
  return { counts, cohesion:coh, balance:{max,min,gap,ratio}, avgCohesion:avgC };
}
// snapshot prev on iteration change
let lastIter = yMeta.get("iteration");
yMeta.observe(e=>{
  if(e.keysChanged && e.keysChanged.has("iteration")){
    const cur = yMeta.get("iteration");
    if(cur !== lastIter){
      yMeta.set("prevSnapshot", snapshotMetrics());
      lastIter = cur;
    }
  }
  renderAll();
});

function renderKMeans(){
  const root=byId("kmeans"); root.innerHTML="";
  const cents=yCentroids.toArray(); const cards=yCards.toArray(); const total=cards.length; const unassigned=cards.filter(c=>!c.assignedTo).length;

  const now=snapshotMetrics(); const prev=yMeta.get("prevSnapshot")||null;

  const metrics=document.createElement("div"); metrics.className="km-metrics";
  metrics.append(chip(`k = ${cents.length}`, "k = number of clusters (centroids). Pick it before you start. In k-means, k is fixed; smaller k generalizes, larger k can overfit."));
  const bal=chip(`balance gap = ${now.balance.gap}`, "Largest cluster size minus smallest. Closer to 0 is more balanced.");
  metrics.append(bal);
  const avg=chip(`avg cohesion = ${(now.avgCohesion*100|0)}%`, "Average within-cluster cohesion: share of cards that share ≥1 trait with another card in the same cluster. Higher is tighter.");
  metrics.append(avg);
  metrics.append(chip(`unassigned = ${unassigned}`, "Cards not yet assigned. Many unassigned may indicate outliers or unclear cluster themes."));
  if(prev){
    const dGap=now.balance.gap-prev.balance.gap;
    const dC=Math.round((now.avgCohesion-prev.avgCohesion)*100);
    metrics.append(deltaSpan(dGap<=0?` (↑ tighter ${Math.abs(dGap)})`:` (↓ looser ${dGap})`, dGap<=0));
    metrics.append(deltaSpan(dC===0?" (±0)":(dC>0?` (+${dC}pp)`:` (${dC}pp)`), dC>=0));
  }
  root.appendChild(metrics);

  for(const c of cents){
    const row=document.createElement("div"); row.className="kmrow";

    const count=now.counts[c.id]||0;
    const nameChip=chip(`${c.name}: ${count}`); nameChip.style.borderColor="#2a2f3d"; row.appendChild(nameChip);

    const bar=document.createElement("div"); bar.className="bar";
    const fill=document.createElement("div"); fill.className="fill"; fill.style.background=c.color;
    const pct=total?Math.round((count/total)*100):0; fill.style.width=`${pct}%`; bar.appendChild(fill);
    row.appendChild(bar);

    const coh=now.cohesion[c.id]??1;
    const cohChip=chip(`cohesion = ${Math.round(coh*100)}%`, "Within this cluster: % of cards that share ≥1 trait with someone else here. Aim high (tighter clusters).");
    if(prev){const p=prev.cohesion?.[c.id]??1;const d=Math.round((coh-p)*100);cohChip.appendChild(deltaSpan(d===0?" (±0)":(d>0?` (+${d}pp)`:` (${d}pp)`), d>=0))}
    row.appendChild(cohChip);

    const clusterCards=cards.filter(x=>x.assignedTo===c.id);
    const counts=traitCountsFor(clusterCards);
    const top=[...counts.values()].sort((a,b)=> b.count-a.count || a.label.localeCompare(b.label)).slice(0,3);
    const traits=document.createElement("div"); traits.className="traits-inline"; traits.title="Dominant traits in this cluster";
    traits.textContent = top.length ? `Top: ${top.map(t=>`${t.label} (${t.count})`).join(", ")}` : "Top: —";
    row.appendChild(traits);

    const sug=suggestionFromCounts(counts);
    const sInline=document.createElement("div"); sInline.className="suggest-inline";
    sInline.textContent = sug ? `Suggested: ${sug}` : "Suggested: —";
    if(sug){
      const btn=document.createElement("button"); btn.className="btn ghost"; btn.textContent="Use";
      btn.addEventListener("click",()=>applySuggestedName(c.id,sug));
      sInline.appendChild(document.createTextNode(" "));
      sInline.appendChild(btn);
    }
    row.appendChild(sInline);

    root.appendChild(row);
  }

  function chip(text, tip){ const el=document.createElement("div"); el.className="chip"; el.textContent=text; if(tip) el.title=tip; return el; }
  function deltaSpan(text, good){ const s=document.createElement("span"); s.className="delta"+(good?"":" bad"); s.textContent=text; return s; }
}
function applySuggestedName(id,name){
  txn(()=>{ const arr=yCentroids.toArray(); const i=arr.findIndex(c=>c.id===id); if(i>=0){ const up={...arr[i], name}; yCentroids.delete(i,1); yCentroids.insert(i,[up]); } });
}

// ---------- Drag context ----------
let dragCtx = { id:null, dx:90, dy:24 };

// ---------- Observe & init ----------
yCards.observeDeep(()=> renderAll());
yCentroids.observeDeep(()=> renderAll());
// yMeta.observe above (snapshots) already re-renders

initP2P();
ensureJessicaOnce();
renderAll();
dedupeSeeds();
sendHello();
sendRoster();
setStatusChip();
