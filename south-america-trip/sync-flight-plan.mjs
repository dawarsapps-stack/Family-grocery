import fs from 'node:fs';

const dataPath = 'public/data/trip-v2.json';
const trip = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const removeById = (arr, ids) => (arr || []).filter(x => !ids.includes(x?.id));
const upsertById = (arr, item) => {
  const out = [...(arr || [])];
  const i = out.findIndex(x => x?.id === item.id);
  if (i >= 0) out[i] = { ...out[i], ...item };
  else out.push(item);
  return out;
};

function simpleFlight(id, date, route, mode, timing, status, note) {
  return {
    id, date, route, mode, timing, status, note,
    options: [{ id: 'current', label: `${mode} · ${timing}`, mode, timing, status, note }]
  };
}

// Keep the canonical flight list aligned with the revised itinerary.
trip.flights = removeById(trip.flights, ['flight-04']);
[
  simpleFlight('flight-03', '2026-09-25', 'Mendoza (MDZ) → Calama (CJC)', 'Same-day flight · 1 connection acceptable', 'Morning / early afternoon departure; arrive Calama same day', 'TARGET / RECONFIRM', 'Santiago is transit only, never an overnight stop. Continue CJC → San Pedro by shared transfer.'),
  simpleFlight('flight-07', '2026-10-03', 'La Paz (LPB) → Rio (GIG)', '1 stop via VVI preferred', 'Early / efficient departure on 3 Oct', 'TARGET / RECONFIRM', 'After two La Paz nights; reach Rio early enough to join the first group evening.'),
  simpleFlight('flight-10', '2026-10-09', 'Rio (GIG) → Iguaçu (IGU)', 'GOL G31860', '07:00 → 09:05', 'TARGET / RECONFIRM', 'Protect the Argentine falls day. Four travellers.'),
  simpleFlight('flight-11', '2026-10-10', 'Iguaçu (IGU) → Rio (GIG)', 'GOL G31867', '18:15 → 20:10', 'TARGET / RECONFIRM', 'Brazilian side first, then back to Rio for Saturday night. Four travellers.'),
  simpleFlight('flight-12', '2026-10-06', 'Rio de Janeiro → Paraty', 'Private road transfer', 'Afternoon · ~4–5h', 'RECOMMENDED', 'Final Rio morning, then door-to-door to Paraty.'),
  simpleFlight('flight-13', '2026-10-08', 'Paraty → Rio de Janeiro', 'Private road transfer', 'Late morning / early afternoon · ~4–5h', 'RECOMMENDED', 'Return to Rio for the reset night before Iguaçu.'),
  simpleFlight('flight-14', '2026-10-11', 'Rio (GIG) → London (LHR)', 'British Airways BA248', '~16:45 departure', 'RECONFIRM', 'Niki returns to London.'),
  simpleFlight('flight-15', '2026-10-11', 'Rio (GIG) → Bogotá (BOG)', 'Avianca AV260', '07:20 → 11:45', 'CHOSEN / RECONFIRM PRICE', 'Sahil + Priyesh + Amisha. This is the chosen morning departure for the Cartagena journey.'),
  simpleFlight('flight-16', '2026-10-11', 'Bogotá (BOG) → Cartagena (CTG)', 'LATAM LA4114', '17:00 → ~18:30', 'TARGET / RECONFIRM', 'Same-day onward connection after AV260; long, comfortable connection buffer in Bogotá.')
].forEach(f => { trip.flights = upsertById(trip.flights, f); });

