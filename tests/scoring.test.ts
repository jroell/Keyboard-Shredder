import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scoring } from '../shared/scoring';
import { isFullCombo } from '../shared/rating';

test('A two-key chord scores once, at 100 points per key, when both keys arrive within 55 ms', () => {
  const game = new Scoring([{ id: 'chord', timeMs: 1000, lanes: [0, 1], durationMs: 0 }]);
  game.press(0, 980);
  game.press(0, 985);
  assert.equal(game.score, 0);
  game.press(1, 1010);
  assert.equal(game.score, 200);
  game.press(1, 1040);
  game.finish();
  assert.deepEqual([game.hits, game.misses, game.score], [1, 0, 200]);
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

test('A hit 70 ms early is Great for 75 points and reports its signed timing and lane', () => {
  const game = new Scoring([{ id: 'note', timeMs: 1000, lanes: [2], durationMs: 0 }]);
  game.press(2, 930);
  assert.deepEqual(game.feedback, { judgement: 'Great', offsetMs: -70, lanes: [2], timeMs: 930, points: 75 });
});

test('Hits 30, 70 and 90 ms off are Perfect, Great and Good, and rate 78 out of 100', () => {
  const game = new Scoring([0, 1, 2].map(i => ({ id: String(i), timeMs: 1000 + 1000 * i, lanes: [0], durationMs: 0 })));
  const seen: string[] = [];
  game.onEvent = event => { if (event.type === 'hit') seen.push(event.judgement); };
  for (const [index, offset] of [30, -70, 90].entries()) {
    game.press(0, 1000 + 1000 * index + offset);
    game.release(0, 1000 + 1000 * index + offset + 10);
  }
  assert.deepEqual(seen, ['Perfect', 'Great', 'Good']);
  assert.deepEqual([game.perfects, game.greats, game.goods, game.score], [1, 1, 1, 225]);
  assert.equal(game.rating, 78.3);
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

test('An unheld sustain drops when the 150 ms resume grace expires, losing its bonus but not the streak', () => {
  const game = new Scoring([{ id: 'hold', timeMs: 1000, lanes: [0], durationMs: 500 }]);
  game.press(0, 1000);
  game.pause(1100);
  game.tick(1251);
  assert.equal(game.judgement, 'Sustain dropped');
  assert.equal(game.combo, 1);
  assert.equal(game.score, 100);
});

test('A stray key press ends a full combo even when every note was hit', () => {
  const game = new Scoring([0, 1].map(i => ({ id: String(i), timeMs: 1000 + 500 * i, lanes: [0], durationMs: 0 })));
  game.press(0, 1000);
  game.release(0, 1010);
  game.stray(1200);
  game.press(0, 1500);
  game.finish();
  assert.deepEqual([game.hits, game.misses, game.wrongKeys, game.bestCombo], [2, 0, 1, 1]);
  assert.equal(isFullCombo(game.tally), false);
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

test('Seventeen perfect hits charge the amp and boost doubles multipliers for 8 seconds only', () => {
  const game = new Scoring(Array.from({ length: 19 }, (_, i) => ({
    id: String(i), timeMs: i < 18 ? 1000 + 250 * i : 20_000, lanes: [0], durationMs: 0,
  })));
  let charged = 0;
  game.onEvent = event => { if (event.type === 'charged') charged++; };
  assert.equal(game.activateBoost(0), false);
  for (let i = 0; i < 17; i++) {
    game.press(0, 1000 + 250 * i);
    game.release(0, 1001 + 250 * i);
  }
  assert.equal(game.score, 2400);
  assert.equal(game.ampCharge, 100);
  assert.equal(charged, 1);
  assert.equal(game.activateBoost(5200), true);
  assert.equal(game.ampCharge, 0);
  assert.equal(game.activateBoost(5201), false);
  game.press(0, 5250);
  game.release(0, 5251);
  assert.equal(game.score, 2800);
  assert.equal(game.boosting(13_199), true);
  assert.equal(game.boosting(13_200), false);
  game.press(0, 20_000);
  assert.equal(game.score, 3000);
  assert.equal(game.boostHits, 1);
});
