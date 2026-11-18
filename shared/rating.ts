export type Grade = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export type Tally = { perfects: number; greats: number; goods: number; misses: number; wrongKeys: number; total: number; bestCombo: number };

/** 0 to 100. A run of all Perfect hits with no stray presses is 100. */
export function ratingFor(tally: Tally) {
  const earned = tally.perfects + 0.8 * tally.greats + 0.55 * tally.goods;
  const possible = tally.total + 0.5 * tally.wrongKeys;
  return possible ? Math.max(0, Math.min(100, Math.round(1000 * earned / possible) / 10)) : 0;
}

export function isFullCombo(tally: Tally) {
  // The streak must run unbroken from the first note to the last: a stray press or a dropped sustain ends it.
  return tally.total > 0 && tally.misses === 0 && tally.perfects + tally.greats + tally.goods === tally.total &&
    tally.bestCombo >= tally.total && tally.wrongKeys === 0;
}

export const STAR_RATINGS = [25, 45, 62, 78, 90] as const;

/** 0 to 5 stars. A sixth, gold star needs a full combo at 96 or better. */
export function starsFor(tally: Tally) {
  const rating = ratingFor(tally);
  const stars = STAR_RATINGS.filter(threshold => rating >= threshold).length;
  return stars === 5 && rating >= 96 && isFullCombo(tally) ? 6 : stars;
}

/** Progress from 0 to 5 used by the live star meter. */
export function starProgress(rating: number) {
  let previous = 0;
  for (let i = 0; i < STAR_RATINGS.length; i++) {
    if (rating < STAR_RATINGS[i]) return i + (rating - previous) / (STAR_RATINGS[i] - previous);
    previous = STAR_RATINGS[i];
  }
  return 5;
}

export function gradeFor(tally: Tally, failed = false): Grade {
  if (failed) return 'F';
  const rating = ratingFor(tally);
  if (rating >= 96 && isFullCombo(tally)) return 'S+';
  return rating >= 93 ? 'S' : rating >= 85 ? 'A' : rating >= 72 ? 'B' : rating >= 55 ? 'C' : 'D';
}
