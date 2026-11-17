import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

const exec = promisify(execFile);
export const model = 'music_v2_5';

export async function atomicWrite(file: string, data: Uint8Array | string) {
  await writeFile(file + '.partial', data);
  await rename(file + '.partial', file);
}

async function musicRequest(endpoint: string, body: string | FormData, limit: number) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Music generation is unavailable. Configure the server music key.');
  const headers: Record<string, string> = { 'xi-api-key': key };
  if (typeof body === 'string') headers['Content-Type'] = 'application/json';
  const response = await fetch('https://api.elevenlabs.io/v1/music' + endpoint, {
    method: 'POST', headers, body, signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`The music service returned HTTP ${response.status}. Try again later.`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('The music service returned an oversized audio file.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export async function compose(dir: string, prompt: string, duration: number) {
  if (process.env.FIXTURE_MUSIC === '1') {
    await fixture(dir, duration);
    return;
  }
  const audio = await musicRequest('', JSON.stringify({
    model_id: model, music_length_ms: duration * 1000, force_instrumental: true,
    prompt: guitarBrief(prompt, duration),
  }), 16 * 1024 * 1024);
  await atomicWrite(join(dir, 'master.mp3'), audio);
}

export function guitarBrief(prompt: string, duration: number) {
  const structure = duration === 90
    ? 'Introduce a memorable riff immediately, repeat it as a hook, then play a short solo and bring back the hook. End cleanly.'
    : 'Play one immediately recognizable riff, vary it, then end cleanly.';
  return `Original instrumental in this style: ${prompt}. Prominent, clearly articulated electric lead guitar centered in the mix. Use real single notes, power chords and ringing sustains, with a clear drum backbeat. ${structure} Keep the lead louder than the rhythm guitar. Avoid competing melodic instruments and fade-ins.`;
}

export async function separate(dir: string, duration: number) {
  if (process.env.FIXTURE_MUSIC === '1') {
    if (process.env.FIXTURE_FAIL_FIRST_SEPARATION === '1') {
      const marker = join(dir, 'fixture-interruption');
      if (!await access(marker).then(() => true, () => false)) {
        await atomicWrite(marker, '');
        throw new Error('The music service did not return a usable guitar stem.');
      }
    }
    await fixture(dir, duration, true);
    return;
  }
  const file = await readFile(join(dir, 'master.mp3'));
  const body = new FormData();
  body.set('file', new Blob([file], { type: 'audio/mpeg' }), 'master.mp3');
  body.set('stem_variation_id', 'six_stems_v1');
  const zip = await musicRequest('/stem-separation', body, 100 * 1024 * 1024);
  const files = unzipSync(zip, {
    filter: entry => entry.originalSize <= 48 * 1024 * 1024 &&
      /(?:^|[/_ -])guitars?\.(mp3|wav|flac)$/i.test(entry.name),
  });
  const stems = Object.values(files);
  if (stems.length !== 1) throw new Error('The music service did not return a usable guitar stem.');
  await atomicWrite(join(dir, 'guitar.audio'), stems[0]);
}

async function fixture(dir: string, duration: number, stemOnly = false) {
  await exec(process.env.UV_BIN || 'uv', [
    'run', '--project', 'analysis', '--no-sync', 'python', 'analysis/fixture.py',
    dir, String(duration), stemOnly ? '--stem-only' : '--master-only',
  ], { timeout: 60_000 });
}

export async function analyze(dir: string) {
  try {
    const { stdout } = await exec(process.env.UV_BIN || 'uv', [
      'run', '--project', 'analysis', '--locked', '--no-sync', 'python', 'analysis/analyze.py', dir,
    ], { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(stdout) as import('./charts').Analysis;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr || '';
    const message = stderr.match(/^CHART_ERROR: (.+)$/m)?.[1];
    if (message) throw new Error(message);
    console.error(stderr.trim().slice(-1600));
    throw new Error('Audio analysis failed. Check the server setup or try another prompt.');
  }
}
