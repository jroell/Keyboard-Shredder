import { expect, type Page } from '@playwright/test';
import type { SessionState } from '../../src/game/session';
import type { SongEvent } from '../../shared/song';

type PlayerOptions = {
  player?: number;
  accuracy?: number;
  offsetMs?: number;
  until?: number;
  from?: number;
  hold?: boolean;
};

export type ShredderWindow = Window & {
  __shredder?: {
    session: {
      state: SessionState;
      counting: boolean;
      wait: boolean;
      rawTime(): number;
      time(): number;
      scorings: {
        boostsUsed: number;
        combo: number;
        score: number;
        misses: number;
        hitOffsets: Map<string, number>;
      }[];
    };
    chart: { durationMs: number };
    players: { events: SongEvent[]; keys: string[] }[];
  };
};

export async function waitForState(page: Page, state: SessionState, timeoutMs = 30_000) {
  await expect.poll(
    () => page.evaluate(() => (window as ShredderWindow).__shredder?.session.state),
    { timeout: timeoutMs, message: `The game session should be ${state}` },
  ).toBe(state);
}

export async function chartTime(page: Page) {
  return page.evaluate(() => (window as ShredderWindow).__shredder!.session.time());
}

// Call after the stage opens, for example: await playSong(page, { accuracy: 0.5, until: 12_000 });
export async function playSong(page: Page, options: PlayerOptions = {}) {
  const { player = 0, accuracy = 1, offsetMs = 0, until, from = 0, hold = true } = options;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) {
    throw new RangeError('Accuracy must be between 0 and 1.');
  }
  await page.evaluate(({ player, accuracy, offsetMs, until, from, hold }) => {
    const { session, players, chart } = (window as ShredderWindow).__shredder!;
    const { events, keys } = players[player];
    const releases = new Map<string, number>();
    const deadline = performance.now() + chart.durationMs * 2 + 15_000;
    let index = from;
    const send = (type: 'keydown' | 'keyup', laneKey: string) => {
      const shiftKey = laneKey.startsWith('Shift+');
      const code = shiftKey ? laneKey.slice('Shift+'.length) : laneKey;
      window.dispatchEvent(new KeyboardEvent(type, { code, shiftKey, bubbles: true }));
    };

    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        for (const code of releases.keys()) send('keyup', code);
        resolve();
      };
      const frame = () => {
        if (session.state === 'finished' || session.state === 'failed') return finish();
        if ((window as ShredderWindow).__shredder?.session !== session) {
          return reject(new Error(`Player ${player + 1}'s session changed at ${session.time()} ms.`));
        }
        if (performance.now() > deadline) {
          return reject(new Error(`Player ${player + 1} stopped at ${session.time()} ms (${session.state}).`));
        }
        if (session.state !== 'playing' || session.counting) {
          requestAnimationFrame(frame);
          return;
        }
        const now = session.time();
        for (const [code, end] of releases) {
          if (now < end) continue;
          send('keyup', code);
          releases.delete(code);
        }
        if (until !== undefined && now > until) return finish();
        const aim = session.wait ? offsetMs : offsetMs - 8;
        while (index < events.length && events[index].timeMs + aim <= now) {
          const note = events[index++];
          if (Math.floor(index * accuracy) === Math.floor((index - 1) * accuracy)) continue;
          if (note.timeMs + offsetMs < now - 100) continue;
          for (const lane of note.lanes) {
            const code = keys[lane];
            if (releases.has(code)) send('keyup', code);
            send('keydown', code);
            releases.set(code, hold && note.durationMs ? note.timeMs + note.durationMs : now + 40);
          }
        }
        if (until === undefined && index === events.length && releases.size === 0) return finish();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, { player, accuracy, offsetMs, until, from, hold });
}
