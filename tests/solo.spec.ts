import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import type { Chart, Job, Song } from '../shared/song';

const live = Number(process.env.LIVE_MUSIC_SECONDS) || 0;
const headers = { Authorization: 'Bearer test-player' };
const keys = ['a', 's', 'd', 'f', 'g'];

async function launch(data: string, failFirstSeparation = false) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '0', LOCAL_TEST_AUTH: '1', FIXTURE_MUSIC: live ? '0' : '1', SONG_DATA_DIR: data,
      FIXTURE_FAIL_FIRST_SEPARATION: failFirstSeparation ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  let url = '';
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output);
      url = output.match(/Keyboard Shredder listening on port (\d+)/)?.[1] || '';
      return url;
    }).not.toBe('');
    return { child, url: `http://127.0.0.1:${url}`, output: () => output };
  } catch (error) {
    await stop(child);
    throw error;
  }
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill();
  await exit;
}

test('A generated track becomes playable, scores a key press and replays after a service restart', async ({ page }, testInfo) => {
  const data = await mkdtemp(join(tmpdir(), 'keyboard-shredder-'));
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    server = await launch(data);
    let url = server.url;
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Create a track' })).toBeVisible();
    const prompt = 'Blues rock with a catchy gritty guitar hook and ringing power chords';
    await page.getByLabel('Describe your music').fill(prompt);
    await page.getByRole('combobox', { name: 'Length', exact: true }).selectOption(String(live || 30));
    const created = page.waitForResponse(response => response.url().endsWith('/api/generations') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Generate track' }).click();
    const creation = await created;
    expect(creation.status()).toBe(202);
    const job = await creation.json() as Job;
    await expect(page.getByRole('progressbar', { name: 'Generating track' })).toBeVisible();

    if (!live) {
      const retrySameRequest = await page.request.post(url + '/api/generations', {
        headers, data: creation.request().postDataJSON(),
      });
      expect((await retrySameRequest.json()).id).toBe(job.id);
    }

    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect.poll(async () => {
      const response = await page.request.get(`${url}/api/generations/${job.id}`, { headers });
      const status = await response.json() as Job;
      if (status.stage === 'failed') throw new Error(status.error);
      return status.stage;
    }, { timeout: live ? 420_000 : 140_000 }).toBe('ready');
    await expect(play).toBeFocused();
    const { chart, song } = await (await page.request.get(`${url}/api/songs/${job.id}`, { headers })).json() as { chart: Chart; song: Song };
    expect(song.model).toBe(live ? 'music_v2_5' : 'fixture');
    expect(song.hasStemMix).toBe(true);
    expect(Math.abs(chart.durationMs - (live || 30) * 1000)).toBeLessThanOrEqual(4000);
    expect(chart.events.hard.length).toBeGreaterThanOrEqual(8);
    if (!live) {
      const attacks: number[] = JSON.parse(await readFile(join(data, job.id, 'fixture-attacks.json'), 'utf8'));
      const errors = chart.events.hard.map(event => Math.min(...attacks.map(attack => Math.abs(attack - event.timeMs)))).sort((a, b) => a - b);
      expect(errors[Math.floor(errors.length / 2)]).toBeLessThanOrEqual(30);
      expect(chart.events.normal.some(event => event.lanes.length === 2)).toBe(true);
      expect(chart.events.normal.some(event => event.durationMs > 240)).toBe(true);
      await testInfo.attach('fixture-onset-errors-ms', { body: JSON.stringify(errors), contentType: 'application/json' });
    }

    if (!live) await page.screenshot({ path: testInfo.outputPath('fretboard.png') });
    await play.click();
    await hitNotes(page, chart);
    await expect(page.getByText(/^Score [1-9]/)).toBeVisible();
    if (!live) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeFocused();
      const progress = page.getByRole('progressbar', { name: 'Track progress' });
      const pausedAt = await progress.getAttribute('value');
      await expect(progress).toHaveAttribute('value', pausedAt!);
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Track complete' })).toBeVisible({ timeout: chart.durationMs + 5000 });
    await expect(page.getByRole('button', { name: 'Replay', exact: true })).toBeFocused();

    const foreign = { Authorization: 'Bearer test-stranger' };
    for (const endpoint of [`/api/songs/${job.id}`, `/api/songs/${job.id}/audio`, `/api/songs/${job.id}/audio/lead`, `/api/songs/${job.id}/audio/backing`, `/api/generations/${job.id}`]) {
      expect((await page.request.get(url + endpoint, { headers: foreign })).status()).toBe(404);
    }
    const before = await (await page.request.get(`${url}/api/songs/${job.id}/audio`, { headers })).body();
    await testInfo.attach('generation-server.log', { body: server.output(), contentType: 'text/plain' });
    await stop(server.child);
    server = await launch(data);
    url = server.url;
    await page.goto(url);
    await page.getByRole('button', { name: `Load ${song.title}` }).click();
    await expect(play).toBeVisible();
    expect(await (await page.request.get(`${url}/api/songs/${job.id}/audio`, { headers })).body()).toEqual(before);
    await play.click();
    await expect.poll(() => page.getByRole('progressbar', { name: 'Track progress' }).getAttribute('value').then(Number)).toBeGreaterThan(150);
    await page.getByRole('button', { name: 'Exit track' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: `Load ${song.title}` })).toBeVisible();

    if (!live) {
      await page.screenshot({ path: testInfo.outputPath('studio-desktop.png') });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 360, height: 800 });
      await expect(page.getByRole('button', { name: 'Generate track' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
      await page.screenshot({ path: testInfo.outputPath('studio-phone.png'), fullPage: true });
      await stop(server.child);
      const db = new DatabaseSync(join(data, 'library.sqlite'));
      db.prepare("UPDATE jobs SET stage = 'charting' WHERE id = ?").run(job.id);
      db.close();
      server = await launch(data);
      await expect.poll(async () => {
        const response = await page.request.get(`${server!.url}/api/generations/${job.id}`, { headers });
        return (await response.json()).stage;
      }, { timeout: 140_000 }).toBe('ready');
      const recovered = await (await page.request.get(`${server.url}/api/songs/${job.id}/audio`, { headers })).body();
      expect(recovered).toEqual(before);
    }
  } finally {
    if (server) {
      if (testInfo.status !== testInfo.expectedStatus) console.log(server.output());
      await stop(server.child);
    }
    await rm(data, { recursive: true, force: true });
  }
});

