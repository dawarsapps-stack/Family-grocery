import fs from 'node:fs';

const dataPath = 'public/data/trip-v2.json';
const trip = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const findBy = (arr, key, value) => (arr || []).find(item => item?.[key] === value);
const removeBy = (arr, key, values) => (arr || []).filter(item => !values.includes(item?.[key]));
const requireItem = (arr, key, value, label) => {
  const item = findBy(arr, key, value);
  if (!item) throw new Error(`Solo-route patch failed: missing ${label || value}`);
  return item;
};

trip.version = '2.4';
trip.routeSummary = 'Argentina → Atacama → Bolivia → Rio → Paraty → Rio → Iguaçu → Rio → Cartagena → Medellín → Bogotá';

const day25 = requireItem(trip.days, 'date', '2026-09-25', '25 Sep day');
const day26 = requireItem(trip.days, 'date', '2026-09-26', '26 Sep day');
const day01 = requireItem(trip.days, 'date', '2026-10-01', '1 Oct day');
const day02 = requireItem(trip.days, 'date', '2026-10-02', '2 Oct day');
const day03 = requireItem(trip.days, 'date', '2026-10-03', '3 Oct day');

Object.assign(day25, {
  cityId: 'san-pedro-de-atacama',
  title: 'Mendoza → Atacama',
  country: 'Chile',
  phase: 'solo',
  travellerIds: ['sahil'],
  intro: 'Skip Santiago completely and make the Andes-to-desert jump in one travel day.',
  anchor: 'Mendoza → Calama the same day, then straight to San Pedro de Atacama.',
  timeline: {
    morning: [
      'Leave Mendoza for Calama (CJC) on the best same-day routing. One air connection is acceptable; Santiago is transit only, not a stop.',
      'Keep the 40L backpack in cabin and avoid a checked-bag connection.'
    ],
    afternoon: [
      'Continue to Calama, then take a shared airport transfer to San Pedro de Atacama.',
      'Check in, hydrate and keep the first hours gentle at altitude.'
    ],
    evening: [
      'First San Pedro wander, simple Andean dinner and an early night.',
      'Do not stack a major excursion onto the travel day.'
    ],
    eat: [
      'Travel-day food should be practical; save the better San Pedro meals for the next two nights.'
    ],
    logistics: [
      'Search MDZ → CJC as one same-day journey; a connection is fine, but there is no Santiago overnight.',
      'Shared CJC → San Pedro transfer is the default on arrival.'
    ]
  },
  watchOut: 'Do not book separate tickets with an unsafe connection buffer. Protect the Calama arrival and onward transfer.',
  sleepText: 'San Pedro de Atacama - first of three nights.',
  placeIds: (day26.placeIds || []).slice(0, 1),
  restaurantIds: [],
  activityIds: [],
  transportIds: ['flight-03'],
  stayId: 'stay-04',
  locked: false,
  flexibility: 'semi-flexible',
  decision: 'TARGET / RECONFIRM — MDZ → CJC same day; Santiago removed',
  lat: day26.lat,
  lon: day26.lon,
  timeZone: day26.timeZone
});

day26.intro = 'A full first desert day: acclimatise in San Pedro, then let the full moon become part of the landscape rather than fighting it.';
day26.anchor = 'Valle de la Luna sunset + indigenous full-moon astronomy.';
day26.timeline = {
  morning: [
    'Slow breakfast, hydrate and acclimatise in town.',
    'Easy San Pedro orientation: adobe streets, market/cafés and a short low-altitude wander rather than a punishing high-altitude excursion.'
  ],
  afternoon: [
    'Valle de la Luna late afternoon; salt formations and desert sunset.',
    'Keep the first full day around San Pedro altitude rather than immediately forcing 4,500m.'
  ],
  evening: [
    'Dinner in town.',
    'Alarkapin-style full-moon / Andean astronomy experience: Moon, bright planets/objects and indigenous sky interpretation.'
  ],
  eat: [
    'Lunch: La Picada del Indio or similar local meal.',
    'Dinner: Adobe / a good small Andean kitchen; try llama, quinoa or rica-rica.'
  ],
  logistics: [
    'You are already in San Pedro from the night before.',
    '26 Sep is full moon; use that deliberately rather than buying a misleading Milky Way tour.'
  ]
};
day26.transportIds = [];
day26.sleepText = 'San Pedro de Atacama - second night.';

