import { ScoredLeadRow } from '../leads.store';
import {
  histogram, scoreHistogram, psiHistogram, heatBandMarkers, websiteSplit, leadsOverTime, scanContext,
} from './analytics';

let seq = 0;
function row(partial: Partial<ScoredLeadRow>): ScoredLeadRow {
  seq++;
  return {
    lead_id: `lead-${seq}`, status: 'identified', tenant_id: 't', updated_at: '',
    business_id: `biz-${seq}`, name: `Business ${seq}`, phone: null, website_url: null,
    website_kind: 'none', rating: null, rating_count: null, lat: null, lng: null,
    trade: null, suburb: null, psi_score: null, lcp_ms: null, cls: null, psi_checked_at: null,
    first_seen_scan_id: null, first_seen_scan_started_at: null, score: 0,
    ...partial,
  };
}

describe('analytics band derivations', () => {
  describe('histogram', () => {
    it('puts the top edge in the last bin rather than dropping it', () => {
      const bins = histogram([0, 50, 100], 0, 100, 10);
      expect(bins.length).toBe(10);
      expect(bins[0].count).toBe(1);
      expect(bins[5].count).toBe(1);
      expect(bins[9].count).toBe(1); // 100 belongs to the last bin, not off the end
    });

    it('ignores values outside the range', () => {
      expect(histogram([-5, 105], 0, 100, 10).reduce((n, b) => n + b.count, 0)).toBe(0);
    });

    it('survives a zero-width range', () => {
      expect(() => histogram([0, 0], 0, 0, 20)).not.toThrow();
    });
  });

  it('bins score over [0, max] because score is unbounded', () => {
    const bins = scoreHistogram([row({ score: 0 }), row({ score: 200 })]);
    expect(bins.length).toBe(20);
    expect(bins[0].count).toBe(1);
    expect(bins[19].count).toBe(1);
    expect(bins[19].to).toBeCloseTo(200);
  });

  it('bins PageSpeed over the fixed 0-100 scale and ignores unmeasured rows', () => {
    const bins = psiHistogram([row({ psi_score: 5 }), row({ psi_score: 95 }), row({ psi_score: null })]);
    expect(bins.length).toBe(10);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(2);
  });

  describe('heatBandMarkers', () => {
    it('returns each band max except the top one, which is the chart edge', () => {
      const rows = [
        row({ score: 10 }), row({ score: 20 }),
        row({ score: 30 }), row({ score: 40 }),
      ];
      const bands = new Map([
        [rows[0].lead_id, 0], [rows[1].lead_id, 0],
        [rows[2].lead_id, 1], [rows[3].lead_id, 1],
      ]);
      expect(heatBandMarkers(rows, bands)).toEqual([{ band: 0, score: 20 }]);
    });

    it('ignores rows with no band assignment', () => {
      const rows = [row({ score: 10 }), row({ score: 99 })];
      const bands = new Map([[rows[0].lead_id, 0]]);
      // Only one band present, so its max is the chart edge and there is no marker.
      expect(heatBandMarkers(rows, bands)).toEqual([]);
    });
  });

  it('splits website state into all three buckets, including empty ones', () => {
    const split = websiteSplit([row({ website_kind: 'none' }), row({ website_kind: 'site' })]);
    expect(split.map((s) => s.count)).toEqual([1, 0, 1]);
    expect(split.map((s) => s.key)).toEqual(['none', 'social', 'site']);
  });

  describe('leadsOverTime', () => {
    it('buckets to the Monday of the ISO week', () => {
      // 2026-08-15 is a Saturday; 2026-08-13 a Thursday. Both fall in the week of Mon 10th.
      const buckets = leadsOverTime([
        row({ first_seen_scan_started_at: '2026-08-15T02:00:00Z' }),
        row({ first_seen_scan_started_at: '2026-08-13T22:00:00Z' }),
      ]);
      expect(buckets.length).toBe(1);
      expect(buckets[0].weekStart.slice(0, 10)).toBe('2026-08-10');
      expect(buckets[0].count).toBe(2);
    });

    it('fills empty weeks so a gap in prospecting reads as a gap', () => {
      const buckets = leadsOverTime([
        row({ first_seen_scan_started_at: '2026-08-03T00:00:00Z' }),
        row({ first_seen_scan_started_at: '2026-08-24T00:00:00Z' }),
      ]);
      expect(buckets.length).toBe(4);
      expect(buckets.map((b) => b.count)).toEqual([1, 0, 0, 1]);
    });

    it('ignores rows with no discovery date, and returns nothing when none have one', () => {
      expect(leadsOverTime([row({}), row({})])).toEqual([]);
    });

    it('handles a Sunday, which is day 0 and must not roll forward a week', () => {
      // 2026-08-16 is a Sunday; its ISO week starts Monday the 10th.
      const buckets = leadsOverTime([row({ first_seen_scan_started_at: '2026-08-16T12:00:00Z' })]);
      expect(buckets[0].weekStart.slice(0, 10)).toBe('2026-08-10');
    });
  });

  describe('scanContext', () => {
    it('counts leads per scan, newest scan first', () => {
      const rows = [
        row({ first_seen_scan_id: 'old', first_seen_scan_started_at: '2026-08-01T00:00:00Z' }),
        row({ first_seen_scan_id: 'new', first_seen_scan_started_at: '2026-08-10T00:00:00Z' }),
        row({ first_seen_scan_id: 'new', first_seen_scan_started_at: '2026-08-10T00:00:00Z' }),
        row({ first_seen_scan_id: null }),
      ];
      expect(scanContext(rows)).toEqual([
        { scanId: 'new', startedAt: '2026-08-10T00:00:00Z', count: 2 },
        { scanId: 'old', startedAt: '2026-08-01T00:00:00Z', count: 1 },
      ]);
    });
  });
});