async function hitNotes(page: Page, chart: Chart) {
  const progress = page.getByRole('progressbar', { name: 'Track progress' });
  for (const [index, event] of chart.events.normal.filter(event => event.timeMs >= 400).slice(0, 8).entries()) {
    const gap = await progress.evaluate((element, { id, threshold, measure }) => new Promise<number | null>((resolve, reject) => {
      const deadline = performance.now() + 20_000;
      const wait = () => {
        if ((element as HTMLProgressElement).value < threshold) {
          if (performance.now() > deadline) reject(new Error('Playback did not advance.'));
          else requestAnimationFrame(wait);
          return;
        }
        if (!measure) return resolve(null);
        const line = document.querySelector('.strike-line')?.getBoundingClientRect();
        const gem = document.querySelector(`[data-note="${id}"]`)?.getBoundingClientRect();
        if (!line || !gem) return reject(new Error('The note or strike line is missing.'));
        resolve(Math.abs(line.top + line.height / 2 - (gem.top + gem.height / 2)));
      };
      wait();
    }), { id: event.id, threshold: event.timeMs - 30, measure: !live && index === 0 });
    if (gap !== null) expect(gap).toBeLessThan(18);
    await Promise.all(event.lanes.map(lane => page.keyboard.down(keys[lane])));
    await Promise.all(event.lanes.map(lane => page.keyboard.up(keys[lane])));
  }
}

test('A failed separation can be retried from the saved recording', async ({ page }) => {
  test.skip(!!live, 'The fixture intentionally fails its first separation.');
  const data = await mkdtemp(join(tmpdir(), 'keyboard-shredder-'));
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    server = await launch(data, true);
    await page.goto(server.url);
    await page.getByRole('combobox', { name: 'Length', exact: true }).selectOption('30');
    const created = page.waitForResponse(response => response.url().endsWith('/api/generations') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Generate track' }).click();
    const job = await (await created).json() as Job;
    await expect(page.getByRole('alert')).toContainText('did not return a usable guitar stem');
    const original = await readFile(join(data, job.id, 'master.mp3'));
    await page.getByRole('button', { name: 'Retry chart analysis' }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 140_000 });
    const saved = await page.request.get(`${server.url}/api/songs/${job.id}/audio`, { headers });
    expect(await saved.body()).toEqual(original);
  } finally {
    if (server) await stop(server.child);
    await rm(data, { recursive: true, force: true });
  }
});

