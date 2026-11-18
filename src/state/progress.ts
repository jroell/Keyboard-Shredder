import { applyRun, normalizeSave, type RunOutcome, type RunSummary } from '../../shared/progression';
import { isTourSongCleared, recordTourResult, TOUR_TRACKS } from '../../shared/tour';
import { lessonStatus, mergeKeyStats, typingStars, TYPING_LESSONS, type KeyStats, type TypingLesson } from '../../shared/typing';
import { keyStatsStore, lessonStore, saveStore, tourStore, wpmStore } from './store';

export type RunExtras = {
  tourAccuracy?: number;
  lesson?: TypingLesson;
  typingAccuracy?: number;
  keyStats?: KeyStats;
  daily?: string;
};
export type Outcome = RunOutcome & {
  lesson?: { passed: boolean; stars: number; next?: TypingLesson; firstPass: boolean };
  tour?: { cleared: boolean; firstClear: boolean };
};

export function localDateKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function tourClearedCount() {
  const progress = tourStore.get();
  return TOUR_TRACKS.filter(track => isTourSongCleared(track.id, progress)).length;
}

export function lessonsPassedCount() {
  const progress = lessonStore.get();
  return TYPING_LESSONS.filter(lesson => lessonStatus(lesson.id, progress) === 'passed').length;
}

/** Records a finished run in every local store and reports what it earned. */
export function completeRun(summary: RunSummary, extras: RunExtras = {}): Outcome {
  const now = new Date();
  let tour: Outcome['tour'];
  if (extras.tourAccuracy !== undefined && !summary.failed) {
    const before = tourStore.get();
    const wasCleared = isTourSongCleared(summary.songId, before);
    const after = recordTourResult(before, summary.songId, extras.tourAccuracy);
    if (after !== before) tourStore.set(after);
    const cleared = isTourSongCleared(summary.songId, after);
    tour = { cleared, firstClear: cleared && !wasCleared };
  }
  let lesson: Outcome['lesson'];
  if (extras.lesson && extras.typingAccuracy !== undefined) {
    const { lesson: item, typingAccuracy } = extras;
    const before = lessonStore.get();
    const previous = before[item.id];
    const wasPassed = lessonStatus(item.id, before) === 'passed';
    const stars = summary.failed ? 0 : typingStars(typingAccuracy, summary.wpm ?? 0, item);
    lessonStore.set({ ...before, [item.id]: {
      bestAccuracy: Math.max(previous?.bestAccuracy ?? 0, summary.failed ? 0 : typingAccuracy),
      bestWpm: Math.max(previous?.bestWpm ?? 0, summary.wpm ?? 0),
      stars: Math.max(previous?.stars ?? 0, stars),
      plays: (previous?.plays ?? 0) + 1,
    } });
    const passed = lessonStatus(item.id, lessonStore.get()) === 'passed';
    const index = TYPING_LESSONS.findIndex(candidate => candidate.id === item.id);
    lesson = { passed: stars > 0, stars, next: passed ? TYPING_LESSONS[index + 1] : undefined, firstPass: passed && !wasPassed };
  }
  if (extras.keyStats) keyStatsStore.set(previous => mergeKeyStats(previous, extras.keyStats!));
  if (summary.wpm && summary.mode === 'typing' && !summary.failed) {
    wpmStore.set(previous => [...previous, {
      at: now.getTime(), wpm: summary.wpm!, accuracy: extras.typingAccuracy ?? summary.rating, lesson: extras.lesson?.title ?? 'Free typing',
    }].slice(-80));
  }
  // A run that earned no stars is not a clear: it earns its notes but no clear bonus and sets no record.
  const judged = summary.stars === 0 && !summary.failed && ['quickplay', 'tour', 'daily', 'challenge'].includes(summary.mode) ? { ...summary, failed: true } : summary;
  const outcome = applyRun(saveStore.get(), judged, now.getTime(), {
    dateKey: localDateKey(now), hour: now.getHours(), tourCleared: tourClearedCount(), lessonsPassed: lessonsPassedCount(),
    dailyKey: extras.daily,
  });
  saveStore.set(outcome.save);
  return { ...outcome, lesson, tour };
}

/**
 * Adds a party result to a saved player who is not the active one on this device.
 * Returns the XP earned and the level reached, or null when that player's save cannot be read.
 */
export function creditPlayer(id: string, summary: RunSummary): { xp: number; level: number; leveled: boolean } | null {
  const key = id ? `ks:${id}:save` : 'ks:save';
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!raw) return null;
    const now = new Date();
    const outcome = applyRun(normalizeSave(raw), summary, now.getTime(), { dateKey: localDateKey(now), hour: now.getHours(), tourCleared: 0, lessonsPassed: 0 });
    localStorage.setItem(key, JSON.stringify(outcome.save));
    return { xp: outcome.xp.total, level: outcome.levelAfter, leveled: outcome.levelAfter > outcome.levelBefore };
  } catch { return null; }
}
