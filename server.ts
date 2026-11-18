import 'dotenv/config';
import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { attachDuels } from './backend/duels';
import { createProfileStore } from './backend/profiles';
import { createLeaderboard, replayRun } from './backend/leaderboard';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp } from 'firebase-admin/app';
import { resolve } from 'node:path';
import { createJobStore } from './backend/jobs';
import { dailyChallenge, dailyKey } from './shared/daily';
import { isDifficulty } from './shared/difficulty';
import { isRanked, normalizeMods, type ModId } from './shared/modifiers';
import type { Chart, Difficulty } from './shared/song';

const localTest = process.env.LOCAL_TEST_AUTH === '1';
const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (authEmulator && (!/^(localhost|127\.0\.0\.1):[0-9]{1,5}$/.test(authEmulator) || localTest)) {
  throw new Error('Use the Firebase Auth emulator on loopback without test auth.');
}
const projectId = process.env.FIREBASE_PROJECT_ID;
const apiKey = process.env.FIREBASE_WEB_API_KEY;
const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
const firebase = projectId && apiKey && authDomain ? { projectId, apiKey, authDomain } : null;
const admin = firebase && !localTest ? getAuth(initializeApp({ projectId })) : null;
if (process.env.FIXTURE_MUSIC === '1' && !localTest) throw new Error('Fixture music requires loopback test auth.');
const app = express();
const store = createJobStore();
const profiles = createProfileStore();
const leaderboard = createLeaderboard();
const catalogIds = store.catalogIds();
const server = createHttpServer(app);
async function authenticate(token: string) {
  if (/^guest-[a-f0-9]{32}$/.test(token)) return 'guest:' + token.slice(6);
  if (localTest && /^test-[a-z0-9]{1,40}$/.test(token)) return token;
  if (admin && token) {
    try { return (await admin.verifyIdToken(token)).uid; }
    catch { return undefined; }
  }
}
const duels = attachDuels(server, authenticate, store, profiles);
const scoreWindowMs = 10 * 60 * 1000;
const scoreLimits = new Map<string, { expires: number; count: number }>();

function allowScore(uid: string) {
  const now = performance.now();
  for (const [player, limit] of scoreLimits) {
    if (limit.expires > now) break;
    scoreLimits.delete(player);
  }
  const limit = scoreLimits.get(uid);
  if (limit) {
    if (limit.count === 30) return false;
    limit.count++;
    return true;
  }
  if (scoreLimits.size >= 10_000) return false;
  scoreLimits.set(uid, { expires: now + scoreWindowMs, count: 1 });
  return true;
}

function scoreBoard(songId: string, difficulty: Difficulty, mods: ModId[]) {
  const board = `${songId}:${difficulty}`;
  return mods.length ? `${board}:${mods.join('+')}` : board;
}

app.disable('x-powered-by');
app.get('/healthz', (_request, response) => response.sendStatus(200));
app.get('/api/config', (_request, response) => {
  response.json({ firebase, localTest, guest: true, ...(authEmulator ? { authEmulator: 'http://' + authEmulator } : {}), musicEnabled: !!process.env.ELEVENLABS_API_KEY || process.env.FIXTURE_MUSIC === '1',
    legacyDatabaseId: process.env.FIREBASE_LEGACY_DATABASE_ID || null });
});

