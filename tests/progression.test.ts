import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyRun, emptySave, isUnlocked, levelFor, normalizeSave, recordKey, unlocksAt, xpForRun,
} from '../shared/progression';
import type { RunExtra, RunSummary, XpContext } from '../shared/progression';

const summary: RunSummary = {
  songId: 'practice-track',
  mode: 'quickplay',
  difficulty: 'medium',
  mods: ['sudden'],
  score: 1200,
  rating: 90,
  stars: 5,
  grade: 'A',
  perfects: 12,
  greats: 6,
  goods: 2,
  misses: 0,
  wrongKeys: 0,
  totalNotes: 20,
  bestCombo: 20,
  fullCombo: true,
  failed: false,
  boostsUsed: 0,
  durationMs: 60_000,
};

const context: XpContext = {
  firstClear: true, newBest: true, firstRunToday: true, streakDays: 9,
};
const now = Date.UTC(2026, 0, 30, 14);
const extra: RunExtra = { dateKey: '2026-01-30', hour: 14 };

test('Level one starts at 0 XP and level two starts at 300 XP.', () => {
  assert.deepEqual(levelFor(0), {
    level: 1, title: 'Garage rookie', current: 0, needed: 300, progress: 0,
  });
  assert.deepEqual(levelFor(299), {
    level: 1, title: 'Garage rookie', current: 299, needed: 300, progress: 299 / 300,
  });
  assert.deepEqual(levelFor(300), {
    level: 2, title: 'Garage rookie', current: 0, needed: 420, progress: 0,
  });
});

test('The title changes at level five and progress stays full at level fifty.', () => {
  assert.equal(levelFor(1919).title, 'Garage rookie');
  assert.equal(levelFor(1920).title, 'Opening act');
  assert.equal(levelFor(155_819).level, 49);
  assert.equal(levelFor(155_820).level, 50);
  const capped = levelFor(1_000_000);
  assert.equal(capped.level, 50);
  assert.equal(capped.title, 'Keyboard shredder');
  assert.equal(capped.progress, 1);
});

test('A clean run earns hit, star, full combo, first clear, streak and win XP.', () => {
  assert.deepEqual(xpForRun({ ...summary, won: true }, context), {
    total: 480,
    parts: [
      { label: 'Notes hit', xp: 40 },
      { label: 'Stars', xp: 100 },
      { label: 'Full combo', xp: 100 },
      { label: 'First clear', xp: 75 },
      { label: 'Day streak', xp: 105 },
      { label: 'Win', xp: 60 },
    ],
  });
});

test('A higher-scoring replay earns new best XP.', () => {
  const xp = xpForRun(summary, { ...context, firstClear: false, firstRunToday: false });
  assert.deepEqual(xp.parts.find(part => part.label === 'New best'), { label: 'New best', xp: 40 });
});

test('A failed run earns only 40 percent of its note hit XP.', () => {
  assert.deepEqual(xpForRun({ ...summary, mode: 'daily', failed: true, won: true }, context), {
    total: 16, parts: [{ label: 'Notes hit', xp: 16 }],
  });
});

test('A completed warm-up earns 300 XP, enough to reach level 2, before achievements.', () => {
  assert.deepEqual(xpForRun({ ...summary, mode: 'tutorial' }, context), {
    total: 300, parts: [{ label: 'Warm-up complete', xp: 300 }],
  });
});

test('The first clear creates a song record without mutating the input save.', () => {
  const save = emptySave();
  const before = structuredClone(save);
  const outcome = applyRun(save, summary, now, extra);
  assert.deepEqual(save, before);
  assert.equal(outcome.firstClear, true);
  assert.equal(outcome.newBest, true);
  assert.equal(outcome.previousBest, 0);
  const key = recordKey(summary.songId, summary.difficulty);
  assert.equal(key, 'practice-track:medium');
  assert.deepEqual(outcome.save.records[key], {
    score: 1200, stars: 5, grade: 'A', rating: 90, fullCombo: true, plays: 1, bestCombo: 20,
  });
});

test('A lower-scoring replay keeps the best score and its ratings.', () => {
  const first = applyRun(emptySave(), summary, now, extra);
  const before = structuredClone(first.save);
  const replay = { ...summary, score: 800, stars: 2, grade: 'C', rating: 47, fullCombo: false } as const;
  const outcome = applyRun(first.save, replay, now, extra);
  assert.equal(outcome.firstClear, false);
  assert.equal(outcome.newBest, false);
  assert.equal(outcome.previousBest, 1200);
  assert.deepEqual(outcome.save.records['practice-track:medium'], {
    score: 1200, stars: 5, grade: 'A', rating: 90, fullCombo: true, plays: 2, bestCombo: 20,
  });
  assert.deepEqual(first.save, before);
});

test('A higher-scoring replay reports the previous best and updates the record.', () => {
  const first = applyRun(emptySave(), summary, now, extra);
  const outcome = applyRun(first.save, { ...summary, score: 1300 }, now, extra);
  assert.equal(outcome.newBest, true);
  assert.equal(outcome.firstClear, false);
  assert.equal(outcome.previousBest, 1200);
  assert.equal(outcome.save.records['practice-track:medium'].score, 1300);
});

