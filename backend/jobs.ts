import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Chart, Job, Song } from '../shared/song';
import { loadCatalog, playbackStems } from './catalog';
import { buildChart } from './charts';
import { analyze, atomicWrite, compose, model, preparePlaybackStems, separate } from './music';

type Row = {
  id: string; owner: string; prompt: string; seconds: number; request_key: string;
  stage: Job['stage']; error: string | null; duration_ms: number | null;
  audio_hash: string | null; chart_hash: string | null; model: string; separating: number;
};
const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

export function createJobStore() {
  const root = resolve(process.env.SONG_DATA_DIR || '.song-data');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const catalog = loadCatalog();
  const db = new DatabaseSync(join(root, 'library.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, prompt TEXT NOT NULL, seconds INTEGER NOT NULL,
      request_key TEXT NOT NULL, stage TEXT NOT NULL, error TEXT, duration_ms INTEGER,
      audio_hash TEXT, chart_hash TEXT, model TEXT NOT NULL, separating INTEGER NOT NULL DEFAULT 0, UNIQUE(owner, request_key)
    );
  `);
  const get = (owner: string, id: string) =>
    db.prepare('SELECT * FROM jobs WHERE owner = ? AND id = ?').get(owner, id) as Row | undefined;
  const dir = (id: string) => join(root, id);
  const stage = (id: string, value: Job['stage'], error: string | null = null) =>
    db.prepare('UPDATE jobs SET stage = ?, error = ? WHERE id = ?').run(value, error, id);
  const summary = (row: Row): Job => ({ id: row.id, stage: row.stage, ...(row.error ? { error: row.error, canRetryChart: existsSync(join(dir(row.id), 'master.mp3')) } : {}) });
  const song = (row: Row): Song => ({
    id: row.id, title: row.prompt.length > 65 ? row.prompt.slice(0, 62) + '…' : row.prompt,
    prompt: row.prompt, durationMs: row.duration_ms!, model: row.model, hasStemMix: !!playbackStems(dir(row.id)),
  });

  for (const row of db.prepare("SELECT * FROM jobs WHERE stage IN ('composing', 'charting')").all() as Row[]) {
    const saved = existsSync(join(dir(row.id), 'master.mp3')) &&
      (!row.separating || existsSync(join(dir(row.id), 'guitar.audio')));
    stage(row.id, saved ? 'queued' : 'failed', saved ? null : 'Generation was interrupted. Start a new attempt to retry.');
  }

  let working = false;
  const work = async () => {
    if (working) return;
    working = true;
    try {
      for (;;) {
        const row = db.prepare("SELECT * FROM jobs WHERE stage = 'queued' ORDER BY rowid LIMIT 1").get() as Row | undefined;
        if (!row) break;
        const folder = dir(row.id);
        try {
          await mkdir(folder, { recursive: true, mode: 0o700 });
          const master = join(folder, 'master.mp3');
          const started = performance.now();
          let composedAt = started;
          if (!existsSync(master)) {
            stage(row.id, 'composing');
            await compose(folder, row.prompt, row.seconds);
            composedAt = performance.now();
          }
          stage(row.id, 'charting');
          const hasGuitar = existsSync(join(folder, 'guitar.audio'));
          const hasBacking = (await readdir(folder)).some(file => /^backing-.*\.audio$/.test(file));
          if (!hasGuitar || !hasBacking) {
            db.prepare('UPDATE jobs SET separating = 1 WHERE id = ?').run(row.id);
            await separate(folder, row.seconds);
            db.prepare('UPDATE jobs SET separating = 0 WHERE id = ?').run(row.id);
          }
          const separatedAt = performance.now();
          const chart = buildChart(await analyze(folder));
          if (Math.abs(chart.durationMs - row.seconds * 1000) > 4_000) {
            throw new Error('The recording length differed from the requested duration.');
          }
          await preparePlaybackStems(folder);
          await saveChart(row.id, chart);
          console.info('Track ready', JSON.stringify({
            id: row.id, model: row.model, durationMs: chart.durationMs,
            composeMs: Math.round(composedAt - started),
            separationMs: Math.round(separatedAt - composedAt),
            chartMs: Math.round(performance.now() - separatedAt),
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message.split('\n')[0] : '';
          console.error('Generation failed', row.id, error instanceof Error ? error.name : 'Unknown error', message);
          stage(row.id, 'failed', message.startsWith('Command failed') || !message
            ? 'Audio analysis failed. Try again or check the server setup.' : message);
        }
      }
    } finally {
      working = false;
    }
  };
  const saveChart = async (id: string, chart: Chart) => {
    const folder = dir(id);
    const json = JSON.stringify(chart);
    await atomicWrite(join(folder, 'chart.json'), json);
    const audioHash = digest(await readFile(join(folder, 'master.mp3')));
    db.prepare("UPDATE jobs SET stage = 'ready', duration_ms = ?, audio_hash = ?, chart_hash = ? WHERE id = ?")
      .run(chart.durationMs, audioHash, digest(json), id);
  };
  const kick = () => void work().catch(error => console.error('Queue failed', error));
  kick();

  return {
    catalogIds() {
      return [...catalog.keys()];
    },
    async importBenchmarkTrack(id: string, title: string, chart: Chart) {
      db.prepare("INSERT OR IGNORE INTO jobs (id, owner, prompt, seconds, request_key, model, stage) VALUES (?, 'test-player', ?, 90, ?, 'blind', 'failed')")
        .run(id, title, id);
      await saveChart(id, chart);
    },
    enqueue(owner: string, prompt: string, seconds: number, key: string) {
      const existing = db.prepare('SELECT * FROM jobs WHERE owner = ? AND request_key = ?').get(owner, key) as Row | undefined;
      if (existing) return existing.prompt === prompt && existing.seconds === seconds ? summary(existing) : undefined;
      const id = randomUUID();
      db.prepare("INSERT INTO jobs (id, owner, prompt, seconds, request_key, model, stage) VALUES (?, ?, ?, ?, ?, ?, 'queued')")
        .run(id, owner, prompt, seconds, key, process.env.FIXTURE_MUSIC === '1' ? 'fixture' : model);
      kick();
      return { id, stage: 'queued' } as Job;
    },
    retry(owner: string, id: string) {
      const row = get(owner, id);
      if (row?.stage !== 'failed' || !existsSync(join(dir(id), 'master.mp3'))) return undefined;
      stage(id, 'queued');
      kick();
      return { id, stage: 'queued' } as Job;
    },
    job(owner: string, id: string) {
      const row = get(owner, id);
      return row && summary(row);
    },
    library(owner: string) {
      const saved = (db.prepare("SELECT * FROM jobs WHERE owner = ? AND stage = 'ready' ORDER BY rowid DESC").all(owner) as Row[]).map(song);
      return [...saved, ...Array.from(catalog.values(), track => track.song)];
    },
    assets(owner: string, id: string) {
      const starter = catalog.get(id);
      if (starter) return starter;
      const row = get(owner, id);
      if (row?.stage !== 'ready') return undefined;
      return { song: song(row), chart: () => readFile(join(dir(id), 'chart.json'), 'utf8'), audio: join(dir(id), 'master.mp3'), stems: playbackStems(dir(id)) };
    },
  };
}
