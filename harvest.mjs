#!/usr/bin/env node
// Prospect harvester — Google Places (New) + PageSpeed Insights -> Notion.
// Run: node --env-file=.env harvest.mjs        (add --dry to skip writing to Notion)
// Needs: GOOGLE_API_KEY, NOTION_TOKEN in .env

const { GOOGLE_API_KEY, NOTION_TOKEN } = process.env;
const NOTION_DB = 'b4e7f5b5e8b84a48a1ea99c759dc34ed';
const DRY = process.argv.includes('--dry');
const TOP_N = 50;

// 16 x 18 = 288 Text Search calls. Daily quota cap is 500 — keep the product under it.
// [Notion trade name, Google Places type]. The type pins the search to actual trade
// businesses; null means Google has no type for it and we fall back to the filters below.
const TRADES = [
  ['Electrician', 'electrician'], ['Plumber', 'plumber'], ['Builder', 'general_contractor'],
  ['Carpenter', null], ['Landscaper', null], ['Painter', 'painter'],
  ['Roofer', 'roofing_contractor'], ['Concreter', null], ['Tiler', null],
  ['Plasterer', null], ['Bricklayer', null], ['Fencing', null],
  ['Arborist', null], ['Excavation', null], ['Joinery', null], ['Handyman', null],
];

// Places with any of these types are not prospects — lookouts, parks and cafés have
// hundreds of reviews and will otherwise dominate the rankings.
const BLOCKED_TYPES = new Set([
  'tourist_attraction', 'park', 'national_park', 'state_park', 'natural_feature', 'hiking_area',
  // Outdoors / recreation — these carry public phone numbers, so the phone check won't catch them.
  'picnic_ground', 'dog_park', 'garden', 'botanical_garden', 'playground', 'skate_park', 'beach',
  'wildlife_park', 'wildlife_refuge', 'zoo', 'aquarium', 'marina', 'golf_course', 'ski_resort',
  'sports_complex', 'stadium', 'arena', 'swimming_pool', 'athletic_field', 'off_roading_area',
  'observation_deck', 'scenic_point', 'visitor_center', 'historical_landmark', 'historical_place',
  'cultural_landmark', 'monument', 'plaza', 'town_square', 'amusement_park', 'water_park',
  'campground', 'camping_cabin', 'farmstay', 'rv_park', 'lodging', 'hotel', 'motel',
  'bed_and_breakfast', 'cottage', 'resort_hotel', 'guest_house', 'hostel',
  'restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'food_court', 'pub', 'winery',
  'museum', 'art_gallery', 'church', 'place_of_worship', 'cemetery', 'funeral_home',
  'school', 'primary_school', 'secondary_school', 'university', 'library', 'hospital', 'doctor',
  'train_station', 'transit_station', 'bus_station', 'parking', 'gas_station', 'atm', 'bank',
  'supermarket', 'grocery_store', 'shopping_mall', 'convenience_store', 'gym', 'spa',
  'real_estate_agency', 'insurance_agency', 'travel_agency', 'tourist_information_center',
]);
const SUBURBS = ['Katoomba', 'Leura', 'Blackheath', 'Wentworth Falls', 'Springwood', 'Winmalee',
  'Faulconbridge', 'Lawson', 'Hazelbrook', 'Woodford', 'Glenbrook', 'Blaxland',
  'Warrimoo', 'Mount Victoria', 'Medlow Bath', 'Bullaburra', 'Linden', 'Valley Heights'];

const norm = (s) => (s || '').toLowerCase().replace(/\b(pty|ltd|the|and|co)\b/g, '').replace(/[^a-z0-9]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failedQueries = [];
let quotaHit = false;

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) out.push(await fn(items[i++]));
  }));
  return out;
}

// ---------- Google Places (New) Text Search ----------
async function textSearch(trade, type, suburb, useType = true) {
  const body = { textQuery: `${trade} in ${suburb} NSW`, maxResultCount: 20, regionCode: 'AU' };
  if (type && useType) { body.includedType = type; body.strictTypeFiltering = true; }
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      // Field mask drives billing SKU. These fields = Text Search Pro.
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,'
        + 'places.websiteUri,places.rating,places.userRatingCount,places.types,places.primaryType,places.businessStatus',
    },
    body: JSON.stringify(body),
  });
  // If Google doesn't recognise the type name, fall back to an untyped search rather than losing the query.
  if (res.status === 400 && type && useType) return textSearch(trade, type, suburb, false);
  if (!res.ok) {
    failedQueries.push(`${trade}/${suburb} (${res.status})`);
    if (res.status === 429) quotaHit = true;
    else console.error(`  ! ${trade}/${suburb}: ${res.status} ${(await res.text()).slice(0, 160)}`);
    return [];
  }
  return (await res.json()).places || [];
}

