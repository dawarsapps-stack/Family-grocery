export const mapsSearch = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/**
 * Open several named places in one Google Maps view using a Directions URL.
 * Google Maps does not expose a public URL API that can create a Saved List,
 * so this is the automatic multi-pin fallback. The app also supports shared
 * Google Maps Saved List / My Maps URLs stored in trip state.
 */
export function mapsMultiPin(places, travelmode = 'walking') {
  const pts = (places || []).map(x => String(x || '').trim()).filter(Boolean);
  if (!pts.length) return 'https://www.google.com/maps';
  if (pts.length === 1) return mapsSearch(pts[0]);

  // Keep the URL comfortably inside Google Maps/browser limits. On mobile,
  // Maps may show fewer waypoints than desktop, so Saved Lists remain the
  // preferred city-level experience when a list URL has been configured.
  const capped = pts.slice(0, 9);
  const origin = capped[0];
  const destination = capped[capped.length - 1];
  const waypoints = capped.slice(1, -1);
  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode,
  });
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// Google Flights stores search state in an undocumented protobuf-like `tfs` parameter.
// We generate only the minimal, well-understood one-way fields and keep a text-query fallback.
const concat=(...arrays)=>{const n=arrays.reduce((a,b)=>a+b.length,0),out=new Uint8Array(n);let o=0;for(const a of arrays){out.set(a,o);o+=a.length}return out};
const vari=n=>{let x=BigInt(n),a=[];do{let b=Number(x&127n);x>>=7n;if(x)b|=128;a.push(b)}while(x);return Uint8Array.from(a)};
const key=(f,w)=>vari((f<<3)|w);
const vfield=(f,v)=>concat(key(f,0),vari(v));
const bytes=(f,b)=>concat(key(f,2),vari(b.length),b);
const str=(f,s)=>bytes(f,new TextEncoder().encode(s));
const msg=(f,b)=>bytes(f,b);
const place=code=>concat(vfield(1,1),str(2,code));
const leg=(date,origin,destination)=>concat(str(2,date),msg(13,place(origin)),msg(14,place(destination)));
const b64url=b=>{let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode(...b.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
export function googleFlightsTfs({origin,destination,date}){
  if(!/^[A-Z]{3}$/.test(origin||'')||!/^[A-Z]{3}$/.test(destination||'')||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;
  // fields observed in current Google-generated one-way searches: mode=28, context=2, leg, 1 adult, economy, display=1, one-way=2
  return b64url(concat(vfield(1,28),vfield(2,2),msg(3,leg(date,origin,destination)),vfield(8,1),vfield(9,1),vfield(14,1),vfield(19,2)));
}
export function googleFlightsUrl(t,currency='GBP'){
  const origin=t.originCode||'',destination=t.destinationCode||'';
  const tfs=googleFlightsTfs({origin,destination,date:t.date});
  if(tfs)return `https://www.google.com/travel/flights?tfs=${encodeURIComponent(tfs)}&curr=${encodeURIComponent(currency)}&hl=en-GB`;
  const from=origin||t.fromLabel,to=destination||t.toLabel,q=`Flights from ${from} to ${to} on ${t.date}`;
  return `https://www.google.com/travel/flights?hl=en-GB&curr=${encodeURIComponent(currency)}&q=${encodeURIComponent(q)}`;
}
