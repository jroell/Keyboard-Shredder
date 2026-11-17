import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildChart } from '../backend/charts';
import { createJobStore } from '../backend/jobs';
import { analyze, atomicWrite, compose, guitarBrief, separate } from '../backend/music';

type Trial = { id: string; label: string; provider: 'elevenlabs' | 'lyria'; prompt: string; take: number;
  result?: { durationMs?: number; normalNotes?: number; hardNotes?: number; error?: string } };
const briefs = [
  'Driving hard rock with a stomping backbeat and a syncopated, palm-muted riff',
  'Blues rock with a gritty call-and-response guitar riff over a swung backbeat',
  'Fast pop punk with bright power chords and an octave-lead hook',
];

const key = process.env.GEMINI_API_KEY;
process.env.ELEVENLABS_API_KEY ||= process.env.ELEVEN_LABS_API_KEY || '';
process.env.FIXTURE_MUSIC = '0';
if (!key || !process.env.ELEVENLABS_API_KEY) throw new Error('Set GEMINI_API_KEY and ELEVENLABS_API_KEY to run the paid comparison.');
const root = resolve(process.argv[2] || '.song-data/music-benchmark');
const limit = Number(process.argv[3] || 12);
if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('Pass a comparison limit from 1 to 12.');
process.env.SONG_DATA_DIR = root;
await mkdir(root, { recursive: true, mode: 0o700 });
const answerKey = join(root, 'answer-key.json');
const store = createJobStore();
const trials: Trial[] = existsSync(answerKey)
  ? JSON.parse(await readFile(answerKey, 'utf8'))
  : briefs.flatMap(prompt => [1, 2].flatMap(take => (['elevenlabs', 'lyria'] as const).map(provider => {
    const id = randomUUID();
    return { id, label: 'Track ' + id.slice(0, 6), provider, prompt, take };
  })));
await atomicWrite(answerKey, JSON.stringify(trials, null, 2));

const remaining = trials.filter(item => !item.result).slice(0, limit);
for (let i = 0; i < remaining.length; i += 2) {
  await Promise.all(remaining.slice(i, i + 2).map(runTrial));
  await atomicWrite(answerKey, JSON.stringify(trials, null, 2));
}

async function runTrial(trial: Trial) {
  const folder = join(root, trial.id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try {
    if (!existsSync(join(folder, 'master.mp3'))) {
      if (trial.provider === 'elevenlabs') await compose(folder, trial.prompt, 90);
      else await composeLyria(folder, trial.prompt, key);
    }
    if (!existsSync(join(folder, 'guitar.audio'))) await separate(folder, 90);
    const chart = buildChart(await analyze(folder));
    if (Math.abs(chart.durationMs - 90_000) > 4_000) {
      throw new Error(`Recording measured ${chart.durationMs} ms. Expected 86000–94000 ms.`);
    }
    await store.importBenchmarkTrack(trial.id, trial.label, chart);
    trial.result = { durationMs: chart.durationMs, normalNotes: chart.events.normal.length, hardNotes: chart.events.hard.length };
  } catch (error) {
    trial.result = { error: error instanceof Error ? error.message : 'Unknown error' };
  }
  console.log(trial.label, trial.provider, trial.result);
}
const labels = trials.filter(trial => trial.result?.durationMs).map(trial => trial.label).sort();
const scorecard = join(root, 'scorecard.csv');
if (!existsSync(scorecard)) await writeFile(scorecard, 'label,tester,hook,guitar_clarity,playing_feel\n');
console.log(`${labels.length} blind tracks in ${root}`);
console.log('Record each tester’s ratings in the scorecard and keep the answer key private until all ratings are in.');

async function composeLyria(folder: string, prompt: string, apiKey: string) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: 'lyria-3.5', input: `Create a 90-second instrumental song with no vocals. ${guitarBrief(prompt, 90)}`,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Lyria returned HTTP ${response.status}.`);
  }
  const payload = await response.json() as { steps?: { type: string; content?: { type: string; data?: string }[] }[] };
  const result = payload.steps?.filter(step => step.type === 'model_output').flatMap(step => step.content ?? [])
    .filter(block => block.type === 'audio' && block.data).at(-1);
  if (!result?.data) throw new Error('Lyria returned no audio.');
  const mp3 = Buffer.from(result.data, 'base64');
  if (mp3.length > 16 * 1024 * 1024) throw new Error('Lyria returned an oversized recording.');
  await atomicWrite(join(folder, 'master.mp3'), mp3);
}