// Google's own classification beats the search term that found the place: "Blue Mountains
// Painting" surfaced under a Builder search but is a painter. general_contractor is too
// vague to override with — a plasterer and a tiler both carry it.
const TYPE_TO_TRADE = {
  electrician: 'Electrician', plumber: 'Plumber', painter: 'Painter',
  roofing_contractor: 'Roofer', carpenter: 'Carpenter', locksmith: null,
};
const trueTrade = (p) => TYPE_TO_TRADE[p.primaryType] || p.trade;

// A real prospect is an operational business with a phone that isn't a landmark or a café.
function isTradeBusiness(p) {
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false;
  if (!p.nationalPhoneNumber) return false; // lookouts and picnic areas have no phone
  return !(p.types || []).some((t) => BLOCKED_TYPES.has(t));
}

// ---------- PageSpeed Insights (mobile performance) ----------
// Returns { score, why } — `why` explains a null, so a silent failure is never invisible.
async function psi(url) {
  const q = new URLSearchParams({ url, strategy: 'mobile', category: 'performance', key: GOOGLE_API_KEY });
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`);
      if (res.ok) {
        const s = (await res.json())?.lighthouseResult?.categories?.performance?.score;
        return s == null ? { score: null, why: 'no score returned' } : { score: Math.round(s * 100), why: null };
      }
      last = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) return { score: null, why: last }; // 4xx won't fix itself
    } catch (e) { last = e.message.slice(0, 40); }
    await sleep(3000);
  }
  return { score: null, why: last || 'unreachable' };
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

// ---------- Scoring ----------
const isFacebookOnly = (u) => /facebook\.com|instagram\.com|linktr\.ee/i.test(u || '');
function penalty(p) {
  if (!p.websiteUri) return 1.0;
  if (isFacebookOnly(p.websiteUri)) return 0.9;
  if (p.psiScore == null) return 0.5;          // site exists but PSI failed — treat as poor
  if (p.psiScore < 40) return 0.5;
  if (p.psiScore <= 70) return 0.2;
  return 0.0;
}
const score = (p) => (p.userRatingCount || 0) * ((p.rating || 0) / 5) * penalty(p);
const ceiling = (p) => (p.userRatingCount || 0) * ((p.rating || 0) / 5); // best case, penalty 1.0

// ---------- Notion ----------
const notion = (path, opts = {}) => fetch(`https://api.notion.com/v1/${path}`, {
  ...opts,
  headers: {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
    ...opts.headers,
  },
});

