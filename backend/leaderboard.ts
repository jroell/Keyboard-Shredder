import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDifficulty, notesFor } from '../shared/difficulty';
import { applyMods, finalScore, normalizeMods, windowFor } from '../shared/modifiers';
import { isFullCombo, starsFor } from '../shared/rating';
import { Scoring } from '../shared/scoring';
import type { Chart } from '../shared/song';

type Score = { score: number; rating: number; stars: number; combo: number; fullCombo: boolean };
type ScoreRow = Omit<Score, 'fullCombo'> & { uid: string; name: string; full_combo: number; created: number };
type ReplayResult = { ok: true; hits: number; misses: number } & Score | { ok: false; error: string };
type LaneInput = [lane: number, down: 0 | 1, timeMs: number];

export function replayRun(chart: Chart, input: { difficulty?: unknown; mods?: unknown; inputs?: unknown; boosts?: unknown }): ReplayResult {
  const { difficulty, inputs, boosts } = input;
  if (!isDifficulty(difficulty)) return { ok: false, error: 'Choose a valid difficulty.' };
  const mods = normalizeMods(input.mods);
  if (!Array.isArray(input.mods) || mods.length !== input.mods.length || mods.some((mod, i) => mod !== input.mods[i])) {
    return { ok: false, error: 'Choose valid modifiers in their listed order.' };
  }
  if (!Array.isArray(inputs) || inputs.length > 8000) return { ok: false, error: 'Send up to 8,000 key inputs.' };
  let lastTime = -Infinity;
  for (const entry of inputs) {
    if (!Array.isArray(entry) || entry.length !== 3) return { ok: false, error: 'Send valid key inputs.' };
    const [lane, down, time] = entry;
    if (!Number.isInteger(lane) || lane < 0 || lane > 4 || (down !== 0 && down !== 1) ||
        !Number.isFinite(time) || time < -500 || time > chart.durationMs + 1000 || time < lastTime) {
      return { ok: false, error: 'Send valid key inputs in time order.' };
    }
    lastTime = time;
  }
  if (!Array.isArray(boosts) || boosts.length > 100) return { ok: false, error: 'Send up to 100 boosts.' };
  lastTime = -Infinity;
  for (const time of boosts) {
    if (!Number.isFinite(time) || time < lastTime) return { ok: false, error: 'Send valid boosts in time order.' };
    lastTime = time;
  }

  const events = applyMods(notesFor(chart, difficulty), mods);
  const scoring = new Scoring(events, windowFor(difficulty, mods));
  let boost = 0;
  for (const [lane, down, time] of inputs as LaneInput[]) {
    while (boost < boosts.length && boosts[boost] <= time) scoring.activateBoost(boosts[boost++]);
    if (down) scoring.press(lane, time);
    else scoring.release(lane, time);
  }
  while (boost < boosts.length) scoring.activateBoost(boosts[boost++]);
  scoring.finish();

  if (!scoring.hits) return { ok: false, error: 'Hit at least one note to submit a score.' };
  if (mods.includes('sudden') && scoring.misses > 0) {
    return { ok: false, error: 'Finish without missing a note in Sudden death.' };
  }
  const tally = scoring.tally;
  return {
    ok: true, score: finalScore(scoring.score, mods), rating: scoring.rating, stars: starsFor(tally),
    combo: scoring.bestCombo, fullCombo: isFullCombo(tally), hits: scoring.hits, misses: scoring.misses,
  };
}

export function createLeaderboard() {
  const root = resolve(process.env.SONG_DATA_DIR || '.song-data');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(root, 'scores.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS scores (
      board TEXT NOT NULL, uid TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL,
      rating REAL NOT NULL, stars INTEGER NOT NULL, combo INTEGER NOT NULL, full_combo INTEGER NOT NULL,
      created INTEGER NOT NULL, PRIMARY KEY (board, uid)
    );
    CREATE INDEX IF NOT EXISTS scores_board_score ON scores (board, score DESC);
  `);

  const player = db.prepare('SELECT * FROM scores WHERE board = ? AND uid = ?');
  const place = db.prepare(`SELECT 1 + count(*) AS rank FROM scores WHERE board = ?
    AND (score > ? OR (score = ? AND created < ?))`);
  const ranked = db.prepare('SELECT * FROM scores WHERE board = ? ORDER BY score DESC, created ASC LIMIT ?');
  const count = db.prepare('SELECT count(*) AS total FROM scores WHERE board = ?');
  const save = db.prepare(`
    INSERT INTO scores (board, uid, name, score, rating, stars, combo, full_combo, created)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, max(?, coalesce(
      (SELECT max(created) + 1 FROM scores WHERE board = ? AND score = ?), 0)))
    ON CONFLICT(board, uid) DO UPDATE SET
      name = excluded.name, score = excluded.score, rating = excluded.rating, stars = excluded.stars,
      combo = excluded.combo, full_combo = excluded.full_combo, created = excluded.created
  `);
  const rename = db.prepare('UPDATE scores SET name = ? WHERE board = ? AND uid = ?');

  function rank(board: string, row: ScoreRow) {
    return Number(place.get(board, row.score, row.score, row.created)!.rank);
  }

  return {
    submit(board: string, uid: string, name: string, result: Score) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = player.get(board, uid) as ScoreRow | undefined;
        const previous = existing?.score ?? null;
        const best = previous === null || result.score > previous;
        if (best) {
          save.run(board, uid, name, result.score, result.rating, result.stars, result.combo,
            Number(result.fullCombo), Date.now(), board, result.score);
        } else {
          rename.run(name, board, uid);
        }
        const row = player.get(board, uid) as ScoreRow;
        const position = rank(board, row);
        db.exec('COMMIT');
        return { rank: position, best, previous };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    top(board: string, uid: string, limit = 20) {
      const entries = (ranked.all(board, limit) as ScoreRow[]).map((row, i) => ({
        rank: i + 1, name: row.name, score: row.score, rating: row.rating, stars: row.stars,
        combo: row.combo, fullCombo: row.full_combo === 1, you: row.uid === uid,
      }));
      const row = player.get(board, uid) as ScoreRow | undefined;
      return {
        entries,
        you: row ? { rank: rank(board, row), score: row.score } : null,
        total: Number(count.get(board)!.total),
      };
    },

    /** Ranks players by the sum of their best scores across several boards. Only players with a score on every board count. */
    combined(boards: string[], uid: string, limit = 20) {
      if (!boards.length) return { entries: [], you: null, total: 0 };
      const marks = boards.map(() => '?').join(', ');
      const rows = db.prepare(`SELECT uid, max(name) AS name, sum(score) AS score, max(created) AS created FROM scores
        WHERE board IN (${marks}) GROUP BY uid HAVING count(*) = ? ORDER BY score DESC, created ASC`).all(...boards, boards.length) as
        { uid: string; name: string; score: number; created: number }[];
      const mine = rows.findIndex(row => row.uid === uid);
      return {
        entries: rows.slice(0, limit).map((row, index) => ({ rank: index + 1, name: row.name, score: row.score, you: row.uid === uid })),
        you: mine >= 0 ? { rank: mine + 1, score: rows[mine].score } : null,
        total: rows.length,
      };
    },
  };
}
