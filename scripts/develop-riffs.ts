// Applies the static-run variation rule to charts already in the catalog. Safe to run again: a varied run is no longer one repeated shape.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { developRiffs } from '../backend/charts';
import { easyChart } from '../shared/difficulty';
import type { Chart } from '../shared/song';

for (const id of readdirSync('catalog')) {
  const path = join('catalog', id, 'chart.json');
  let chart: Chart;
  try { chart = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
  const before = JSON.stringify(chart.events);
  chart.events.normal = developRiffs(chart.events.normal, chart.downbeatsMs);
  chart.events.hard = developRiffs(chart.events.hard, chart.downbeatsMs);
  chart.events.easy = easyChart(chart);
  if (JSON.stringify(chart.events) === before) continue;
  writeFileSync(path, JSON.stringify(chart));
  console.log(`${id}: varied`);
}