test('A failed run adds a play only when the song already has a record.', () => {
  const failed = { ...summary, failed: true, score: 1500, fullCombo: false };
  const first = applyRun(emptySave(), failed, now, extra);
  assert.deepEqual(first.save.records, {});
  assert.equal(first.firstClear, false);
  assert.equal(first.newBest, false);

  const cleared = applyRun(first.save, summary, now, extra);
  const replay = applyRun(cleared.save, failed, now, extra);
  assert.equal(replay.newBest, false);
  assert.equal(replay.previousBest, 1200);
  assert.equal(replay.save.records['practice-track:medium'].plays, 2);
  assert.equal(replay.save.records['practice-track:medium'].score, 1200);
});

test('A second run on the same day preserves the streak.', () => {
  const first = applyRun(emptySave(), summary, now, extra);
  const outcome = applyRun(first.save, summary, now, extra);
  assert.deepEqual(outcome.streak, { days: 1, extended: false });
  assert.deepEqual(outcome.save.streak, first.save.streak);
});

test('Consecutive calendar days extend the streak across a month boundary.', () => {
  const first = applyRun(emptySave(), summary, now, extra);
  const next = applyRun(first.save, summary, now, { ...extra, dateKey: '2026-01-31' });
  assert.deepEqual(next.streak, { days: 2, extended: true });
  const february = applyRun(next.save, summary, now, { ...extra, dateKey: '2026-02-01' });
  assert.deepEqual(february.streak, { days: 3, extended: true });
  assert.deepEqual(february.save.streak, { days: 3, best: 3, lastDay: '2026-02-01' });
});

test('Playing again two days later resets the active streak to one day.', () => {
  const save = emptySave();
  save.streak = { days: 3, best: 5, lastDay: '2026-01-28' };
  const outcome = applyRun(save, summary, now, extra);
  assert.deepEqual(outcome.streak, { days: 1, extended: true });
  assert.deepEqual(outcome.save.streak, { days: 1, best: 5, lastDay: '2026-01-30' });
});

test('A run returns every cosmetic unlocked across the levels it gained.', () => {
  const save = emptySave();
  save.xp = 250;
  const outcome = applyRun(save, summary, now, extra);
  assert.equal(outcome.levelBefore, 1);
  assert.equal(outcome.levelAfter, 3);
  assert.deepEqual(outcome.unlocked.map(unlock => unlock.id).sort(), ['neon', 'round']);
  assert.deepEqual(unlocksAt(3).map(unlock => unlock.id), ['neon']);
  assert.equal(isUnlocked('highway', 'neon', 2), false);
  assert.equal(isUnlocked('highway', 'neon', 3), true);
});

test('An achievement awards XP and stores its timestamp only once.', () => {
  const first = applyRun(emptySave(), summary, now, extra);
  const award = first.achievements.find(achievement => achievement.id === 'first-gig');
  assert.ok(award);
  assert.deepEqual(first.xp.parts.find(part => part.label === award.name), { label: award.name, xp: award.xp });
  assert.equal(first.save.achievements['first-gig'], now);
  const replay = applyRun(first.save, summary, now + 60_000, extra);
  assert.deepEqual(replay.achievements, []);
  assert.equal(replay.save.achievements['first-gig'], now);
});

test('Normalization restores defaults for null, arrays and missing fields.', () => {
  assert.deepEqual(normalizeSave(null), emptySave());
  assert.deepEqual(normalizeSave([]), emptySave());
  assert.deepEqual(normalizeSave({ xp: -5 }), emptySave());
  assert.deepEqual(normalizeSave({
    xp: 390, name: 'Ivy', equipped: { gem: 'round', fx: 'missing' },
    totals: { notesHit: 10, plays: -2, playMs: Infinity },
    streak: { lastDay: '2026-02-30', days: -1 },
    genres: ['Rock', false, 'Rock', 'Blues'],
    seenTutorial: true,
  }), {
    ...emptySave(), xp: 390, name: 'Ivy', seenTutorial: true, genres: ['Rock', 'Blues'],
    equipped: { highway: 'classic', gem: 'round', fx: 'sparks' },
    totals: { ...emptySave().totals, notesHit: 10 },
  });
});

test('The first successful attempt at a daily challenge earns 150 daily XP.', () => {
  const daily = { ...summary, mode: 'daily' } as const;
  const dailyExtra = { ...extra, dailyKey: '2026-01-31' };
  const earlier = applyRun(emptySave(), summary, now, extra);
  const failure = applyRun(earlier.save, { ...daily, failed: true }, now, dailyExtra);
  assert.equal(failure.save.totals.dailies, 0);
  assert.ok(!failure.xp.parts.some(part => part.label === 'Daily challenge'));
  const first = applyRun(failure.save, daily, now, dailyExtra);
  assert.deepEqual(first.xp.parts.filter(part => part.label === 'Daily challenge'), [
    { label: 'Daily challenge', xp: 150 },
  ]);
  assert.equal(first.save.totals.dailies, 1);
  assert.deepEqual(first.save.daily['2026-01-31'], { score: 1200, stars: 5 });
  const replay = applyRun(first.save, { ...daily, score: 1300 }, now, dailyExtra);
  assert.ok(!replay.xp.parts.some(part => part.label === 'Daily challenge'));
  assert.equal(replay.save.totals.dailies, 1);
  assert.equal(replay.save.daily['2026-01-31'].score, 1300);
});
