import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scoring } from '../shared/scoring';

test('A two-key chord scores once when both keys arrive within 55 ms', () => {
  const game = new Scoring([{ id: 'chord', timeMs: 1000, lanes: [0, 1], durationMs: 0 }]);
  game.press(0, 980);
  game.press(0, 985);
  assert.equal(game.score, 0);
  game.press(1, 1010);
  assert.equal(game.score, 100);
  game.press(1, 1040);
  game.finish();
  assert.deepEqual([game.hits, game.misses, game.score], [1, 0, 100]);
});

test('A chord that arrives 56 ms apart misses and resets the combo', () => {
  const game = new Scoring([
    { id: 'note', timeMs: 500, lanes: [2], durationMs: 0 },
    { id: 'chord', timeMs: 1000, lanes: [0, 1], durationMs: 0 },
  ]);
  game.press(2, 500);
  game.press(0, 980);
  game.press(1, 1036);
  game.finish();
  assert.deepEqual([game.hits, game.misses, game.combo], [1, 1, 0]);
});

test('Holding a 400 ms sustain earns its bonus and early release drops it', () => {
  const note = { id: 'hold', timeMs: 1000, lanes: [0], durationMs: 400 };
  const held = new Scoring([note]);
  const released = new Scoring([note]);
  for (const game of [held, released]) game.press(0, 1000);
  held.release(0, 1400);
  released.release(0, 1150);
  assert.equal(held.score, 130);
  assert.equal(released.score, 100);
  assert.equal(released.judgement, 'Sustain dropped');
});

test('Overlapping 95 ms windows credit the attack closest to the press', () => {
  const game = new Scoring([
    { id: 'earlier', timeMs: 1000, lanes: [0], durationMs: 0 },
    { id: 'later', timeMs: 1145, lanes: [0], durationMs: 0 },
  ]);
  game.press(0, 1090);
  assert.deepEqual([...game.consumed], ['later']);
  game.finish();
  assert.deepEqual([game.hits, game.misses], [1, 1]);
});

test('A good hit 70 ms early reports its signed timing and successful lane', () => {
  const game = new Scoring([{ id: 'note', timeMs: 1000, lanes: [2], durationMs: 0 }]);
  game.press(2, 930);
  assert.deepEqual(game.feedback, { judgement: 'Good', offsetMs: -70, lanes: [2], timeMs: 930 });
});

test('An expired chord identifies both missed lanes after the 95 ms hit window', () => {
  const game = new Scoring([{ id: 'chord', timeMs: 1000, lanes: [0, 3], durationMs: 0 }]);
  game.tick(1096);
  assert.deepEqual(game.feedback, { judgement: 'Miss', lanes: [0, 3], timeMs: 1096 });
});

test('A stray lane press breaks a combo and counts against accuracy', () => {
  const game = new Scoring([{ id: 'note', timeMs: 1000, lanes: [2], durationMs: 0 }]);
  game.press(2, 1000);
  game.press(4, 1005);
  assert.equal(game.combo, 0);
  assert.equal(game.accuracy, 50);
  assert.equal(game.judgement, 'Wrong key');
});

test('A sustain re-held within 150 ms of resuming still earns its bonus', () => {
  const game = new Scoring([{ id: 'hold', timeMs: 1000, lanes: [0], durationMs: 500 }]);
  game.press(0, 1000);
  game.pause(1100);
  game.press(0, 1220);
  game.tick(1500);
  assert.equal(game.score, 130);
  assert.equal(game.accuracy, 100);
});

test('An unheld sustain drops when the 150 ms resume grace expires', () => {
  const game = new Scoring([{ id: 'hold', timeMs: 1000, lanes: [0], durationMs: 500 }]);
  game.press(0, 1000);
  game.pause(1100);
  game.tick(1251);
  assert.equal(game.judgement, 'Sustain dropped');
  assert.equal(game.combo, 0);
});

test('The resume count-in restores only active sustain lanes without scoring new notes', () => {
  const game = new Scoring([
    { id: 'hold', timeMs: 1000, lanes: [0], durationMs: 400 },
    { id: 'next', timeMs: 1300, lanes: [2], durationMs: 0 },
  ]);
  game.press(0, 1000);
  game.pause(1250);
  game.regrip(2);
  game.regrip(0);
  assert.deepEqual([...game.held], [0]);
  assert.equal(game.score, 100);
  game.press(2, 1300);
  game.tick(1400);
  assert.equal(game.score, 230);
  assert.equal(game.accuracy, 100);
});