async function existingNames() {
  const names = new Set();
  let cursor;
  do {
    const res = await notion(`databases/${NOTION_DB}/query`, {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    if (!res.ok) throw new Error(`Notion query failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    for (const row of json.results) {
      names.add(norm(row.properties?.Business?.title?.[0]?.plain_text));
    }
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return names;
}

async function createRow(p) {
  const props = {
    Business: { title: [{ text: { content: p.displayName.text.slice(0, 200) } }] },
    Trade: { select: { name: trueTrade(p) } },
    Suburb: { select: { name: p.suburb } },
    Status: { select: { name: 'Identified' } },
    Source: { select: { name: 'Google Places' } },
    'Lead score': { number: Math.round(score(p) * 10) / 10 },
    Notes: { rich_text: [{ text: { content:
      `${p.userRatingCount || 0} reviews, ${p.rating ?? '?'}★. ` +
      `${p.websiteUri ? (isFacebookOnly(p.websiteUri) ? 'Social only.' : `PSI mobile ${p.psiScore ?? 'n/a'}.`) : 'No website.'} ` +
      `${p.formattedAddress || ''} [gplace:${p.id}]`.slice(0, 1900) } }] },
  };
  if (p.nationalPhoneNumber) props.Phone = { phone_number: p.nationalPhoneNumber };
  if (p.websiteUri) props['Current site'] = { url: p.websiteUri };
  if (p.psiScore != null) props['PageSpeed score'] = { number: p.psiScore };

  const res = await notion('pages', {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: NOTION_DB }, properties: props }),
  });
  if (!res.ok) console.error(`  ! ${p.displayName.text}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.ok;
}

// ---------- Main ----------
if (!GOOGLE_API_KEY || !NOTION_TOKEN) {
  console.error('Missing GOOGLE_API_KEY or NOTION_TOKEN. Run with: node --env-file=.env harvest.mjs');
  process.exit(1);
}

const byId = new Map();
const queries = TRADES.flatMap(([trade, type]) => SUBURBS.map((suburb) => ({ trade, type, suburb })));
// Shuffle: if the daily quota runs out mid-run, a partial pass samples every trade
// evenly instead of starving whichever trades sit at the end of the list.
for (let i = queries.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [queries[i], queries[j]] = [queries[j], queries[i]];
}
console.log(`Searching ${queries.length} trade x suburb combinations...`);

let done = 0;
let rejected = 0;
await pool(queries, 5, async ({ trade, type, suburb }) => {
  for (const p of await textSearch(trade, type, suburb)) {
    if (byId.has(p.id)) continue;
    if (!isTradeBusiness(p)) { rejected++; continue; }
    byId.set(p.id, { ...p, trade, suburb });
  }
  if (++done % 20 === 0) console.log(`  ${done}/${queries.length} searched, ${byId.size} unique so far`);
});
console.log(`${byId.size} unique businesses (rejected ${rejected} landmarks / non-trade places).`);
if (failedQueries.length) {
  const pct = Math.round((failedQueries.length / queries.length) * 100);
  console.warn(`\n!! ${failedQueries.length}/${queries.length} searches failed (${pct}% of the map unsearched).`);
  if (quotaHit) console.warn('!! Daily Places quota (500) exhausted. Results are a partial sample — rerun tomorrow for full coverage.');
  console.warn(`!! Missed: ${failedQueries.slice(0, 12).join(', ')}${failedQueries.length > 12 ? ` +${failedQueries.length - 12} more` : ''}\n`);
}

const seen = await existingNames();
let candidates = [...byId.values()].filter((p) => p.displayName?.text && !seen.has(norm(p.displayName.text)));
console.log(`${candidates.length} new (skipped ${byId.size - candidates.length} already in Notion).`);

// Only spend PSI calls on sites that could plausibly reach the top 50.
candidates.sort((a, b) => ceiling(b) - ceiling(a));
const cutoff = ceiling(candidates[TOP_N * 2] || {}) || 0;
const needPsi = candidates.filter((p) => p.websiteUri && !isFacebookOnly(p.websiteUri) && ceiling(p) >= cutoff);
console.log(`Running PageSpeed on ${needPsi.length} sites (~10s each, 4 at a time)...`);
let psiDone = 0;
const psiStart = Date.now();
await pool(needPsi, 4, async (p) => {
  const t = Date.now();
  const { score, why } = await psi(p.websiteUri);
  p.psiScore = score;
  const n = ++psiDone;
  const eta = Math.round(((Date.now() - psiStart) / n) * (needPsi.length - n) / 1000);
  console.log(
    `  [${String(n).padStart(3)}/${needPsi.length}] ${host(p.websiteUri).slice(0, 32).padEnd(32)}` +
    ` ${score == null ? ' --' : String(score).padStart(3)}` +
    ` ${String(Math.round((Date.now() - t) / 1000)).padStart(2)}s` +
    ` eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s` +
    (why ? `  (${why})` : ''),
  );
});

const top = candidates.sort((a, b) => score(b) - score(a)).slice(0, TOP_N);
console.table(top.slice(0, 15).map((p) => ({
  Business: p.displayName.text.slice(0, 32), Type: p.primaryType || '-', Trade: trueTrade(p), Suburb: p.suburb,
  Reviews: p.userRatingCount, Rating: p.rating, PSI: p.psiScore ?? '-', Score: Math.round(score(p) * 10) / 10,
})));

if (DRY) { console.log(`\nDry run — ${top.length} rows not written.`); process.exit(0); }
let written = 0;
let row = 0;
for (const p of top) {
  const ok = await createRow(p);
  if (ok) written++;
  console.log(`  [${String(++row).padStart(2)}/${top.length}] ${ok ? 'ok  ' : 'FAIL'} ${p.displayName.text.slice(0, 44)}`);
  await sleep(350); // Notion rate limit ~3 req/s
}
console.log(`\nWrote ${written}/${top.length} rows to Notion as "Identified".`);