test('Two players share an invite, land the same chord within 90 ms of each other, and keep their duel badges', async ({ page, browser }, testInfo) => {
  test.skip(!!live, 'Multiplayer sync uses the deterministic fixture.');
  const data = await mkdtemp(join(tmpdir(), 'keyboard-duel-'));
  await page.setViewportSize({ width: 1280, height: 720 });
  const other = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const guest = await other.newPage();
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    server = await launch(data);
    const { url } = server;
    const created = await page.request.post(url + '/api/generations', {
      headers, data: { prompt: 'Duel sync test', durationSeconds: 30, key: 'duel-fixture-once' },
    });
    const job = await created.json() as Job;
    await expect.poll(async () => {
      const status = await (await page.request.get(`${url}/api/generations/${job.id}`, { headers })).json() as Job;
      if (status.stage === 'failed') throw new Error(status.error);
      return status.stage;
    }, { timeout: 140_000 }).toBe('ready');
    const { chart } = await (await page.request.get(`${url}/api/songs/${job.id}`, { headers })).json() as { chart: Chart };

    await page.goto(url);
    await page.emulateMedia({ colorScheme: 'dark' });
    const forged = await page.request.put(url + '/api/profile', {
      headers, data: { name: 'Riff Captain', palette: 'Neon', avatar: 'Lightning', speed: 1900, badge: 'winner' },
    });
    expect(forged.status()).toBe(400);
    await page.getByText('Player profile', { exact: true }).click();
    await page.getByLabel('Display name').fill('Riff Captain');
    await page.getByLabel('Lane palette').selectOption('Neon');
    await page.getByLabel('Avatar').selectOption('Lightning');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Head-to-head' }).click();
    await page.getByRole('combobox', { name: /^Track/ }).selectOption(job.id);
    await page.getByRole('button', { name: 'Create invite' }).click();
    const invite = await page.getByLabel('Invite link').inputValue();
    const id = new URL(invite).searchParams.get('duel')!;
    const guestHeaders = { Authorization: 'Bearer test-guest' };
    expect((await guest.request.get(`${url}/api/duels/${id}/audio`, { headers: guestHeaders })).status()).toBe(404);
    await guest.goto(invite + '&player=test-guest');
    await expect(guest.getByText('Riff Captain', { exact: true })).toBeVisible();
    await expect(page.getByText('Guitarist', { exact: true })).toBeVisible();
    for (const endpoint of ['track', 'audio']) {
      const hostAsset = await page.request.get(`${url}/api/duels/${id}/${endpoint}`, { headers });
      const guestAsset = await guest.request.get(`${url}/api/duels/${id}/${endpoint}`, { headers: guestHeaders });
      expect(await guestAsset.body()).toEqual(await hostAsset.body());
    }
    await guest.screenshot({ path: testInfo.outputPath('duel-lobby-phone.png'), fullPage: true });
    await page.screenshot({ path: testInfo.outputPath('duel-lobby-dark.png'), fullPage: true });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.getByRole('button', { name: 'Ready up' }).click();
    await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeDisabled();
    await guest.getByRole('button', { name: 'Ready up' }).click();
    await expect(guest.getByRole('button', { name: 'Play lane 5' })).toBeVisible();
    const pad = (await guest.getByRole('button', { name: 'Play lane 5' }).boundingBox())!;
    const line = (await page.locator('.strike-line').boundingBox())!;
    expect(pad.y + pad.height).toBeLessThanOrEqual(640);
    expect(line.y + line.height).toBeLessThan(720);
    const chord = chart.events.normal.find(event => event.lanes.length > 1 && event.timeMs > 800)!;
    const startTimes = await Promise.all([page, guest].map(async client => {
      const observed = await client.getByRole('progressbar', { name: 'Track progress' }).evaluate((element, target) =>
        new Promise<{ elapsed: number; wall: number }>((resolve, reject) => {
          const end = performance.now() + 20_000;
          const wait = () => {
            const elapsed = (element as HTMLProgressElement).value;
            if (elapsed >= target) resolve({ elapsed, wall: Date.now() });
            else if (performance.now() > end) reject(new Error('The shared track did not reach the chord.'));
            else requestAnimationFrame(wait);
          };
          wait();
        }), chord.timeMs - 30);
      await Promise.all(chord.lanes.map(lane => client.keyboard.down(keys[lane])));
      await Promise.all(chord.lanes.map(lane => client.keyboard.up(keys[lane])));
      return observed.wall - observed.elapsed;
    }));
    const skew = Math.abs(startTimes[0] - startTimes[1]);
    await testInfo.attach('playback-skew-ms', { body: String(skew), contentType: 'text/plain' });
    expect(skew).toBeLessThan(90);
    console.log(`Two-client playback skew: ${skew.toFixed(1)} ms`);
    for (const client of [page, guest]) {
      await expect(client.getByLabel('Duel scoreboard').getByText(/^(70|100) pts$/)).toHaveCount(2);
    }
    const beforeReconnect = Number(await guest.getByRole('progressbar', { name: 'Track progress' }).getAttribute('value'));
    await guest.reload();
    await guest.getByRole('button', { name: 'Join playback' }).click();
    await expect.poll(() => guest.getByRole('progressbar', { name: 'Track progress' }).getAttribute('value').then(Number))
      .toBeGreaterThan(beforeReconnect);
    await expect(guest.getByLabel('Duel scoreboard').getByText(/^(70|100) pts$/)).toHaveCount(2);
    for (const client of [page, guest]) {
      await expect(client.getByText(/Earned badges: First duel/)).toBeVisible({ timeout: 45_000 });
    }
    await page.getByRole('button', { name: 'Set up rematch' }).click();
    await expect(page.getByRole('button', { name: 'Ready up' })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('button', { name: 'Ready up' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to studio' }).click();
    await page.getByText('Player profile', { exact: true }).click();
    await page.getByLabel('Featured badge').selectOption('debut');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await stop(server.child);
    server = await launch(data);
    await page.goto(server.url);
    await page.getByText('Player profile', { exact: true }).click();
    await expect(page.getByLabel('Lane palette')).toHaveValue('Neon');
    await expect(page.getByLabel('Featured badge')).toHaveValue('debut');
    await expect(page.locator('.player-card').getByText('First duel', { exact: true })).toBeVisible();
    await expect(page.getByText(/1 completed duels/)).toBeVisible();
  } finally {
    try { await other.close(); }
    finally {
      if (server) await stop(server.child);
      await rm(data, { recursive: true, force: true });
    }
  }
});

test('A fresh player gets 24 tracks with three difficulties and can play a two-finger chord', async ({ page, browser, browserName }) => {
  test.skip(!!live, 'The starter setlist is bundled with the game.');
  test.skip(browserName !== 'chromium', 'This test uses Chromium’s native multi-touch input protocol.');
  const data = await mkdtemp(join(tmpdir(), 'keyboard-setlist-'));
  const phone = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    server = await launch(data);
    const { url } = server;
    const songs = await (await page.request.get(url + '/api/songs', { headers })).json() as Song[];
    expect(songs).toHaveLength(24);
    const fullSongs = songs.filter(song => song.durationMs >= 60_000);
    expect(fullSongs.map(song => song.id)).toEqual(['voltage-parade', 'copper-moon', 'big-rock', 'end-of-days']);
    expect(fullSongs.filter(song => song.credit).map(song => song.credit?.artist)).toEqual(['Kevin MacLeod', 'Severed Fifth']);
    expect(new Set(songs.map(song => song.genre)).size).toBe(10);
    for (const song of songs) {
      const response = await page.request.get(`${url}/api/songs/${song.id}`, { headers });
      const { chart } = await response.json() as { chart: Chart };
      expect(chart.events.easy?.length).toBeGreaterThan(0);
      expect(chart.events.easy!.every(event => event.lanes.length === 1)).toBe(true);
      expect(chart.events.easy!.length).toBeLessThan(chart.events.normal.length);
      expect(chart.events.normal.length).toBeLessThan(chart.events.hard.length);
      expect(song.hasStemMix).toBe(true);
      for (const part of ['', '/lead', '/backing']) {
        const audio = await page.request.get(`${url}/api/songs/${song.id}/audio${part}`, { headers: { ...headers, Range: 'bytes=0-1023' } });
        expect(audio.status()).toBe(206);
        expect((await audio.body()).length).toBe(1024);
      }
    }
    const mobile = await phone.newPage();
    await mobile.goto(url);
    await expect(mobile.getByRole('button', { name: 'Play Blacktop Sparks' })).toBeInViewport();
    await mobile.getByLabel('Genre').selectOption('Funk');
    await expect(mobile.getByRole('button', { name: /^Load / })).toHaveCount(2);
    await mobile.getByLabel('Difficulty').selectOption('easy');
    await mobile.getByRole('button', { name: 'Load Mirrorball Static' }).click();
    await expect(mobile.getByText(/^Easy ·/)).toBeVisible();
    await mobile.getByRole('button', { name: 'Exit track' }).click();
    await mobile.getByLabel('Difficulty').selectOption('normal');
    await mobile.getByRole('button', { name: 'Load Mirrorball Static' }).click();
    await mobile.getByRole('button', { name: 'Play', exact: true }).tap();
    const { chart } = await (await page.request.get(url + '/api/songs/mirrorball-static', { headers })).json() as { chart: Chart };
    const chord = chart.events.normal.find(event => event.lanes.length === 2 && event.timeMs > 800)!;
    const session = await phone.newCDPSession(mobile);
    const touchPoints = await Promise.all(chord.lanes.map(async (lane, id) => {
      const box = await mobile.getByRole('button', { name: `Play lane ${lane + 1}` }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, id };
    }));
    await mobile.waitForFunction(time => Number(document.querySelector('progress')?.value) >= time, chord.timeMs - 30);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(mobile.getByText(/^Score (70|100)$/)).toBeVisible();
  } finally {
    try { await phone.close(); }
    finally {
      if (server) await stop(server.child);
      await rm(data, { recursive: true, force: true });
    }
  }
});

test('A charged amp doubles the next note award on both duel scoreboards', async ({ page, browser }) => {
  test.skip(!!live, 'The duel uses a bundled track.');
  const data = await mkdtemp(join(tmpdir(), 'keyboard-boost-'));
  const guestContext = await browser.newContext();
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    server = await launch(data);
    const { url } = server;
    const guest = await guestContext.newPage();
    const { chart } = await (await page.request.get(url + '/api/songs/blacktop-sparks', { headers })).json() as { chart: Chart };
    await page.goto(url);
    await page.getByRole('button', { name: 'Head-to-head' }).click();
    await page.getByRole('combobox', { name: /^Track/ }).selectOption('blacktop-sparks');
    await page.getByLabel('Duel difficulty').selectOption('easy');
    await page.getByRole('button', { name: 'Create invite' }).click();
    await guest.goto((await page.getByLabel('Invite link').inputValue()) + '&player=test-guest');
    await page.getByRole('button', { name: 'Ready up' }).click();
    await guest.getByRole('button', { name: 'Ready up' }).click();

    const notes = chart.events.easy!.filter(event => event.timeMs >= 350 && !event.durationMs);
    const boost = page.getByRole('button', { name: 'Boost Space', exact: true });
    const score = page.getByLabel('Duel scoreboard').locator('.duel-player').first().locator('strong').last();
    const opponentScore = guest.getByLabel('Duel scoreboard').locator('.duel-player').first().locator('strong').last();
    const numeric = async () => Number((await score.textContent())!.replace(/[^0-9]/g, ''));
    let boosted = false;
    for (const note of notes.slice(0, 28)) {
      const ready = await boost.isEnabled();
      if (ready) {
        await page.keyboard.press('Space');
        await expect(page.getByText('Boost active', { exact: true })).toBeVisible();
      }
      const previous = await numeric();
      const oldJudgement = await page.evaluate(() => document.querySelector('.hit-callout')?.getAttribute('data-judged-at'));
      await page.waitForFunction(time => Number(document.querySelector('progress')?.value) >= time, note.timeMs - 25);
      await page.keyboard.press(keys[note.lanes[0]]);
      const feedback = page.locator('.hit-callout').filter({ hasText: /^(Perfect|Good) \+/ });
      if (oldJudgement) await expect(feedback).not.toHaveAttribute('data-judged-at', oldJudgement);
      await expect(feedback).toBeVisible();
      const points = Number((await feedback.locator('strong').textContent())!.split('+')[1]);
      await expect.poll(numeric, { intervals: [25, 50, 50] }).toBe(previous + points);
      if (ready) {
        expect(points).toBeGreaterThanOrEqual(140);
        await expect(opponentScore).toHaveText(await score.textContent() || '');
        await page.reload();
        await page.getByRole('button', { name: 'Join playback' }).click();
        await expect(page.getByText('Boost active', { exact: true })).toBeVisible();
        boosted = true;
        break;
      }
    }
    expect(boosted).toBe(true);
  } finally {
    try { await guestContext.close(); }
    finally {
      if (server) await stop(server.child);
      await rm(data, { recursive: true, force: true });
    }
  }
});

