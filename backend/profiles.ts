import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { avatars, badgeNames, palettes, type Badge, type Profile } from '../shared/duel';

type Totals = { played: number; wins: number; precision: number; streak: number };

export function createProfileStore() {
  const root = resolve(process.env.SONG_DATA_DIR || '.song-data');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(root, 'profiles.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS profiles (uid TEXT PRIMARY KEY, options TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS duel_results (
      id TEXT NOT NULL, uid TEXT NOT NULL, win INTEGER NOT NULL, accuracy INTEGER NOT NULL,
      combo INTEGER NOT NULL, hits INTEGER NOT NULL, PRIMARY KEY (id, uid)
    );
    CREATE INDEX IF NOT EXISTS duel_results_uid ON duel_results(uid);
  `);

  function get(uid: string): Profile {
    const row = db.prepare('SELECT options FROM profiles WHERE uid=?').get(uid);
    const totals = db.prepare(`SELECT count(*) AS played, coalesce(sum(win), 0) AS wins,
      coalesce(max(accuracy * (hits > 0)), 0) AS precision, coalesce(max(combo), 0) AS streak
      FROM duel_results WHERE uid=?`).get(uid) as Totals;
    const earned = {
      debut: totals.played >= 1, winner: totals.wins >= 1, precision: totals.precision >= 95,
      streak: totals.streak >= 25, veteran: totals.played >= 10,
    };
    const badges = (Object.keys(badgeNames) as Badge[]).filter(key => earned[key]);
    const options = row ? JSON.parse(String(row.options)) : { name: 'Guitarist', avatar: 'Guitar', palette: 'Sunset', speed: 1900, badge: null };
    return { ...options, badges, played: totals.played, wins: totals.wins };
  }

  return {
    get,
    save(uid: string, input: Partial<Profile> | null) {
      const current = get(uid);
      if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 24 ||
          /[\p{Cc}\p{Cf}]/u.test(input.name) || !avatars.includes(input.avatar!) ||
          !Object.hasOwn(palettes, input.palette ?? '') || ![1450, 1900, 2400].includes(input.speed!) ||
          (input.badge !== null && !current.badges.includes(input.badge!))) return undefined;
      const { avatar, palette, speed, badge } = input;
      const options = { name: input.name.trim(), avatar, palette, speed, badge };
      db.prepare('INSERT INTO profiles VALUES (?, ?) ON CONFLICT(uid) DO UPDATE SET options=excluded.options').run(uid, JSON.stringify(options));
      return get(uid);
    },
    record(id: string, results: Array<{ uid: string; win: boolean; accuracy: number; bestCombo: number; hits: number }>) {
      const insert = db.prepare('INSERT OR IGNORE INTO duel_results VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      try {
        for (const result of results) insert.run(id, result.uid, Number(result.win), result.accuracy, result.bestCombo, result.hits);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
