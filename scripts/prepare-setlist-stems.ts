import 'dotenv/config';
import { access, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogTracks } from '../backend/catalog-data';
import { preparePlaybackStems, separate } from '../backend/music';

process.env.ELEVENLABS_API_KEY ||= process.env.ELEVEN_LABS_API_KEY;
if (!process.env.ELEVENLABS_API_KEY || process.env.FIXTURE_MUSIC === '1') throw new Error('A live music key is required.');
const requested = new Set(process.argv.slice(2));
const jobs = catalogTracks.filter(([id]) => !requested.size || requested.has(id));
const exists = (file: string) => access(file).then(() => true, () => false);
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const [id, title, , , long] = jobs[cursor++];
    const dir = join('catalog', id);
    if (await exists(join(dir, 'lead.mp3')) && await exists(join(dir, 'backing.mp3'))) continue;
    try {
      if (!await exists(join(dir, 'guitar.audio'))) await separate(dir, long?.seconds ?? 30);
      await preparePlaybackStems(dir);
      for (const file of await readdir(dir)) if (file.endsWith('.audio')) await rm(join(dir, file));
      console.log(`${title}: playback mix ready`);
    } catch (error) {
      console.error(`${title}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
