export const clone = x => JSON.parse(JSON.stringify(x));
export const addDays = (iso,n) => { const d=new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };

export function initialState(model){
  return {
    revision:0,
    dayOrder:model.days.map(d=>d.id),
    selectedHotels:Object.fromEntries(model.stays.map(s=>[s.id,s.selectedHotelId||''])),
    stayStatuses:Object.fromEntries(model.stays.map(s=>[s.id,s.selectedHotelId?'chosen':'unselected'])),
    stayBookingRefs:{},
    selectedTransportOptions:Object.fromEntries(model.transport.map(t=>[t.id,t.selectedOptionId||''])),
    transportStatuses:Object.fromEntries(model.transport.map(t=>[t.id,t.selectedOptionId?'chosen':'unselected'])),
    transportBookingRefs:{},
    customTransportOptions:{}, customHotelOptions:{},
    bookingStatuses:Object.fromEntries(model.bookings.map(b=>[b.id,b.status||'todo'])),
    restaurantStatuses:Object.fromEntries(model.restaurants.map(r=>[r.id,r.status||'planned'])),
    restaurantBookingRefs:{},
    activityStatuses:Object.fromEntries(model.activities.map(a=>[a.id,a.status||'planned'])),
    activityBookingRefs:{},
    cityMapListUrls:{}, dayMapListUrls:{}, notes:{}, overrides:{days:{},transport:{},stays:{},restaurants:{},activities:{}},
    history:[], updatedAt:null
  };
}

export function effectiveDays(model,state){
  const byId=new Map(model.days.map(d=>[d.id,d]));
  const known=new Set(byId.keys());
  const order=[...(state.dayOrder||[])].filter(id=>known.has(id));
  model.days.forEach(d=>{ if(!order.includes(d.id)) order.push(d.id); });
  return order.map((id,index)=>{
    const base=byId.get(id); const o=state.overrides?.days?.[id]||{};
    return {...base,...o,scheduledDate:addDays(model.tripStart,index),orderIndex:index};
  });
}

export function entitiesById(model){
  const mk=a=>new Map(a.map(x=>[x.id,x]));
  return {days:mk(model.days),transport:mk(model.transport),stays:mk(model.stays),restaurants:mk(model.restaurants),activities:mk(model.activities),cities:mk(model.cities)};
}

function linkedImpacts(model,state,newOrder){
  const oldDays=effectiveDays(model,state); const oldMap=new Map(oldDays.map(d=>[d.id,d.scheduledDate]));
  const nextState={...state,dayOrder:newOrder}; const nextDays=effectiveDays(model,nextState); const maps=entitiesById(model);
  const ops=[], conflicts=[], warnings=[];
  const stayDates=new Map();
  for(const d of nextDays){
    const old=oldMap.get(d.id), next=d.scheduledDate;
    if(old===next) continue;
    ops.push({type:'move_day_date',entityType:'day',entityId:d.id,from:old,to:next,label:d.title});
    if(d.locked) conflicts.push({entityType:'day',entityId:d.id,label:d.title,reason:`Day is locked to ${d.originalDate}.`});
    for(const id of d.transportIds||[]){
      const t=maps.transport.get(id); if(!t) continue;
      if(t.locked && t.date!==next){ conflicts.push({entityType:'transport',entityId:id,label:t.route,reason:`Locked transport remains ${t.date}.`}); }
      else if(t.date!==next) ops.push({type:'set_transport_date',entityType:'transport',entityId:id,from:t.date,to:next,label:t.route});
    }
    for(const id of d.restaurantIds||[]){
      const r=maps.restaurants.get(id); if(!r||r.date===next) continue;
      ops.push({type:'set_restaurant_date',entityType:'restaurant',entityId:id,from:r.date,to:next,label:r.name});
      if(r.flexibility!=='flexible') warnings.push(`${r.name} may require changing a reservation.`);
    }
    for(const id of d.activityIds||[]){
      const a=maps.activities.get(id); if(!a||a.date===next) continue;
      if(a.flexibility==='locked') conflicts.push({entityType:'activity',entityId:id,label:a.name,reason:`Activity is locked to ${a.date}.`});
      else { ops.push({type:'set_activity_date',entityType:'activity',entityId:id,from:a.date,to:next,label:a.name}); if(a.flexibility!=='flexible') warnings.push(`${a.name} may need rebooking.`); }
    }
    if(d.stayId){ const x=stayDates.get(d.stayId)||[]; x.push(next); stayDates.set(d.stayId,x); }
  }
  // include unchanged days when calculating stay ranges
  for(const d of nextDays){ if(d.stayId){ const x=stayDates.get(d.stayId)||[]; if(!x.includes(d.scheduledDate)) x.push(d.scheduledDate); stayDates.set(d.stayId,x); } }
  for(const [sid,dates] of stayDates){
    const s=maps.stays.get(sid); if(!s||!dates.length) continue; const sorted=dates.sort(); const checkIn=sorted[0], checkOut=addDays(sorted.at(-1),1);
    if((s.checkIn&&s.checkIn!==checkIn)||(s.checkOut&&s.checkOut!==checkOut)){
      ops.push({type:'set_stay_dates',entityType:'stay',entityId:sid,from:`${s.checkIn||'?'}→${s.checkOut||'?'}`,to:`${checkIn}→${checkOut}`,checkIn,checkOut,label:`${s.city} stay`});
      if(s.flexibility!=='flexible') warnings.push(`${s.city} hotel dates may need changing.`);
    }
  }
  return {ops,conflicts,warnings,nextDays};
}

