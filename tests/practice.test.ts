import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPracticeChart, normalizePracticeConfig, practiceKeys } from '../shared/practice';
import type { Chart, SongEvent } from '../shared/song';

function chartWith(events: SongEvent[]): Chart {
  return { version: 1, durationMs: 30000, bpm: 120, beatsMs: [0, 500, 1000], downbeatsMs: [0], events: { easy: events, normal: events, hard: events } };
}

test('Touch typing distributes repeated notes across all 12 keys with timing and holds intact', () => {
  const keys = practiceKeys({ preset: 'touch', customKeys: [] });
  const events = Array.from({ length: 24 }, (_, i) => ({ id: `note-${i}`, timeMs: 400 * i, durationMs: 240, lanes: [i % 2 ? 1 : 2] }));
  const input = chartWith(events);
  const result = mapPracticeChart(input, keys);
  assert.deepEqual(result, mapPracticeChart(input, keys));
  for (const mapped of [result.events.easy!, result.events.normal, result.events.hard]) {
    assert.equal(new Set(mapped.flatMap(event => event.lanes)).size, 12);
    assert.deepEqual(mapped.map(({ lanes, ...note }) => note), events.map(({ lanes, ...note }) => note));
  }
  assert.ok(events.every((event, i) => event.lanes.length === 1 && event.lanes[0] === (i % 2 ? 1 : 2)));
});

test('A two-key chord at 500 ms avoids the lanes held by a 900 ms sustain', () => {
  const keys = practiceKeys({ preset: 'home', customKeys: [] });
  const events = [
    { id: 'sustain', timeMs: 100, durationMs: 900, lanes: [1, 2] },
    { id: 'chord', timeMs: 500, durationMs: 0, lanes: [0, 1, 3] },
  ];
  const [sustain, chord] = mapPracticeChart(chartWith(events), keys).events.hard;
  assert.equal(sustain.durationMs, 900);
  assert.equal(chord.timeMs, 500);
  assert.equal(new Set(chord.lanes).size, 2);
  assert.ok(chord.lanes.every(lane => !sustain.lanes.includes(lane)));
});

test('Custom practice rejects unsupported keys and presents selected lanes in physical keyboard order', () => {
  const normalized = normalizePracticeConfig({
    preset: 'custom',
    customKeys: ['KeyZ', 'Semicolon', 'KeyZ', 'ArrowLeft', 'KeyQ', 'KeyA', 'Digit1'],
  });
  assert.deepEqual(practiceKeys(normalized), ['Digit1', 'KeyQ', 'KeyA', 'Semicolon', 'KeyZ']);
  const restored = normalizePracticeConfig({ preset: 'custom', customKeys: ['ArrowLeft'] });
  assert.ok(practiceKeys(restored).includes('KeyF'));
});
