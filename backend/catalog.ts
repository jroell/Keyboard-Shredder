import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Chart, Song } from '../shared/song';
import { catalogTracks } from './catalog-data';

export function playbackStems(folder: string) {
  const lead = resolve(folder, 'lead.mp3');
  const backing = resolve(folder, 'backing.mp3');
  return existsSync(lead) && existsSync(backing) ? { lead, backing } : undefined;
}

export function loadCatalog() {
  return new Map(catalogTracks.map(([id, title, genre, , long]) => {
    const folder = resolve('catalog', id);
    const audio = resolve(folder, 'master.mp3');
    try {
      const serialized = readFileSync(resolve(folder, 'chart.json'), 'utf8');
      const chart = JSON.parse(serialized) as Chart;
      if (!statSync(audio).size || !chart.events.easy?.length || !chart.events.normal.length || !chart.events.hard.length) {
        throw new Error('Missing audio or difficulty chart.');
      }
      const stems = playbackStems(folder);
      const artist = long?.credit;
      const credit = artist && { artist: artist.artist, license: artist.license, licenseUrl: artist.licenseUrl, source: artist.source };
      const perSecond = chart.events.normal.length / (chart.durationMs / 1000);
      const intensity = [3.3, 3.8, 4.2, 4.6].filter(level => perSecond >= level).length + 1;
      const song: Song = { id, title, genre, prompt: '', model: 'starter-setlist', durationMs: chart.durationMs,
        hasStemMix: !!stems, credit, intensity, bpm: chart.bpm };
      return [id, { song, chart: async () => serialized, audio, stems }] as const;
    } catch (error) {
      throw new Error(`Starter setlist track "${title}" could not be loaded from ${folder}.`, { cause: error });
    }
  }));
}
