/**
 * Pure port of harvest.mjs's penalty()/score(). No framework imports, no I/O
 * (AGENTS.md hard rule 5) — the grid, map, lead detail, and scoring lab all call this
 * same function so score is always derived, never persisted (hard rule 6).
 */

export type WebsiteKind = 'none' | 'social' | 'site' | null;

export interface ScoringWeights {
  noWebsite: number; // 1.0 — penalty multiplier when there is no website at all
  socialOnly: number; // 0.9 — a Facebook/Instagram/Linktree page standing in for a site
  psiUnmeasured: number; // 0.5 — a site exists but PSI has no score for it
  psiPoor: number; // 0.5 — applied when psi_score < poorThreshold
  psiMedium: number; // 0.2 — applied when psi_score <= mediumThreshold
  psiGood: number; // 0.0 — applied when psi_score > mediumThreshold
  poorThreshold: number; // 40
  mediumThreshold: number; // 70
}

/** harvest.mjs's original penalty()/score() constants, verbatim. Also this weekend's
 * migration seed values and BUILD-PLAN.md §5's ScoringWeights doc — all three must move
 * together if a weight ever changes (score.ts stays dependency-free, so it can't read
 * the others; see spec 0004's key invariants). */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  noWebsite: 1.0,
  socialOnly: 0.9,
  psiUnmeasured: 0.5,
  psiPoor: 0.5,
  psiMedium: 0.2,
  psiGood: 0.0,
  poorThreshold: 40,
  mediumThreshold: 70,
};

/**
 * Merges a loaded scoring_profiles.weights row over the default constants, field by
 * field, so a row missing a key (or a null/undefined row entirely) still yields a fully
 * usable weight set (AC-2).
 */
export function mergeScoringWeights(loaded: Partial<ScoringWeights> | null | undefined): ScoringWeights {
  if (!loaded) return { ...DEFAULT_SCORING_WEIGHTS };
  const merged = { ...DEFAULT_SCORING_WEIGHTS };
  for (const key of Object.keys(DEFAULT_SCORING_WEIGHTS) as (keyof ScoringWeights)[]) {
    const value = loaded[key];
    if (typeof value === 'number') merged[key] = value;
  }
  return merged;
}

export type PenaltyBranch =
  | 'noWebsite'
  | 'socialOnly'
  | 'psiUnmeasured'
  | 'psiPoor'
  | 'psiMedium'
  | 'psiGood';

/** Which penalty branch a row falls into, per AC-2's fixed website_kind mapping. */
export function penaltyBranch(websiteKind: WebsiteKind, psiScore: number | null | undefined, weights: ScoringWeights): PenaltyBranch {
  if (websiteKind === 'none' || websiteKind == null) return 'noWebsite';
  if (websiteKind === 'social') return 'socialOnly';
  // 'site' → the PSI threshold branch
  if (psiScore == null) return 'psiUnmeasured';
  if (psiScore < weights.poorThreshold) return 'psiPoor';
  if (psiScore <= weights.mediumThreshold) return 'psiMedium';
  return 'psiGood';
}

export function penaltyFor(websiteKind: WebsiteKind, psiScore: number | null | undefined, weights: ScoringWeights): number {
  return weights[penaltyBranch(websiteKind, psiScore, weights)];
}

/**
 * The score itself: (rating, rating_count, website_kind, psi_score, weights) → number.
 * rating/rating_count null default to 0; psi_score null is treated as unmeasured — all
 * matching harvest.mjs exactly (AC-2).
 */
export function computeScore(
  rating: number | null | undefined,
  ratingCount: number | null | undefined,
  websiteKind: WebsiteKind,
  psiScore: number | null | undefined,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  const penalty = penaltyFor(websiteKind, psiScore, weights);
  return (ratingCount || 0) * ((rating || 0) / 5) * penalty;
}

/** The grid/drawer's shared label for each website_kind, incl. the null → 'none' fallback. */
export const WEBSITE_KIND_LABEL: Record<'none' | 'social' | 'site', string> = {
  none: 'No website',
  social: 'Social only',
  site: 'Full site',
};

const PENALTY_LABELS: Record<PenaltyBranch, string> = {
  noWebsite: 'no website',
  socialOnly: 'social only',
  psiUnmeasured: 'PSI unmeasured',
  psiPoor: 'poor PSI',
  psiMedium: 'medium PSI',
  psiGood: 'good PSI',
};

export interface ScoreBreakdown {
  score: number;
  ratingCount: number;
  rating: number;
  penalty: number;
  penaltyLabel: string;
}

/** The derivation the AC-7 drawer renders, e.g. "85.4 = 89 reviews × (4.8/5) × 1.0 (no website)". */
export function scoreBreakdown(
  rating: number | null | undefined,
  ratingCount: number | null | undefined,
  websiteKind: WebsiteKind,
  psiScore: number | null | undefined,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): ScoreBreakdown {
  const branch = penaltyBranch(websiteKind, psiScore, weights);
  const penalty = weights[branch];
  const ratingCountResolved = ratingCount || 0;
  const ratingResolved = rating || 0;
  return {
    score: ratingCountResolved * (ratingResolved / 5) * penalty,
    ratingCount: ratingCountResolved,
    rating: ratingResolved,
    penalty,
    penaltyLabel: PENALTY_LABELS[branch],
  };
}
