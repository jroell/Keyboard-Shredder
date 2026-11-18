import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChart, developRiffs } from '../backend/charts';

const base = {
  durationMs: 10_000,
  beatsMs: Array.from({ length: 20 }, (_, i) => i * 500),
  downbeatsMs: [0, 2000, 4000, 6000, 8000],
};

test('Charts preserve a 70 ms offbeat attack, group a chord and retain a sustain', () => {
  const attacks = Array.from({ length: 12 }, (_, i) => ({
    startMs: i * 500 + 70, endMs: i * 500 + 420, pitch: i % 2 ? 60 : 52, strength: 0.9,
  }));
  attacks.push({ startMs: 80, endMs: 400, pitch: 64, strength: 0.8 });
  const chart = buildChart({ ...base, notes: attacks });
  assert.equal(chart.bpm, 120);
  assert.equal(chart.events.normal[0].timeMs, 70);
  assert.equal(chart.events.normal[0].lanes.length, 2);
  assert.equal(chart.events.normal[0].durationMs, 330);
  assert.equal(chart.events.hard.length, 12);
});

test('A recording with no clear guitar attacks does not produce a playable chart', () => {
  assert.throws(() => buildChart({ ...base, notes: [] }), /too few clear guitar attacks/);
});

test('A 16-note run of one chord over four bars moves one lane in bar three and answers on the moved chord at the end of bar four.', () => {
  const run = Array.from({ length: 16 }, (_, index) => ({ id: `n-${index}`, timeMs: index * 500, lanes: [1, 2], durationMs: 0 }));
  const tail = [{ id: 'n-16', timeMs: 8000, lanes: [4], durationMs: 0 }];
  const varied = developRiffs([...run, ...tail], [0, 2000, 4000, 6000, 8000]);
  assert.deepEqual(varied.map(event => event.timeMs), [...run, ...tail].map(event => event.timeMs));
  assert.deepEqual(varied.slice(0, 8).map(event => event.lanes), Array(8).fill([1, 2]));
  assert.deepEqual(varied.slice(8, 12).map(event => event.lanes), Array(4).fill([2, 3]));
  assert.deepEqual(varied.slice(12, 15).map(event => event.lanes), Array(3).fill([1, 2]));
  assert.deepEqual(varied[15].lanes, [2, 3]);
  assert.deepEqual(varied[16].lanes, [4]);
});

test('A run of seven repeated notes and a run on the top lane stay inside the five lanes.', () => {
  const short = Array.from({ length: 7 }, (_, index) => ({ id: `s-${index}`, timeMs: index * 400, lanes: [0], durationMs: 0 }));
  assert.deepEqual(developRiffs(short, [0, 1600]).map(event => event.lanes), Array(7).fill([0]));
  const top = Array.from({ length: 12 }, (_, index) => ({ id: `t-${index}`, timeMs: index * 500, lanes: [3, 4], durationMs: 0 }));
  const varied = developRiffs(top, [0, 2000, 4000]);
  assert.ok(varied.every(event => event.lanes.every(lane => lane >= 0 && lane <= 4)));
  assert.deepEqual(varied[8].lanes, [2, 3]);
});