export function previewMoveDay(model,state,dayId,targetIndex){
  const order=[...effectiveDays(model,state).map(d=>d.id)]; const from=order.indexOf(dayId);
  if(from<0) throw new Error('Unknown day'); targetIndex=Math.max(0,Math.min(order.length-1,targetIndex));
  order.splice(from,1); order.splice(targetIndex,0,dayId);
  const impact=linkedImpacts(model,state,order); const day=model.days.find(d=>d.id===dayId);
  return {id:`proposal-${Date.now()}`,kind:'move_day',title:`Move ${day.title}`,summary:`Move ${day.title} from position ${from+1} to ${targetIndex+1} and reconcile linked plans.`,newDayOrder:order,...impact,canApply:impact.conflicts.length===0};
}

export function cityBlocks(model,state){
  const days=effectiveDays(model,state); const blocks=[];
  days.forEach(d=>{
    const last=blocks.at(-1);
    if(last&&last.cityId===d.cityId) last.dayIds.push(d.id);
    else blocks.push({cityId:d.cityId,blockId:`${d.cityId}--${d.id}`,dayIds:[d.id]});
  });
  return blocks;
}

export function previewMoveCity(model,state,blockRef,targetBlockIndex){
  const blocks=cityBlocks(model,state);
  // blockRef is normally a unique blockId. Accept a cityId for backwards compatibility
  // and for natural-language requests where the city only appears once.
  const from=blocks.findIndex(b=>b.blockId===blockRef) >= 0
    ? blocks.findIndex(b=>b.blockId===blockRef)
    : blocks.findIndex(b=>b.cityId===blockRef);
  if(from<0) throw new Error('Unknown city block');
  const [block]=blocks.splice(from,1); targetBlockIndex=Math.max(0,Math.min(blocks.length,targetBlockIndex)); blocks.splice(targetBlockIndex,0,block);
  const order=blocks.flatMap(b=>b.dayIds); const impact=linkedImpacts(model,state,order); const city=model.cities.find(c=>c.id===block.cityId);
  return {id:`proposal-${Date.now()}`,kind:'move_city',title:`Move ${city?.name||block.cityId}`,summary:`Move this ${city?.name||block.cityId} stay as one block and reconcile transport, stays, restaurants and activities.`,newDayOrder:order,...impact,canApply:impact.conflicts.length===0};
}

export function proposalFromPrompt(model,state,prompt){
  const p=prompt.toLowerCase(); const days=effectiveDays(model,state);
  const cities=[...model.cities].sort((a,b)=>b.name.length-a.name.length);
  for(const subject of cities){for(const anchor of cities){if(subject.id===anchor.id)continue;for(const rel of ['before','after']){const phrase=`move ${subject.name.toLowerCase()} ${rel} ${anchor.name.toLowerCase()}`;if(p.includes(phrase)){const blocks=cityBlocks(model,state);let target=blocks.findIndex(b=>b.cityId===anchor.id);if(rel==='after')target+=1;return previewMoveCity(model,state,subject.id,target);}}}}
  if(p.includes('extra night')&&p.includes('paraty')){
    const paraty=days.filter(d=>d.cityId==='paraty'); const after=days.find(d=>d.orderIndex===paraty.at(-1)?.orderIndex+1);
    return {id:`proposal-${Date.now()}`,kind:'advice',title:'Extra night in Paraty',summary:'An extra Paraty night cannot be inserted safely without deciding what to remove or move because the 11 Oct international departures are protected.',ops:[],conflicts:after?[{entityType:'constraint',entityId:'paraty-extra',label:'11 Oct departures',reason:'Paraty→GRU timing protects BA246 and AV184.'}]:[],warnings:['Choose which flexible night to sacrifice; AI should not silently delete another destination.'],canApply:false};
  }
  return {id:`proposal-${Date.now()}`,kind:'advice',title:'Trip AI analysis',summary:'I can analyse this request, but the local test build will not invent itinerary changes it cannot validate. The production AI endpoint will return a constrained structured proposal.',ops:[],conflicts:[],warnings:['No changes have been applied.'],canApply:false};
}


