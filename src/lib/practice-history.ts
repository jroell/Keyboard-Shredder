import type { PracticeRun, PracticeTally } from '../../shared/practice-progress';

const storageKey = (scope: string) => `shredder-practice-history:${scope}`;
const validTally = (value: unknown): value is PracticeTally => {
  const tally = value as PracticeTally | undefined;
  return !!tally && Number.isSafeInteger(tally.attempts) && Number.isSafeInteger(tally.hits) &&
    tally.attempts > 0 && tally.hits >= 0 && tally.hits <= tally.attempts &&
    Number.isFinite(tally.timingTotal) && tally.timingTotal >= 0;
};
const validGroup = (value: unknown) =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(validTally);

function validRun(value: unknown): value is PracticeRun {
  const run = value as PracticeRun | undefined;
  return !!run && typeof run.title === 'string' && typeof run.layout === 'string' &&
    typeof run.playedAt === 'number' && Number.isFinite(new Date(run.playedAt).getTime()) && ['easy', 'normal', 'hard'].includes(run.difficulty) &&
    validTally(run.notes) && validGroup(run.keys) && validGroup(run.chords);
}

export function readPracticeHistory(scope: string): PracticeRun[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(scope)) || '[]');
    return Array.isArray(value) ? value.filter(validRun).slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function writePracticeHistory(scope: string, runs: readonly PracticeRun[]) {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(runs));
    return true;
  } catch {
    return false;
  }
}