Object.assign(day02, {
  cityId: 'la-paz',
  title: 'La Paz · Day 2',
  country: 'Bolivia',
  phase: 'solo',
  travellerIds: ['sahil'],
  intro: 'A second La Paz day lets the city breathe instead of treating it as a one-night altitude stop.',
  anchor: 'Historic La Paz at street level, then the canyon geography from above.',
  timeline: {
    morning: [
      'Slow start after the previous night: Plaza Murillo / historic centre, Mercado de las Brujas and Mercado Lanza at street level.',
      'Stop for salteñas and coffee rather than turning the morning into a museum checklist.'
    ],
    afternoon: [
      'Use Mi Teleférico again for the city-scale views, then head to Valle de la Luna / Zona Sur if energy and weather are good.',
      'Keep the day flexible at altitude; the point is texture, not box-ticking.'
    ],
    evening: [
      'Make this the refined Bolivian dinner night: Gustu / Arami if the reservation works.',
      'One drink afterwards in Zona Sur if you feel good; no need to manufacture nightlife.'
    ],
    eat: [
      'Salteña, api, anticucho if comfortable with street food, then one serious modern-Bolivian dinner.'
    ],
    logistics: [
      'Second La Paz night. Pack for an early/efficient flight to Rio the next day.',
      'Stay in Calacoto / Zona Sur for clean airport and evening logistics.'
    ]
  },
  watchOut: 'La Paz is ~3,650m. Even after the Altiplano, hydrate and do not turn a good day into an altitude test.',
  sleepText: 'La Paz - second night.',
  placeIds: [...(day01.placeIds || [])],
  restaurantIds: [...(day01.restaurantIds || [])],
  activityIds: [],
  transportIds: [],
  stayId: 'stay-06',
  locked: false,
  flexibility: 'flexible',
  decision: '',
  lat: day01.lat,
  lon: day01.lon,
  timeZone: day01.timeZone
});

day03.intro = 'The group converges in Rio on the same day: Sahil drops from La Paz to sea level while Niki, Priyesh and Amisha arrive from London and Dubai.';
day03.anchor = 'Everyone’s first shared Brazil memory is Rio - beach, sunset and a real welcome dinner.';
day03.timeline = {
  morning: [
    'Sahil: fly La Paz → Rio on the shortest sensible routing, ideally via Santa Cruz with cabin baggage only.',
    'Niki / Priyesh / Amisha travel toward Rio on their booked or selected long-haul routings.'
  ],
  afternoon: [
    'Sahil arrives GIG and transfers to Ipanema/Arpoador/Leblon; shower, laundry and reset from the Altiplano.',
    'Priyesh & Amisha target Emirates EK247 DXB→GIG; Niki arrives directly from London. Build real airport buffers.'
  ],
  evening: [
    'Once all four are in: Arpoador / Ipanema for first drinks and beach energy.',
    'Polished Brazilian welcome dinner, then music only if everyone still has energy.'
  ],
  eat: [
    'Pão de queijo / pastel / mate / caipirinha.',
    'Dinner should feel Brazilian, not generic hotel luxury.'
  ],
  logistics: [
    'Do not pre-book an early-evening non-refundable event; three separate arrival streams are converging.',
    'Two rooms from tonight.'
  ]
};
day03.transportIds = ['flight-07', 'flight-08', 'flight-09'];

