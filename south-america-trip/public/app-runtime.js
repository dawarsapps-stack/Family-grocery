function switchTab(tab){activeTab=tab;$$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${tab}`));$$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));if(tab==='map')setTimeout(initMap,20);window.scrollTo({top:0,behavior:'smooth'});}
async function shareTrip(){const payload={title:data.title,text:"Our South America trip itinerary",url:location.href};if(navigator.share){try{await navigator.share(payload);return;}catch{}}copyLink();}
async function copyLink(){try{await navigator.clipboard.writeText(location.href);toast("Link copied");}catch{toast("Copy the address from your browser.","bad");}}

function updateOwnerUI(){const status=$("#ownerStatus");if(status)status.classList.toggle("editing",ownerMode);const btn=$("#ownerBtn");if(btn)btn.title=ownerMode?"Owner editing on":"Unlock owner editing";}
function openOwnerModal(){const m=$("#ownerModal");if(!m)return;m.innerHTML=`<div class="modal-card"><h3>${ownerMode?"Owner editing is on":"Unlock owner editing"}</h3><p class="muted tiny">Everyone with the link can view the trip. The PIN prevents accidental changes to the shared itinerary.</p>${ownerMode?`<div class="modal-actions"><button class="ghost-button" data-cancel-owner>Cancel</button><button class="danger-button" data-exit-owner>Exit owner mode</button></div>`:`<form id="ownerUnlockForm"><div class="form-stack"><label>Owner PIN<input class="text-input" id="ownerPin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter PIN"></label></div><div class="modal-actions"><button class="ghost-button" type="button" data-cancel-owner>Cancel</button><button class="solid-button" type="submit">Unlock</button></div></form>`}</div>`;m.classList.add("open");m.setAttribute("aria-hidden","false");$("[data-cancel-owner]",m).onclick=()=>closeOwnerModal();$("[data-exit-owner]",m)?.addEventListener("click",()=>{lockOwner();closeOwnerModal();});$("#ownerUnlockForm",m)?.addEventListener("submit",async e=>{e.preventDefault();const pin=$("#ownerPin",m).value.trim();if(!pin)return;adminPin=pin;ownerMode=true;sessionStorage.setItem("trip-admin-pin",pin);const ok=await saveShared(shared,{quiet:true});if(ok){closeOwnerModal();renderAll();toast("Owner editing unlocked");}else{ownerMode=false;sessionStorage.removeItem("trip-admin-pin");}});setTimeout(()=>$("#ownerPin",m)?.focus(),60);}
function closeOwnerModal(){const m=$("#ownerModal");m?.classList.remove("open");m?.setAttribute("aria-hidden","true");}
function lockOwner(){ownerMode=false;adminPin="";sessionStorage.removeItem("trip-admin-pin");renderAll();toast("Owner editing off");}

function bindShell(){
  $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  $("#shareBtn")?.addEventListener("click",shareTrip);
  $("#ownerBtn")?.addEventListener("click",openOwnerModal);
  $("#detailPanel")?.addEventListener("click",e=>{if(e.target.id==="detailPanel")closeDay();});
  $("#ownerModal")?.addEventListener("click",e=>{if(e.target.id==="ownerModal")closeOwnerModal();});
}

async function boot(){
  try{
    const [meta,d1,d2,d3,d4]=await Promise.all([fetchJSON("/trip-meta.json"),fetchJSON("/days-1.json"),fetchJSON("/days-2.json"),fetchJSON("/days-3.json"),fetchJSON("/days-4.json")]);data={...meta,days:[...d1,...d2,...d3,...d4]};canonicalDays=(data.days||[]).map((d,i)=>({...d,id:d.id||`day-${d.date}-${i}`}));
    shared=await loadShared();
    app.innerHTML=shellHTML();bindShell();renderAll();
    if(adminPin){ownerMode=false;}
    if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}
    window.addEventListener('online',async()=>{shared=await loadShared();renderAll();toast("Back online · shared plan refreshed");});
    window.addEventListener('offline',()=>{lastSyncOk=false;updateSyncIndicators();toast("Offline mode · cached trip still works","bad");});
    setInterval(async()=>{if(document.hidden||ownerMode)return;const fresh=await loadShared();if((fresh.revision||0)!==(shared.revision||0)){shared=fresh;renderAll();toast("Trip plan updated");}},30000);
  }catch(err){app.innerHTML=`<div class="boot-screen"><div class="boot-mark">!</div><strong>Could not load the trip</strong><span>${esc(err.message)}</span><button class="solid-button" onclick="location.reload()">Try again</button></div>`;}
}

boot();
