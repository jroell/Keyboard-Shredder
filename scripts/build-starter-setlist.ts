import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogTracks } from '../backend/catalog-data';
import { analyze, atomicWrite, compose, preparePlaybackStems, separate } from '../backend/music';
import { buildChart } from '../backend/charts';

if (!process.env.ELEVENLABS_API_KEY && process.env.ELEVEN_LABS_API_KEY) {
  process.env.ELEVENLABS_API_KEY = process.env.ELEVEN_LABS_API_KEY;
}
if (!process.env.ELEVENLABS_API_KEY || process.env.FIXTURE_MUSIC === '1') {
  throw new Error('A live ElevenLabs key is required to create the starter setlist.');
}

const exec = promisify(execFile);
const exists = (path: string) => access(path).then(() => true, () => false);
const selected = new Set(process.argv.slice(2));
const jobs = catalogTracks.filter(([id]) => selected.size === 0 || selected.has(id));
let cursor = 0;
let failures = 0;
async function work() {
  while (cursor < jobs.length) {
    const [id, title, , prompt, long] = jobs[cursor++];
    const dir = join('catalog', id);
    const chart = join(dir, 'chart.json');
    const stem = join(dir, 'guitar.audio');
    const audio = join(dir, 'master.mp3');
    if (await exists(chart) && await exists(audio)) continue;
    const seconds = long?.seconds ?? 30;
    try {
      await mkdir(dir, { recursive: true });
      if (!await exists(audio)) {
        if (long?.credit) {
          const response = await fetch(long.credit.download, { signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error(`Artist download returned HTTP ${response.status}.`);
          const file = new Uint8Array(await response.arrayBuffer());
          if (file.length > 16 * 1024 * 1024) throw new Error('Artist download exceeded 16 MB.');
          if (long.excerpt) {
            const source = join(dir, 'source.audio');
            const rendered = join(dir, 'excerpt.mp3.partial');
            await atomicWrite(source, file);
            try {
              await exec('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', source, '-t', String(seconds),
                '-af', `afade=t=out:st=${seconds - 3}:d=3`, '-codec:a', 'libmp3lame', '-q:a', '2', '-f', 'mp3', rendered],
              { timeout: 60_000 });
              await rename(rendered, audio);
            } finally {
              await rm(source, { force: true });
              await rm(rendered, { force: true });
            }
          } else await atomicWrite(audio, file);
        } else await compose(dir, prompt, seconds);
      }
      if (!await exists(stem)) await separate(dir, seconds);
      const analysis = await analyze(dir);
      const playable = buildChart(analysis);
      const toleranceMs = long && !long.credit ? 10_000 : 4_000;
      if (Math.abs(playable.durationMs - seconds * 1000) > toleranceMs) {
        throw new Error(`Expected about ${seconds}s, received ${(playable.durationMs / 1000).toFixed(1)}s.`);
      }
      await preparePlaybackStems(dir);
      await atomicWrite(chart, JSON.stringify(playable));
      for (const file of await readdir(dir)) if (file.endsWith('.audio')) await rm(join(dir, file));
      console.log(`${title}: ready`);
    } catch (reason) {
      failures++;
      console.error(`${title}: ${reason instanceof Error ? reason.message : reason}`);
    }
  }
}
await Promise.all(Array.from({ length: 2 }, work));
if (failures) process.exitCode = 1;
