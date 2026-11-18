import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCatalog } from '../backend/catalog';
import type { Chart } from '../shared/song';
import { sectionNames, SECTION_COUNT } from '../shared/sections';

test('Every catalog song gets eight distinct section names that start with Intro, end with Finale and include one Solo.', async () => {
  const catalog = loadCatalog();
  assert.ok(catalog.size >= 37);
  for (const [id, entry] of catalog) {
    const chart = JSON.parse(await entry.chart()) as Chart;
    const names = sectionNames(chart.events.normal, chart.durationMs);
    assert.equal(names.length, SECTION_COUNT, id);
    assert.equal(new Set(names).size, SECTION_COUNT, `${id}: ${names.join(', ')}`);
    assert.equal(names[0], 'Intro', id);
    assert.equal(names.at(-1), 'Finale', id);
    assert.equal(names.filter(name => name === 'Solo').length, 1, id);
  }
});

test('The Solo is the middle section with the most notes.', () => {
  const events = [0, 1, 2, 3, 4, 5, 6, 7].flatMap(section => Array.from({ length: section === 5 ? 12 : 4 }, (_, index) =>
    ({ id: `${section}-${index}`, timeMs: section * 1000 + index * 50, lanes: [0], durationMs: 0 })));
  assert.equal(sectionNames(events, 8000)[5], 'Solo');
});