test('A missed note leaves the guitar silent while a hit brings it into the backing mix', async ({ page }) => {
  test.skip(!!live, 'The test uses known note times on the bundled recording.');
  const data = await mkdtemp(join(tmpdir(), 'keyboard-stem-gate-'));
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    server = await launch(data);
    await page.addInitScript(() => {
      const meters: AnalyserNode[] = [];
      const source = AudioContext.prototype.createBufferSource;
      const gain = AudioContext.prototype.createGain;
      const watch = (node: AudioNode) => {
        const meter = node.context.createAnalyser();
        meter.fftSize = 512;
        node.connect(meter);
        meters.push(meter);
      };
      AudioContext.prototype.createBufferSource = function () {
        const node = source.call(this);
        if (!meters.length) watch(node);
        return node;
      };
      AudioContext.prototype.createGain = function () {
        const node = gain.call(this);
        watch(node);
        return node;
      };
      Object.assign(window, {
        stemSamples: () => meters.map(meter => {
          const samples = new Float32Array(meter.fftSize);
          meter.getFloatTimeDomainData(samples);
          return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        }),
      });
    });

    const { url } = server;
    const { chart } = await (await page.request.get(url + '/api/songs/blacktop-sparks', { headers })).json() as { chart: Chart };
    const [miss, hit] = chart.events.easy!.filter(event => event.timeMs > 300 && !event.durationMs);
    await page.goto(url);
    await page.getByRole('combobox', { name: 'Difficulty', exact: true }).selectOption('easy');
    await page.getByRole('button', { name: 'Play Blacktop Sparks' }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const audioAt = (time: number) => page.evaluate(async time => {
      const progress = document.querySelector<HTMLProgressElement>('progress[aria-label="Track progress"]')!;
      const samples = (window as unknown as { stemSamples(): number[] }).stemSamples;
      const peaks = [0, 0];
      while (progress.value < time + 110) {
        if (progress.value >= time + 30) {
          samples().forEach((level, index) => { peaks[index] = Math.max(peaks[index], level); });
        }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      return peaks;
    }, time);
    const [missBacking, missLead] = await audioAt(miss.timeMs);
    expect(missBacking).toBeGreaterThan(.003);
    expect(missLead).toBeLessThan(.0001);

    await page.waitForFunction(time => Number(document.querySelector('progress')?.value) >= time, hit.timeMs - 30);
    await page.keyboard.press(keys[hit.lanes[0]]);
    const [hitBacking, hitLead] = await audioAt(hit.timeMs);
    expect(hitBacking).toBeGreaterThan(.003);
    expect(hitLead).toBeGreaterThan(.003);
    await expect(page.getByText(/^Score (70|100)$/)).toBeVisible();
  } finally {
    if (server) await stop(server.child);
    await rm(data, { recursive: true, force: true });
  }
});

test('Number row scores a digit on the same song timing and stays outside duels', async ({ page }) => {
  test.skip(!!live, 'The test uses a bundled practice chart.');
  const data = await mkdtemp(join(tmpdir(), 'keyboard-practice-'));
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    server = await launch(data);
    const { url } = server;
    const { chart } = await (await page.request.get(url + '/api/songs/blacktop-sparks', { headers })).json() as { chart: Chart };
    await page.goto(url);
    await page.getByRole('checkbox', { name: 'Use practice keys in solo tracks' }).check();
    await page.getByRole('combobox', { name: 'Practice layout' }).selectOption('numbers');
    await page.getByRole('combobox', { name: 'Difficulty', exact: true }).selectOption('easy');
    await page.getByRole('button', { name: 'Play Blacktop Sparks' }).click();
    await expect(page.locator('.target kbd')).toHaveText('1234567890'.split(''));
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const note = chart.events.easy!.find(event => event.timeMs >= 850 && !event.durationMs)!;
    const key = await page.locator(`[data-note="${note.id}"] kbd`).textContent();
    expect(key).toMatch(/^\d$/);
    await page.waitForFunction(time => Number(document.querySelector('progress')?.value) >= time, note.timeMs - 32);
    await page.keyboard.press(key!);
    await expect(page.getByText(/^Score (70|100)$/)).toBeVisible();
    await page.getByRole('button', { name: 'Exit track' }).click();

    await page.getByRole('button', { name: 'Head-to-head' }).click();
    await page.getByRole('combobox', { name: /^Track/ }).selectOption('blacktop-sparks');
    await page.getByRole('button', { name: 'Create invite' }).click();
    await expect(page.locator('.target kbd')).toHaveText(['A', 'S', 'D', 'F', 'G']);
  } finally {
    if (server) await stop(server.child);
    await rm(data, { recursive: true, force: true });
  }
});