// Keep the richer transport records in sync as well.
trip.transport = removeById(trip.transport, ['flight-04', 'flight-15b']);
const transportItems = [
  {
    id:'flight-10', type:'air', date:'2026-10-09', fromLabel:'Rio de Janeiro', toLabel:'Foz do Iguaçu', route:'Rio (GIG) → Iguaçu (IGU)', originCode:'GIG', destinationCode:'IGU', status:'TARGET / RECONFIRM', note:'GOL G31860 chosen timing: 07:00 → 09:05', travellerIds:['sahil','niki','priyesh','amisha'],
    options:[{id:'current',label:'GOL G31860 · 07:00 → 09:05',carrierOrMode:'GOL',depart:'07:00 on 9 Oct',arrive:'09:05',stops:0,duration:'2h05',price:null,currency:'GBP',baggage:'40L cabin bag required; use bag-inclusive fare',status:'TARGET / RECONFIRM',note:'Early enough to protect Argentine falls day'}], selectedOptionId:null
  },
  {
    id:'flight-11', type:'air', date:'2026-10-10', fromLabel:'Foz do Iguaçu', toLabel:'Rio de Janeiro', route:'Iguaçu (IGU) → Rio (GIG)', originCode:'IGU', destinationCode:'GIG', status:'TARGET / RECONFIRM', note:'GOL G31867 chosen timing: 18:15 → 20:10', travellerIds:['sahil','niki','priyesh','amisha'],
    options:[{id:'current',label:'GOL G31867 · 18:15 → 20:10',carrierOrMode:'GOL',depart:'18:15 on 10 Oct',arrive:'20:10',stops:0,duration:'1h55',price:null,currency:'GBP',baggage:'40L cabin bag required; use bag-inclusive fare',status:'TARGET / RECONFIRM',note:'Preserves the Brazilian falls day'}], selectedOptionId:null
  },
  {
    id:'flight-12', type:'ground', date:'2026-10-06', fromLabel:'Rio de Janeiro', toLabel:'Paraty', route:'Rio de Janeiro → Paraty', originCode:'', destinationCode:'', status:'RECOMMENDED', note:'Private road transfer after a final Rio morning', travellerIds:['sahil','niki','priyesh','amisha'],
    options:[{id:'current',label:'Private road transfer · Rio → Paraty',carrierOrMode:'Private road transfer',depart:'Afternoon 6 Oct',arrive:'',stops:null,duration:'4–5h approx',price:null,currency:'GBP',baggage:'Door-to-door',status:'RECOMMENDED',note:'Allow daylight and traffic buffer'}], selectedOptionId:null
  },
  {
    id:'flight-13', type:'ground', date:'2026-10-08', fromLabel:'Paraty', toLabel:'Rio de Janeiro', route:'Paraty → Rio de Janeiro', originCode:'', destinationCode:'', status:'RECOMMENDED', note:'Return to Rio on 8 Oct', travellerIds:['sahil','niki','priyesh','amisha'],
    options:[{id:'current',label:'Private road transfer · Paraty → Rio',carrierOrMode:'Private road transfer',depart:'Late morning / early afternoon 8 Oct',arrive:'',stops:null,duration:'4–5h approx',price:null,currency:'GBP',baggage:'Door-to-door',status:'RECOMMENDED',note:'Rio reset night before Iguaçu'}], selectedOptionId:null
  },
  {
    id:'flight-14', type:'air', date:'2026-10-11', fromLabel:'Rio de Janeiro', toLabel:'London', route:'Rio (GIG) → London (LHR)', originCode:'GIG', destinationCode:'LHR', status:'RECONFIRM', note:'Niki · BA248 around 16:45', travellerIds:['niki'],
    options:[{id:'current',label:'BA248 · GIG → LHR',carrierOrMode:'British Airways',depart:'~16:45 on 11 Oct',arrive:'',stops:0,duration:'',price:null,currency:'GBP',baggage:'Reconfirm allowance',status:'RECONFIRM',note:'Niki returns to London'}], selectedOptionId:null
  },
  {
    id:'flight-15', type:'air', date:'2026-10-11', fromLabel:'Rio de Janeiro', toLabel:'Bogotá', route:'Rio (GIG) → Bogotá (BOG)', originCode:'GIG', destinationCode:'BOG', status:'CHOSEN / RECONFIRM PRICE', note:'Sahil + Priyesh + Amisha · AV260 07:20 → 11:45', travellerIds:['sahil','priyesh','amisha'],
    options:[{id:'current',label:'Avianca AV260 · 07:20 → 11:45',carrierOrMode:'Avianca',depart:'07:20 on 11 Oct',arrive:'11:45',stops:0,duration:'6h25',price:null,currency:'GBP',baggage:'40L cabin bag required; verify fare includes overhead bag',status:'CHOSEN / RECONFIRM PRICE',note:'Chosen 7am departure for the Cartagena journey'}], selectedOptionId:null
  },
  {
    id:'flight-16', type:'air', date:'2026-10-11', fromLabel:'Bogotá', toLabel:'Cartagena', route:'Bogotá (BOG) → Cartagena (CTG)', originCode:'BOG', destinationCode:'CTG', status:'TARGET / RECONFIRM', note:'Same-day onward connection after AV260', travellerIds:['sahil','priyesh','amisha'],
    options:[{id:'current',label:'LATAM LA4114 · 17:00 → ~18:30',carrierOrMode:'LATAM',depart:'17:00 on 11 Oct',arrive:'~18:30',stops:0,duration:'~1h30',price:null,currency:'GBP',baggage:'40L cabin bag required; verify Light or bag-inclusive fare',status:'TARGET / RECONFIRM',note:'Comfortable connection after the 11:45 international arrival'}], selectedOptionId:null
  }
];
transportItems.forEach(t => { trip.transport = upsertById(trip.transport, t); });