app.use('/api', async (request, response, next) => {
  response.set('Cache-Control', 'private, no-store');
  const token = request.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || '';
  const uid = await authenticate(token);
  if (!uid) return response.status(401).json({ error: 'Sign in to access your studio.' });
  response.locals.uid = uid;
  next();
});
app.post('/api/scores', (request, response, next) => {
  if (!allowScore(response.locals.uid)) {
    return response.status(429).json({ error: 'Too many score submissions. Try again in a few minutes.' });
  }
  next();
}, express.json({ limit: '400kb' }), async (request, response, next) => {
  const uid = response.locals.uid;
  const input = request.body ?? {};
  const { songId, difficulty, daily } = input;
  try {
    const assets = typeof songId === 'string' ? store.assets(uid, songId) : undefined;
    if (assets?.song.model !== 'starter-setlist') {
      return response.status(400).json({ error: 'Only setlist songs have leaderboards.' });
    }
    if (!isDifficulty(difficulty)) return response.status(400).json({ error: 'Choose a valid difficulty.' });
    const chart = JSON.parse(await assets.chart()) as Chart;
    const result = replayRun(chart, input);
    if (result.ok === false) return response.status(400).json({ error: result.error });
    const mods = normalizeMods(input.mods);
    if (!isRanked(mods)) return response.status(400).json({ error: 'Slow-mo runs are not ranked.' });
    if (typeof daily === 'string') {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const allowedDates = [-dayMs, 0, dayMs].map(offset => dailyKey(new Date(now + offset)));
      if (!allowedDates.includes(daily)) return response.status(400).json({ error: 'Choose a current daily challenge.' });
      const challenge = dailyChallenge(daily, catalogIds);
      const dailyMods = normalizeMods(challenge.mods);
      if (songId !== challenge.songId || difficulty !== challenge.difficulty ||
          mods.length !== dailyMods.length || mods.some((mod, i) => mod !== dailyMods[i])) {
        return response.status(400).json({ error: 'This run does not match the daily challenge.' });
      }
    }
    const { name } = profiles.get(uid);
    const placement = leaderboard.submit(scoreBoard(songId, difficulty, mods), uid, name, result);
    const dailyPlacement = typeof daily === 'string' ? leaderboard.submit('daily:' + daily, uid, name, result) : null;
    const { score, rating, stars } = result;
    return response.json({
      score, rating, stars, ...placement,
      ...(dailyPlacement ? { daily: { rank: dailyPlacement.rank, best: dailyPlacement.best } } : {}),
    });
  } catch (error) {
    return next(error);
  }
});
app.get('/api/scores/:songId/:difficulty', (request, response) => {
  const { songId, difficulty } = request.params;
  if (!isDifficulty(difficulty)) return response.status(400).json({ error: 'Choose a valid difficulty.' });
  const query = request.query.mods;
  const ids = typeof query === 'string' && query ? query.split(/[+ ]/) : [];
  const mods = normalizeMods(ids);
  if ((query !== undefined && typeof query !== 'string') || ids.length !== mods.length) {
    return response.status(400).json({ error: 'Choose valid modifiers.' });
  }
  return response.json(leaderboard.top(scoreBoard(songId, difficulty, mods), response.locals.uid));
});
app.get('/api/daily', (_request, response) => {
  const uid = response.locals.uid;
  const challenge = dailyChallenge(dailyKey(), catalogIds);
  const song = store.assets(uid, challenge.songId)?.song;
  if (!song) return response.status(404).json({ error: 'The daily track is unavailable.' });
  return response.json({
    ...challenge, title: song.title, genre: song.genre, ...leaderboard.top('daily:' + challenge.dateKey, uid),
  });
});
app.use(express.json({ limit: '8kb' }));
app.get('/api/profile', (_request, response) => response.json(profiles.get(response.locals.uid)));
app.put('/api/profile', (request, response) => {
  const profile = profiles.save(response.locals.uid, request.body);
  if (!profile) return response.status(400).json({ error: 'Check your profile options and select an earned badge.' });
  duels.profileChanged(response.locals.uid, profile);
  return response.json(profile);
});
app.post('/api/duels/:id/leave', (request, response) => {
  duels.leave(request.params.id, response.locals.uid);
  return response.sendStatus(204);
});
app.get('/api/duels/:id/track', async (request, response, next) => {
  const assets = duels.assets(request.params.id, response.locals.uid);
  if (!assets) return response.status(404).json({ error: 'Join this duel to access the track.' });
  try { return response.json({ song: assets.song, chart: JSON.parse(await assets.chart()) }); }
  catch (error) { return next(error); }
});
app.get('/api/duels/:id/audio/:stem?', (request, response) => {
  const assets = duels.assets(request.params.id, response.locals.uid);
  const { stem } = request.params;
  const path = stem === 'lead' || stem === 'backing' ? assets?.stems?.[stem] : stem ? undefined : assets?.audio;
  return path ? response.sendFile(path) : response.status(404).json({ error: 'Join this duel to access the track.' });
});
app.post('/api/generations', (request, response) => {
  if (response.locals.uid.startsWith('guest:')) {
    return response.status(403).json({ error: 'Sign in to create your own tracks.' });
  }
  const { prompt, durationSeconds, key } = request.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 500 ||
      ![30, 90].includes(durationSeconds) || typeof key !== 'string' || !/^[\w-]{12,100}$/.test(key)) {
    return response.status(400).json({ error: 'Enter a music description of 1 to 500 characters and select a track length.' });
  }
  const job = store.enqueue(response.locals.uid, prompt.trim(), durationSeconds, key);
  return job ? response.status(202).json(job) : response.status(409).json({ error: 'This request key was already used for a different song.' });
});
app.get('/api/generations/:id', (request, response) => {
  const job = store.job(response.locals.uid, request.params.id);
  return job ? response.json(job) : response.status(404).json({ error: 'Generation not found.' });
});
app.post('/api/generations/:id/retry', (request, response) => {
  if (response.locals.uid.startsWith('guest:')) {
    return response.status(403).json({ error: 'Sign in to create your own tracks.' });
  }
  const job = store.retry(response.locals.uid, request.params.id);
  return job ? response.status(202).json(job) : response.status(409).json({ error: 'No saved recording is available for analysis.' });
});
app.get('/api/songs', (_request, response) => response.json(store.library(response.locals.uid)));
app.get('/api/songs/:id', async (request, response, next) => {
  const assets = store.assets(response.locals.uid, request.params.id);
  if (!assets) return response.status(404).json({ error: 'Song not found.' });
  try {
    return response.json({ song: assets.song, chart: JSON.parse(await assets.chart()) });
  } catch (error) {
    return next(error);
  }
});
app.get('/api/songs/:id/audio/:stem?', (request, response) => {
  const assets = store.assets(response.locals.uid, request.params.id);
  const { stem } = request.params;
  const path = stem === 'lead' || stem === 'backing' ? assets?.stems?.[stem] : stem ? undefined : assets?.audio;
  return path ? response.sendFile(path) : response.status(404).json({ error: 'Audio not found.' });
});
app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }));

if (process.env.NODE_ENV === 'production') {
  const frontend = resolve(process.env.STATIC_DIR || 'dist');
  app.use(express.static(frontend));
  app.get('*', (_request, response) => response.sendFile(resolve(frontend, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 3000);
server.listen(port, localTest || authEmulator ? '127.0.0.1' : process.env.HOST || '0.0.0.0', () => {
  const address = server.address();
  if (address && typeof address !== 'string') console.log(`Keyboard Shredder listening on port ${address.port}`);
});
