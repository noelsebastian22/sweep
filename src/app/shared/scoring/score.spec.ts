import {
  DEFAULT_SCORING_WEIGHTS,
  computeScore,
  mergeScoringWeights,
  penaltyBranch,
  scoreBreakdown,
} from './score';

describe('score.ts', () => {
  describe('penaltyBranch (website_kind mapping, AC-2)', () => {
    it('maps none to noWebsite', () => {
      expect(penaltyBranch('none', null, DEFAULT_SCORING_WEIGHTS)).toBe('noWebsite');
    });

    it('maps null to noWebsite', () => {
      expect(penaltyBranch(null, null, DEFAULT_SCORING_WEIGHTS)).toBe('noWebsite');
    });

    it('maps social to socialOnly', () => {
      expect(penaltyBranch('social', 90, DEFAULT_SCORING_WEIGHTS)).toBe('socialOnly');
    });

    it('maps site with a null psi_score to psiUnmeasured', () => {
      expect(penaltyBranch('site', null, DEFAULT_SCORING_WEIGHTS)).toBe('psiUnmeasured');
    });

    it('maps site below poorThreshold to psiPoor', () => {
      expect(penaltyBranch('site', 39, DEFAULT_SCORING_WEIGHTS)).toBe('psiPoor');
    });

    it('maps site exactly at poorThreshold to psiMedium (poor is strictly below)', () => {
      expect(penaltyBranch('site', 40, DEFAULT_SCORING_WEIGHTS)).toBe('psiMedium');
    });

    it('maps site at mediumThreshold to psiMedium (inclusive)', () => {
      expect(penaltyBranch('site', 70, DEFAULT_SCORING_WEIGHTS)).toBe('psiMedium');
    });

    it('maps site above mediumThreshold to psiGood', () => {
      expect(penaltyBranch('site', 71, DEFAULT_SCORING_WEIGHTS)).toBe('psiGood');
    });
  });

  describe('computeScore null handling (matches harvest.mjs exactly)', () => {
    it('treats a null rating as 0', () => {
      expect(computeScore(null, 100, 'none', null)).toBe(0);
    });

    it('treats a null rating_count as 0', () => {
      expect(computeScore(4.5, null, 'none', null)).toBe(0);
    });

    it('computes the full formula: rating_count * (rating/5) * penalty', () => {
      // 89 reviews, 4.8 rating, no website (penalty 1.0)
      const s = computeScore(4.8, 89, 'none', null);
      expect(s).toBeCloseTo(89 * (4.8 / 5) * 1.0, 5);
    });

    it('applies the socialOnly penalty (0.9)', () => {
      const s = computeScore(4.8, 89, 'social', null);
      expect(s).toBeCloseTo(89 * (4.8 / 5) * 0.9, 5);
    });

    it('applies psiPoor (0.5) for a poor PSI score', () => {
      const s = computeScore(4.8, 89, 'site', 20);
      expect(s).toBeCloseTo(89 * (4.8 / 5) * 0.5, 5);
    });

    it('applies psiGood (0.0) for a good PSI score', () => {
      const s = computeScore(4.8, 89, 'site', 95);
      expect(s).toBe(0);
    });
  });

  describe('mergeScoringWeights (AC-2 fallback paths)', () => {
    it('returns the default constants when no row exists (null)', () => {
      expect(mergeScoringWeights(null)).toEqual(DEFAULT_SCORING_WEIGHTS);
    });

    it('returns the default constants when the row is undefined', () => {
      expect(mergeScoringWeights(undefined)).toEqual(DEFAULT_SCORING_WEIGHTS);
    });

    it('merges a partial row field by field over the defaults', () => {
      const merged = mergeScoringWeights({ noWebsite: 0.7 });
      expect(merged.noWebsite).toBe(0.7);
      expect(merged.socialOnly).toBe(DEFAULT_SCORING_WEIGHTS.socialOnly);
      expect(merged.poorThreshold).toBe(DEFAULT_SCORING_WEIGHTS.poorThreshold);
    });

    it('ignores non-numeric or missing keys in a malformed row', () => {
      const merged = mergeScoringWeights({ noWebsite: undefined as unknown as number });
      expect(merged.noWebsite).toBe(DEFAULT_SCORING_WEIGHTS.noWebsite);
    });
  });

  describe('scoreBreakdown (AC-7 derivation string)', () => {
    it('produces the pieces to render "85.4 = 89 reviews × (4.8/5) × 1.0 (no website)"', () => {
      const b = scoreBreakdown(4.8, 89, 'none', null);
      expect(b.ratingCount).toBe(89);
      expect(b.rating).toBe(4.8);
      expect(b.penalty).toBe(1.0);
      expect(b.penaltyLabel).toBe('no website');
      expect(b.score).toBeCloseTo(89 * (4.8 / 5) * 1.0, 5);
    });

    it('labels a poor PSI site correctly', () => {
      const b = scoreBreakdown(4.0, 50, 'site', 30);
      expect(b.penaltyLabel).toBe('poor PSI');
      expect(b.penalty).toBe(0.5);
    });
  });
});
