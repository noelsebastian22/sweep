import { parseLeadsUrl, buildLeadsQueryParams, sameQueryParams, LeadsUrlState } from './leads-url-state';
import { LeadsFilterState } from './leads.store';

const EMPTY: LeadsFilterState = {
  trades: [], suburbs: [], websiteKinds: [], statuses: [], heatBands: [],
  psiRange: { min: null, max: null }, ratingMin: null, search: '',
};

/** Reads from a plain object, the way the grid reads from a query param map. */
const from = (params: Record<string, string>) => (key: string) => params[key] ?? null;

describe('leads URL state', () => {
  it('defaults to page 1 and score.desc when the URL is empty', () => {
    const s = parseLeadsUrl(from({}), []);
    expect(s.page).toBe(1);
    expect(s.sort).toEqual({ column: 'score', direction: 'desc' });
    expect(s.filters).toEqual(EMPTY);
  });

  it('falls back to score.desc for an unknown sort column', () => {
    expect(parseLeadsUrl(from({ sort: 'nonsense.asc' }), []).sort).toEqual({ column: 'score', direction: 'desc' });
    expect(parseLeadsUrl(from({ sort: 'rating.asc' }), []).sort).toEqual({ column: 'rating', direction: 'asc' });
  });

  it('round-trips a value containing a comma', () => {
    // The reason each element is percent-encoded before joining: trade and suburb values
    // are free text out of the view. A raw join would split this into two dead filters.
    const state: LeadsUrlState = {
      page: 1,
      sort: { column: 'score', direction: 'desc' },
      filters: { ...EMPTY, trades: ['Smith, Jones & Co', 'Plumber'] },
    };
    const params = buildLeadsQueryParams(state);
    expect(parseLeadsUrl(from(params as Record<string, string>), []).filters.trades)
      .toEqual(['Smith, Jones & Co', 'Plumber']);
  });

  it('encodes an open-ended PSI range on either side', () => {
    expect(buildLeadsQueryParams({ page: 1, sort: { column: 'score', direction: 'desc' }, filters: { ...EMPTY, psiRange: { min: 40, max: null } } })['psi']).toBe('40-');
    expect(buildLeadsQueryParams({ page: 1, sort: { column: 'score', direction: 'desc' }, filters: { ...EMPTY, psiRange: { min: null, max: 40 } } })['psi']).toBe('-40');
    expect(parseLeadsUrl(from({ psi: '20-60' }), []).filters.psiRange).toEqual({ min: 20, max: 60 });
    expect(parseLeadsUrl(from({ psi: '-40' }), []).filters.psiRange).toEqual({ min: null, max: 40 });
    expect(parseLeadsUrl(from({ psi: '40-' }), []).filters.psiRange).toEqual({ min: 40, max: null });
  });

  it('omits page when it is 1, and every empty filter', () => {
    const params = buildLeadsQueryParams({ page: 1, sort: { column: 'score', direction: 'desc' }, filters: EMPTY });
    expect(params['page']).toBeNull();
    expect(params['trades']).toBeNull();
    expect(params['psi']).toBeNull();
    expect(params['rating']).toBeNull();
    // sort is always written, so the URL states the order rather than implying it.
    expect(params['sort']).toBe('score.desc');
  });

  it('drops heat bands that do not exist in the current basis', () => {
    expect(parseLeadsUrl(from({ heat: '0,4,9' }), [0, 1, 2, 3, 4]).filters.heatBands).toEqual([0, 4]);
    expect(parseLeadsUrl(from({ heat: '4' }), [0, 1]).filters.heatBands).toEqual([]);
  });

  it('keeps every heat band when the basis is not known yet', () => {
    // null means the rows have not loaded. Judging bands against an empty basis would make
    // a shared ?heat=4 link silently lose its filter on the way in.
    expect(parseLeadsUrl(from({ heat: '4' }), null).filters.heatBands).toEqual([4]);
  });

  it('rejects statuses and website kinds that are not in the enum', () => {
    const s = parseLeadsUrl(from({ statuses: 'contacted,not_a_status', kinds: 'site,carrier_pigeon' }), []);
    expect(s.filters.statuses).toEqual(['contacted']);
    expect(s.filters.websiteKinds).toEqual(['site']);
  });

  it('treats a missing key and an explicit null as the same, for the loop guard', () => {
    expect(sameQueryParams({ page: null, sort: 'score.desc' }, { sort: 'score.desc' })).toBeTrue();
    expect(sameQueryParams({ page: '2', sort: 'score.desc' }, { sort: 'score.desc' })).toBeFalse();
  });

  it('clamps a nonsensical page rather than propagating it', () => {
    expect(parseLeadsUrl(from({ page: '0' }), []).page).toBe(1);
    expect(parseLeadsUrl(from({ page: '-5' }), []).page).toBe(1);
    expect(parseLeadsUrl(from({ page: 'abc' }), []).page).toBe(1);
  });
});
