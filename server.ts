import 'dotenv/config';
import express from 'express';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp } from 'firebase-admin/app';
import { resolve } from 'node:path';
import { createJobStore } from './backend/jobs';

const localTest = process.env.LOCAL_TEST_AUTH === '1';
const projectId = process.env.FIREBASE_PROJECT_ID;
const apiKey = process.env.FIREBASE_WEB_API_KEY;
const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
const firebase = projectId && apiKey && authDomain ? { projectId, apiKey, authDomain } : null;
const admin = firebase && !localTest ? getAuth(initializeApp({ projectId })) : null;
if (process.env.FIXTURE_MUSIC === '1' && !localTest) throw new Error('Fixture music requires loopback test auth.');
const app = express();
const store = createJobStore();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.get('/api/config', (_request, response) => {
  response.json({ firebase, localTest, musicEnabled: !!process.env.ELEVENLABS_API_KEY || process.env.FIXTURE_MUSIC === '1',
    legacyDatabaseId: process.env.FIREBASE_LEGACY_DATABASE_ID || null });
});

app.use('/api', async (request, response, next) => {
  response.set('Cache-Control', 'private, no-store');
  const token = request.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || '';
  if (localTest && /^test-[a-z0-9]{1,40}$/.test(token)) {
    response.locals.uid = token;
    return next();
  }
  if (admin && token) {
    try {
      response.locals.uid = (await admin.verifyIdToken(token)).uid;
      return next();
    } catch {
      // Invalid or expired credentials return the same response.
    }
  }
  return response.status(401).json({ error: 'Sign in to access your songs.' });
});
app.post('/api/generations', (request, response) => {
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
app.get('/api/songs/:id/audio', (request, response) => {
  const assets = store.assets(response.locals.uid, request.params.id);
  return assets ? response.sendFile(assets.audio) : response.status(404).json({ error: 'Audio not found.' });
});
app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('*', (_request, response) => response.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, localTest ? '127.0.0.1' : process.env.HOST || '0.0.0.0', () => {
  const address = server.address();
  if (address && typeof address !== 'string') console.log(`Keyboard Shredder listening on port ${address.port}`);
});
