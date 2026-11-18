import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { io } from 'socket.io-client';
import { dailyChallenge, dailyKey, type DailyChallenge } from '../shared/daily';
import { notesFor } from '../shared/difficulty';
import { applyMods, normalizeMods } from '../shared/modifiers';
import type { Chart } from '../shared/song';

test('Production guests can play catalog tracks, join duels, and post scores without Firebase', { timeout: 90_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'shredder-guest-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FIREBASE_')));
  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    env: {
      ...env, NODE_ENV: 'production', PORT: '0', HOST: '127.0.0.1', SONG_DATA_DIR: root,
      DOTENV_CONFIG_PATH: join(root, '.env'), LOCAL_TEST_AUTH: '0', FIXTURE_MUSIC: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(server, 'close');
  let stdout = '';
  let stderr = '';
  server.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  try {
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server did not report its port within 45 seconds. ${stdout}\n${stderr}`)), 45_000);
      server.stdout.setEncoding('utf8').on('data', chunk => {
        stdout += chunk;
        const match = stdout.match(/Keyboard Shredder listening on port (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      void exited.then(([code]) => {
        clearTimeout(timer);
        reject(new Error(`Server exited with code ${code}. ${stderr}`));
      }, reject);
    });
    const origin = `http://127.0.0.1:${port}`;
    const token = 'guest-0123456789abcdef0123456789abcdef';
    const request = (path: string, body?: unknown, bearer = token) => fetch(origin + path, {
      headers: { authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal((await (await request('/api/config')).json()).guest, true);
    const library = await request('/api/songs');
    assert.equal(library.status, 200);
    const songs = await library.json() as { id: string; title: string; genre: string }[];
    assert.equal(songs.length, 43);
    assert.equal((await request('/api/songs', undefined, 'guest-0123')).status, 401);
    for (const path of ['/api/generations', '/api/generations/missing/retry']) {
      const generation = await request(path, {});
      assert.equal(generation.status, 403);
      assert.deepEqual(await generation.json(), { error: 'Sign in to create your own tracks.' });
    }

    function inputsFor(songId: string, difficulty: DailyChallenge['difficulty'], mods: DailyChallenge['mods']) {
      const chart = JSON.parse(readFileSync(join('catalog', songId, 'chart.json'), 'utf8')) as Chart;
      const notes = applyMods(notesFor(chart, difficulty), mods);
      return notes.flatMap(note => note.lanes.flatMap(lane => [
        [lane, 1, note.timeMs], [lane, 0, note.timeMs + 20],
      ])).sort((a, b) => a[2] - b[2]);
    }
    const inputs = inputsFor('river-amp', 'easy', []);
    const run = {
      songId: 'river-amp', difficulty: 'easy', mods: [], boosts: [],
      inputs: [...inputs, ...Array.from({ length: 1000 }, () => inputs.at(-1))],
    };
    const submitted = await request('/api/scores', run);
    assert.equal(submitted.status, 200);
    const result = await submitted.json();
    assert.equal(result.rank, 1);
    assert.equal(result.best, true);
    const top = await (await request('/api/scores/river-amp/easy')).json();
    assert.equal(top.entries[0].you, true);
    assert.equal(top.entries[0].name, 'Guitarist');
    assert.deepEqual(top.you, { rank: 1, score: result.score });

    const today = dailyKey();
    const daily = await (await request('/api/daily')).json() as DailyChallenge & { title: string; genre: string };
    const song = songs.find(song => song.id === daily.songId);
    assert.ok(song);
    assert.equal(daily.title, song.title);
    assert.equal(daily.genre, song.genre);
    assert.ok([today, dailyKey()].includes(daily.dateKey));
    function runFor({ songId, difficulty, mods, dateKey }: DailyChallenge) {
      return { songId, difficulty, mods: normalizeMods(mods), boosts: [], inputs: inputsFor(songId, difficulty, mods), daily: dateKey };
    }
    assert.equal((await request('/api/scores', { ...runFor(daily), daily: '2000-01-01' })).status, 400);
    const dailyScore = await request('/api/scores', runFor(daily));
    assert.equal(dailyScore.status, 200);
    assert.deepEqual((await dailyScore.json()).daily, { rank: 1, best: true });
    const dailyTop = await (await request('/api/daily')).json();
    if (dailyTop.dateKey === daily.dateKey) assert.equal(dailyTop.entries[0].you, true);
    const adjacentDay = dailyKey(new Date(Date.now() + 86_400_000));
    const adjacent = dailyChallenge(adjacentDay, songs.map(song => song.id));
    const adjacentScore = await request('/api/scores', runFor(adjacent));
    assert.equal(adjacentScore.status, 200);
    assert.deepEqual((await adjacentScore.json()).daily, { rank: 1, best: true });

    const socketOptions = { transports: ['websocket'], reconnection: false };
    const host = io(origin, { ...socketOptions, auth: { token } });
    const guest = io(origin, { ...socketOptions, auth: { token: 'guest-' + 'a'.repeat(32) } });
    try {
      const created = await host.timeout(2000).emitWithAck('create-duel', { songId: 'river-amp', difficulty: 'expert' });
      assert.ok(created.id);
      assert.deepEqual(await guest.timeout(2000).emitWithAck('join-duel', created.id), { id: created.id, slot: 1 });
    } finally {
      host.disconnect();
      guest.disconnect();
    }

    for (let i = 4; i < 30; i++) assert.equal((await request('/api/scores', {})).status, 400);
    const limited = await request('/api/scores', run);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'Too many score submissions. Try again in a few minutes.' });
  } finally {
    server.kill();
    await exited;
    rmSync(root, { recursive: true, force: true });
  }
});
