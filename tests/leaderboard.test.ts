import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLeaderboard, replayRun } from '../backend/leaderboard';
import { hitWindows, notesFor } from '../shared/difficulty';
import { Scoring } from '../shared/scoring';
import type { Chart } from '../shared/song';

const chart = JSON.parse(readFileSync('catalog/river-amp/chart.json', 'utf8')) as Chart;
const notes = notesFor(chart, 'easy');
type Input = [lane: number, down: 0 | 1, timeMs: number];
const inputs = notes.flatMap<Input>(note => note.lanes.flatMap<Input>(lane => [
  [lane, 1, note.timeMs], [lane, 0, note.timeMs + 20],
])).sort((a, b) => a[2] - b[2]);
const run = { difficulty: 'easy', mods: [], inputs, boosts: [] };

test('Replaying the easy River Amp chart gives the same score as live scoring', () => {
  const scoring = new Scoring(notes, hitWindows.easy);
  for (const [lane, down, time] of inputs) {
    if (down) scoring.press(lane, time);
    else scoring.release(lane, time);
  }
  scoring.finish();
  const replay = replayRun(chart, run);
  assert.ok(replay.ok);
  assert.equal(replay.score, scoring.score);
  assert.equal(replay.rating, 100);
  assert.equal(replay.stars, 6);
  assert.equal(replay.fullCombo, true);
  assert.equal(replay.hits, notes.length);
  assert.equal(replay.misses, 0);
});

test('Replay rejects invalid inputs, unknown modifiers, and runs with zero hits', () => {
  for (const changes of [
    { inputs: [inputs[1], inputs[0]] },
    { inputs: [[7, 1, inputs[0][2]]] },
    { mods: ['unknown'] },
    { inputs: Array.from({ length: 8001 }, () => inputs[0]) },
    { inputs: [] },
    { boosts: [1000, 0] },
  ]) {
    assert.equal(replayRun(chart, { ...run, ...changes }).ok, false, JSON.stringify(changes).slice(0, 100));
  }
});

test('Sudden death rejects a run that misses a note', () => {
  assert.equal(replayRun(chart, { ...run, mods: ['sudden'], inputs: inputs.slice(2) }).ok, false);
});

test('Mirror scores a full combo when the player presses the mirrored lanes', () => {
  const mods = ['mirror'];
  const mirrored = replayRun(chart, { ...run, mods, inputs: inputs.map(([lane, down, time]) => [4 - lane, down, time]) });
  const original = replayRun(chart, { ...run, mods });
  assert.ok(mirrored.ok);
  assert.equal(mirrored.fullCombo, true);
  if (original.ok) {
    assert.equal(original.fullCombo, false);
    assert.ok(original.score < mirrored.score);
  }
});

test('A boost at the same time as a key press applies to that note', () => {
  const boostTime = notes[20].timeMs;
  const before = replayRun(chart, { ...run, boosts: [boostTime - 1] });
  const simultaneous = replayRun(chart, { ...run, boosts: [boostTime] });
  const after = replayRun(chart, { ...run, boosts: [boostTime + 1] });
  assert.ok(before.ok && simultaneous.ok && after.ok);
  assert.equal(simultaneous.score, before.score);
  assert.ok(simultaneous.score > after.score);
});

test('The leaderboard retains personal bests and ranks ties by when players reached the score', () => {
  const root = mkdtempSync(join(tmpdir(), 'shredder-leaderboard-'));
  const previousDir = process.env.SONG_DATA_DIR;
  process.env.SONG_DATA_DIR = root;
  const board = 'river-amp:easy';
  const result = { score: 100, rating: 90, stars: 5, combo: 4, fullCombo: false };

  try {
    const leaderboard = createLeaderboard();
    assert.deepEqual(leaderboard.submit(board, 'first', 'First', { ...result, score: 50 }),
      { rank: 1, best: true, previous: null });
    assert.deepEqual(leaderboard.submit(board, 'second', 'Second', result),
      { rank: 1, best: true, previous: null });
    assert.deepEqual(leaderboard.submit(board, 'first', 'First', result),
      { rank: 2, best: true, previous: 50 });
    assert.deepEqual(leaderboard.submit(board, 'second', 'Renamed', { ...result, rating: 99 }),
      { rank: 1, best: false, previous: 100 });
    assert.deepEqual(leaderboard.submit(board, 'first', 'First', { ...result, score: 25 }),
      { rank: 2, best: false, previous: 100 });

    const restarted = createLeaderboard();
    assert.deepEqual(restarted.top(board, 'first'), {
      total: 2,
      you: { rank: 2, score: 100 },
      entries: [
        { ...result, rank: 1, name: 'Renamed', you: false },
        { ...result, rank: 2, name: 'First', you: true },
      ],
    });
    assert.deepEqual(restarted.top(board, 'first', 1).you, { rank: 2, score: 100 });
    assert.deepEqual(restarted.top('river-amp:hard', 'first'), { total: 0, entries: [], you: null });
  } finally {
    if (previousDir === undefined) delete process.env.SONG_DATA_DIR;
    else process.env.SONG_DATA_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test('A venue board ranks players by the sum of their best scores and leaves out a player missing one song.', () => {
  const root = mkdtempSync(join(tmpdir(), 'ks-venue-'));
  const previousDir = process.env.SONG_DATA_DIR;
  process.env.SONG_DATA_DIR = root;
  const result = { score: 0, rating: 90, stars: 5, combo: 4, fullCombo: false };
  try {
    const leaderboard = createLeaderboard();
    const boards = ['a:easy', 'b:easy'];
    leaderboard.submit('a:easy', 'ann', 'Ann', { ...result, score: 300 });
    leaderboard.submit('b:easy', 'ann', 'Ann', { ...result, score: 100 });
    leaderboard.submit('a:easy', 'bo', 'Bo', { ...result, score: 150 });
    leaderboard.submit('b:easy', 'bo', 'Bo', { ...result, score: 350 });
    leaderboard.submit('a:easy', 'cy', 'Cy', { ...result, score: 900 });
    leaderboard.submit('a:hard', 'ann', 'Ann', { ...result, score: 5000 });
    assert.deepEqual(leaderboard.combined(boards, 'ann'), {
      total: 2,
      you: { rank: 2, score: 400 },
      entries: [{ rank: 1, name: 'Bo', score: 500, you: false }, { rank: 2, name: 'Ann', score: 400, you: true }],
    });
    assert.deepEqual(leaderboard.combined(boards, 'cy').you, null);
    assert.deepEqual(leaderboard.combined([], 'ann'), { entries: [], you: null, total: 0 });
  } finally {
    if (previousDir === undefined) delete process.env.SONG_DATA_DIR;
    else process.env.SONG_DATA_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  }
});