export function validateProposal(model,state,input){
  const p=clone(input||{}); p.ops=Array.isArray(p.ops)?p.ops:[]; p.conflicts=Array.isArray(p.conflicts)?p.conflicts:[]; p.warnings=Array.isArray(p.warnings)?p.warnings:[];
  const ids={day:new Set(model.days.map(x=>x.id)),transport:new Set(model.transport.map(x=>x.id)),stay:new Set(model.stays.map(x=>x.id)),restaurant:new Set(model.restaurants.map(x=>x.id)),activity:new Set(model.activities.map(x=>x.id))};
  if(p.newDayOrder){const expected=model.days.map(x=>x.id);const got=p.newDayOrder;if(got.length!==expected.length||new Set(got).size!==got.length||expected.some(id=>!got.includes(id))){p.conflicts.push({entityType:'proposal',entityId:'dayOrder',label:'Invalid day order',reason:'AI proposal did not preserve every itinerary day exactly once.'});}}
  for(const op of p.ops){
    if(!ids[op.entityType]?.has(op.entityId)){p.conflicts.push({entityType:'proposal',entityId:op.entityId||'unknown',label:op.label||'Unknown entity',reason:'Proposal references an entity that is not in the trip.'});continue;}
    if(op.entityType==='transport'){const t=model.transport.find(x=>x.id===op.entityId);if(t?.locked&&op.type==='set_transport_date'&&op.to!==t.date)p.conflicts.push({entityType:'transport',entityId:t.id,label:t.route,reason:`Locked transport cannot move from ${t.date}.`});}
    if(op.entityType==='activity'){const a=model.activities.find(x=>x.id===op.entityId);if(a?.flexibility==='locked'&&op.type==='set_activity_date'&&op.to!==a.date)p.conflicts.push({entityType:'activity',entityId:a.id,label:a.name,reason:`Locked activity cannot move from ${a.date}.`});}
  }
  if(p.newDayOrder){const check={...state,dayOrder:p.newDayOrder};for(const d of effectiveDays(model,check)){if(d.locked&&d.scheduledDate!==d.originalDate)p.conflicts.push({entityType:'day',entityId:d.id,label:d.title,reason:`Locked day must remain ${d.originalDate}.`});}}
  const uniq=[];const seen=new Set();for(const c of p.conflicts){const k=`${c.entityType}:${c.entityId}:${c.reason}`;if(!seen.has(k)){seen.add(k);uniq.push(c)}}p.conflicts=uniq;p.canApply=!!p.canApply&&p.conflicts.length===0;return p;
}
export function applyProposal(model,state,proposal){
  proposal=validateProposal(model,state,proposal);
  if(!proposal.canApply) throw new Error('Proposal has unresolved locked conflicts');
  const prev=clone({...state,history:[]}); const next=clone(state); next.history=[...(state.history||[]),{at:new Date().toISOString(),label:proposal.title,state:prev}].slice(-20);
  if(proposal.newDayOrder) next.dayOrder=[...proposal.newDayOrder];
  next.overrides ||= {days:{},transport:{},stays:{},restaurants:{},activities:{}};
  for(const op of proposal.ops||[]){
    if(op.type==='set_transport_date') (next.overrides.transport[op.entityId] ||= {}).date=op.to;
    if(op.type==='set_restaurant_date') (next.overrides.restaurants[op.entityId] ||= {}).date=op.to;
    if(op.type==='set_activity_date') (next.overrides.activities[op.entityId] ||= {}).date=op.to;
    if(op.type==='set_stay_dates') Object.assign((next.overrides.stays[op.entityId] ||= {}),{checkIn:op.checkIn,checkOut:op.checkOut});
  }
  next.revision=(state.revision||0)+1; next.updatedAt=new Date().toISOString(); return next;
}

export function undoState(state){
  const h=[...(state.history||[])]; const last=h.pop(); if(!last) return state; return {...clone(last.state),history:h,revision:(state.revision||0)+1,updatedAt:new Date().toISOString()};
}
