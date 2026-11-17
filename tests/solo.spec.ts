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
    await page.getByLabel('Length').selectOption(String(live || 30));
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
    await expect(play).toBeVisible();
    const { chart, song } = await (await page.request.get(`${url}/api/songs/${job.id}`, { headers })).json() as { chart: Chart; song: Song };
    expect(song.model).toBe(live ? 'music_v2_5' : 'fixture');
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
      await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
      const progress = page.getByRole('progressbar', { name: 'Track progress' });
      const pausedAt = await progress.getAttribute('value');
      await expect(progress).toHaveAttribute('value', pausedAt!);
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Track complete' })).toBeVisible({ timeout: chart.durationMs + 5000 });

    const foreign = { Authorization: 'Bearer test-stranger' };
    for (const endpoint of [`/api/songs/${job.id}`, `/api/songs/${job.id}/audio`, `/api/generations/${job.id}`]) {
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
  for (const event of chart.events.normal.filter(event => event.timeMs >= 400).slice(0, 8)) {
    await progress.evaluate((element, threshold) => new Promise<void>((resolve, reject) => {
      const deadline = performance.now() + 20_000;
      const wait = () => {
        if ((element as HTMLProgressElement).value >= threshold) resolve();
        else if (performance.now() > deadline) reject(new Error('Playback did not advance.'));
        else requestAnimationFrame(wait);
      };
      wait();
    }), event.timeMs - 30);
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
    await page.getByLabel('Length').selectOption('30');
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
