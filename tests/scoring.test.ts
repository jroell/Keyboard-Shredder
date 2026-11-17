import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scoring } from '../src/lib/scoring';

test('A two-key chord scores once when both keys arrive within 55 ms', () => {
  const game = new Scoring([{ id: 'chord', timeMs: 1000, lanes: [0, 1], durationMs: 0 }]);
  game.press(0, 980);
  game.press(0, 985);
  assert.equal(game.score, 0);
  game.press(1, 1010);
  assert.equal(game.score, 100);
  game.release(1, 1020);
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

test('Clearing inputs on pause prevents held keys from scoring a sustain or a later note', () => {
  const game = new Scoring([
    { id: 'hold', timeMs: 1000, lanes: [0], durationMs: 400 },
    { id: 'after', timeMs: 1500, lanes: [0], durationMs: 0 },
  ]);
  game.press(0, 1000);
  game.clearInput();
  game.tick(1450);
  game.press(0, 1500);
  game.finish();
  assert.deepEqual([game.hits, game.score, game.held.size], [2, 200, 1]);
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
