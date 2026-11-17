import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChart } from '../backend/charts';

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