trip.stays = removeBy(trip.stays, 'id', ['stay-03']);
const sanPedroStay = requireItem(trip.stays, 'id', 'stay-04', 'San Pedro stay');
Object.assign(sanPedroStay, {
  dateLabel: '25–28 Sep',
  checkIn: '2026-09-25',
  checkOut: '2026-09-28',
  note: 'Three nights in San Pedro; arrive straight from Mendoza, no Santiago overnight'
});
const laPazStay = requireItem(trip.stays, 'id', 'stay-06', 'La Paz stay');
Object.assign(laPazStay, {
  dateLabel: '1–3 Oct',
  checkIn: '2026-10-01',
  checkOut: '2026-10-03',
  note: 'Two La Paz nights: arrival day + one full city day'
});
const rioStay = requireItem(trip.stays, 'id', 'stay-07', 'Rio stay');
Object.assign(rioStay, {
  checkIn: '2026-10-03',
  dateLabel: '3–6 Oct',
  note: 'Rio begins when the group converges on 3 Oct; no solo Rio reset night'
});

const flight03 = requireItem(trip.transport, 'id', 'flight-03', 'flight-03');
Object.assign(flight03, {
  type: 'air',
  date: '2026-09-25',
  fromLabel: 'Mendoza',
  toLabel: 'Calama',
  route: 'Mendoza (MDZ) → Calama (CJC)',
  originCode: 'MDZ',
  destinationCode: 'CJC',
  status: 'TARGET / RECONFIRM',
  locked: false,
  flexibility: 'semi-flexible',
  note: 'Same-day route to Atacama; one connection acceptable. Santiago is transit only, not a stop.',
  travellerIds: ['sahil'],
  options: [{
    id: 'current',
    label: 'MDZ → CJC same day · best sensible routing',
    carrierOrMode: 'Flight TBD',
    depart: '25 Sep · morning / early afternoon preferred',
    arrive: 'Same day',
    stops: null,
    duration: '',
    price: null,
    currency: 'GBP',
    baggage: '40L cabin backpack required; verify fare allowance before payment',
    status: 'TARGET / RECONFIRM',
    note: 'One connection is fine; no Santiago overnight and no checked bag.'
  }],
  selectedOptionId: null
});
trip.transport = removeBy(trip.transport, 'id', ['flight-04']);
const flight07 = requireItem(trip.transport, 'id', 'flight-07', 'La Paz to Rio flight');
Object.assign(flight07, {
  date: '2026-10-03',
  fromLabel: 'La Paz',
  toLabel: 'Rio (GIG)',
  route: 'La Paz → Rio (GIG)',
  originCode: 'LPB',
  destinationCode: 'GIG',
  status: 'TARGET / RECONFIRM',
  locked: false,
  flexibility: 'semi-flexible',
  note: 'Leave after two La Paz nights and join the group in Rio on 3 Oct; shortest useful routing preferred.',
  travellerIds: ['sahil'],
  options: [{
    id: 'current',
    label: 'LPB → GIG · shortest useful routing',
    carrierOrMode: '1 stop via VVI preferred',
    depart: '3 Oct · early / efficient departure',
    arrive: '3 Oct',
    stops: 1,
    duration: '',
    price: null,
    currency: 'GBP',
    baggage: '40L cabin backpack required; verify fare allowance before payment',
    status: 'TARGET / RECONFIRM',
    note: 'Prioritise arrival early enough to join the first group evening in Rio.'
  }],
  selectedOptionId: null
});

trip.cities = removeBy(trip.cities, 'id', ['santiago']);
trip.places = removeBy(trip.places, 'id', [
  'place-providencia-santiago',
  'place-cerro-san-crist-bal-santiago',
  'place-borag-santiago'
]);
trip.restaurants = removeBy(trip.restaurants, 'id', ['borago']);
trip.bookings = removeBy(trip.bookings, 'id', ['borago']);

fs.writeFileSync(dataPath, JSON.stringify(trip) + '\n');
console.log('Solo route updated: Santiago removed, Mendoza→Atacama direct travel day, two La Paz nights');