// 11 Oct day must reflect the new 07:20 Rio departure, not the old late-afternoon AV146 plan.
const day11 = (trip.days || []).find(d => d.date === '2026-10-11');
if (day11) {
  Object.assign(day11, {
    title: 'Rio split · Cartagena via Bogotá / Niki → London',
    intro: 'The trio leave Rio early for Cartagena via Bogotá; Niki has a final Rio morning before her London flight.',
    anchor: 'Sahil + Priyesh + Amisha: AV260 GIG → BOG 07:20, then BOG → CTG at 17:00. Niki: BA248 to London later that afternoon.',
    timeline: {
      morning: ['Sahil + Priyesh + Amisha: early transfer to GIG.', 'Avianca AV260 GIG → BOG 07:20 → 11:45.', 'Niki keeps the morning in Rio before heading to GIG later.'],
      afternoon: ['Trio clear formalities in Bogotá, eat and reset during the connection.', 'LATAM LA4114 BOG → CTG at 17:00.', 'Niki: BA248 GIG → LHR at about 16:45.'],
      evening: ['Trio arrive Cartagena around 18:30, transfer to the Walled City / Getsemaní edge, check in and have a first Cartagena dinner.'],
      eat: ['Keep Bogotá lunch practical; first proper Colombian-Caribbean dinner in Cartagena.'],
      logistics: ['Three travellers need the 07:20 Rio departure.', 'Book Cartagena hotel from 11 Oct; physical arrival is now the evening of 11 Oct, not after midnight.']
    },
    transportIds: ['flight-14','flight-15','flight-16'],
    decision: 'CHOSEN — AV260 07:20 GIG→BOG; RECONFIRM BOG→CTG 17:00 and BA248'
  });
}

trip.criticalAlert = '11 Oct: Sahil, Priyesh and Amisha leave Rio early on AV260 at 07:20 for Bogotá, then continue to Cartagena at 17:00. Niki flies BA248 to London later that afternoon.';

const stay10 = (trip.stays || []).find(s => s.id === 'stay-10');
if (stay10) stay10.note = 'Cartagena from 11 Oct; physical arrival around 18:30 after AV260 + Bogotá connection.';

const avBooking = (trip.bookings || []).find(b => b.id === 'av184wingo');
if (avBooking) {
  avBooking.title = 'Sahil/Priyesh/Amisha · GIG → Bogotá → Cartagena · 11 Oct';
  avBooking.reason = 'AV260 07:20 then same-day BOG → CTG around 17:00';
  avBooking.entityId = 'flight-15';
}
const cartHotel = (trip.bookings || []).find(b => b.id === 'cartagenahotel');
if (cartHotel) cartHotel.reason = 'Now arriving Cartagena evening 11 Oct; room required from 11 Oct.';

trip.rules = (trip.rules || []).map(r => r.title === 'Connection discipline' ? {
  ...r,
  text: 'Treat 11 Oct AV260 → Bogotá → Cartagena clinically: cabin luggage where possible, online check-in, comfortable connection buffer, pre-arranged Cartagena transfer, hotel booked from 11 Oct, and live fare/baggage recheck before payment.'
} : r);

fs.writeFileSync(dataPath, JSON.stringify(trip) + '\n');
console.log('Flight plan synced with revised itinerary, including AV260 07:20 Rio → Bogotá → Cartagena');
