// Ported verbatim from harvest.mjs (repo root) — the genuinely hard-won logic.
// Only the I/O around these changes; the rules themselves do not.

export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) out.push(await fn(items[i++]));
  }));
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const norm = (s: string | null | undefined) =>
  (s || '').toLowerCase().replace(/\b(pty|ltd|the|and|co)\b/g, '').replace(/[^a-z0-9]/g, '');

// Places with any of these types are not prospects — lookouts, parks and cafés have
// hundreds of reviews and would otherwise dominate the rankings.
export const BLOCKED_TYPES = new Set([
  'tourist_attraction', 'park', 'national_park', 'state_park', 'natural_feature', 'hiking_area',
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

// Google's own classification beats the search term that found the place.
export const TYPE_TO_TRADE: Record<string, string | null> = {
  electrician: 'Electrician', plumber: 'Plumber', painter: 'Painter',
  roofing_contractor: 'Roofer', carpenter: 'Carpenter', locksmith: null,
};

export interface Place {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
}

export function trueTrade(p: Place, searchTradeName: string): string {
  const override = p.primaryType ? TYPE_TO_TRADE[p.primaryType] : undefined;
  return override || searchTradeName;
}

// A real prospect is an operational business with a phone that isn't a landmark or a café.
export function isTradeBusiness(p: Place): boolean {
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return false;
  if (!p.nationalPhoneNumber) return false;
  return !(p.types || []).some((t) => BLOCKED_TYPES.has(t));
}

export const isFacebookOnly = (u: string | null | undefined) =>
  /facebook\.com|instagram\.com|linktr\.ee/i.test(u || '');

export const websiteKind = (u: string | null | undefined): 'none' | 'social' | 'site' => {
  if (!u) return 'none';
  if (isFacebookOnly(u)) return 'social';
  return 'site';
};

// Best-case score (penalty 1.0) — used as the PSI-spend cutoff, never stored.
export const ceiling = (ratingCount: number | null, rating: number | null) =>
  (ratingCount || 0) * ((rating || 0) / 5);
