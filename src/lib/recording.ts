import type { Chart, Song } from '../../shared/song';

export type Recording = { song: Song; chart: Chart; audio: ArrayBuffer; leadAudio?: ArrayBuffer };

export async function loadRecording(call: (path: string) => Promise<Response>, path: string, manifestPath = path): Promise<Recording> {
  const manifest: Pick<Recording, 'song' | 'chart'> = await call(manifestPath).then(response => response.json());
  const load = (suffix: string) => call(`${path}/audio${suffix}`).then(response => response.arrayBuffer());
  if (!manifest.song.hasStemMix) return { ...manifest, audio: await load('') };
  const [audio, leadAudio] = await Promise.all([load('/backing'), load('/lead')]);
  return { ...manifest, audio, leadAudio };
}
