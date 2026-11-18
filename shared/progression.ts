import { modMultiplier } from './modifiers';
import type { ModId } from './modifiers';
import type { Grade } from './rating';
import type { Difficulty } from './song';
import { TOUR_TRACKS, TOUR_VENUES } from './tour';

export type RunMode = 'quickplay' | 'tour' | 'typing' | 'daily' | 'party' | 'versus' | 'coop' | 'tutorial' | 'challenge';

export type RunSummary = {
  songId: string;
  mode: RunMode;
  difficulty: Difficulty;
  mods: ModId[];
  score: number;
  rating: number;
  stars: number;
  grade: Grade;
  perfects: number;
  greats: number;
  goods: number;
  misses: number;
  wrongKeys: number;
  totalNotes: number;
  bestCombo: number;
  fullCombo: boolean;
  failed: boolean;
  boostsUsed: number;
  durationMs: number;
  wpm?: number;
  won?: boolean;
  lessonId?: string;
  genre?: string;
};

export type SongRecord = {
  score: number;
  stars: number;
  grade: Grade;
  rating: number;
  fullCombo: boolean;
  plays: number;
  bestCombo: number;
};

export type SaveData = {
  version: 1;
  xp: number;
  name: string;
  totals: {
    plays: number;
    notesHit: number;
    perfects: number;
    fullCombos: number;
    fails: number;
    playMs: number;
    bestCombo: number;
    wins: number;
    dailies: number;
    partyGames: number;
    coopClears: number;
    bestWpm: number;
  };
  records: Record<string, SongRecord>;
  achievements: Record<string, number>;
  equipped: { highway: string; gem: string; fx: string };
  streak: { days: number; best: number; lastDay: string };
  daily: Record<string, { score: number; stars: number }>;
  genres: string[];
  seenTutorial: boolean;
};

export function recordKey(songId: string, difficulty: Difficulty): string {
  return `${songId}:${difficulty}`;
}

export function emptySave(): SaveData {
  return {
    version: 1,
    xp: 0,
    name: '',
    totals: {
      plays: 0, notesHit: 0, perfects: 0, fullCombos: 0, fails: 0, playMs: 0,
      bestCombo: 0, wins: 0, dailies: 0, partyGames: 0, coopClears: 0, bestWpm: 0,
    },
    records: {},
    achievements: {},
    equipped: { highway: 'classic', gem: 'classic', fx: 'sparks' },
    streak: { days: 0, best: 0, lastDay: '' },
    daily: {},
    genres: [],
    seenTutorial: false,
  };
}

const MILLISECONDS_PER_DAY = 86_400_000;
const GRADES: readonly Grade[] = ['S+', 'S', 'A', 'B', 'C', 'D', 'F'];
const DIFFICULTY_FACTOR: Record<Difficulty, number> = {
  beginner: 1, easy: 1.25, medium: 1.6, hard: 2, expert: 2.5,
};

function dateValue(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key
    ? date.getTime()
    : NaN;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function nonnegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function newestDailyResults(daily: SaveData['daily']): SaveData['daily'] {
  const latest = Object.keys(daily).sort().slice(-60);
  return Object.fromEntries(latest.map(key => [key, daily[key]]));
}

export function normalizeSave(value: unknown): SaveData {
  const save = emptySave();
  try {
    if (!isObject(value)) return save;

    save.xp = nonnegative(value.xp);
    if (typeof value.name === 'string') save.name = value.name;
    save.seenTutorial = value.seenTutorial === true;

    const totals = objectOrEmpty(value.totals);
    for (const key of Object.keys(save.totals) as (keyof SaveData['totals'])[]) {
      save.totals[key] = nonnegative(totals[key]);
    }

    const streak = objectOrEmpty(value.streak);
    save.streak = {
      days: nonnegative(streak.days),
      best: nonnegative(streak.best),
      lastDay: typeof streak.lastDay === 'string' && Number.isFinite(dateValue(streak.lastDay))
        ? streak.lastDay
        : '',
    };

    const equipped = objectOrEmpty(value.equipped);
    for (const kind of Object.keys(save.equipped) as UnlockKind[]) {
      const selected = equipped[kind];
      if (typeof selected === 'string' && isUnlocked(kind, selected, MAX_LEVEL)) {
        save.equipped[kind] = selected;
      }
    }

    if (Array.isArray(value.genres)) {
      save.genres = [...new Set(value.genres.filter(
        (genre: unknown): genre is string => typeof genre === 'string' && genre.trim().length > 0,
      ))];
    }

    const records: [string, SongRecord][] = [];
    for (const [key, entry] of Object.entries(objectOrEmpty(value.records))) {
      const difficulty = key.slice(key.lastIndexOf(':') + 1);
      if (!key.includes(':') || !Object.hasOwn(DIFFICULTY_FACTOR, difficulty) || !isObject(entry)) continue;
      records.push([key, {
        score: nonnegative(entry.score),
        stars: Math.min(6, nonnegative(entry.stars)),
        grade: GRADES.find(grade => grade === entry.grade) ?? 'F',
        rating: Math.min(100, nonnegative(entry.rating)),
        fullCombo: entry.fullCombo === true,
        plays: nonnegative(entry.plays),
        bestCombo: nonnegative(entry.bestCombo),
      }]);
    }
    save.records = Object.fromEntries(records);

    const achievements: [string, number][] = [];
    for (const [id, timestamp] of Object.entries(objectOrEmpty(value.achievements))) {
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        achievements.push([id, nonnegative(timestamp)]);
      }
    }
    save.achievements = Object.fromEntries(achievements);

    const daily: [string, SaveData['daily'][string]][] = [];
    for (const [key, entry] of Object.entries(objectOrEmpty(value.daily))) {
      if (!Number.isFinite(dateValue(key)) || !isObject(entry)) continue;
      daily.push([key, { score: nonnegative(entry.score), stars: Math.min(6, nonnegative(entry.stars)) }]);
    }
    save.daily = newestDailyResults(Object.fromEntries(daily));
    return save;
  } catch {
    return emptySave();
  }
}

export const MAX_LEVEL = 50;

const TITLES = [
  'Garage rookie', 'Opening act', 'Club regular', 'Riff dealer', 'Headliner',
  'Shred captain', 'Arena ace', 'Fretboard wizard', 'Rock royalty', 'Living legend', 'Keyboard shredder',
];

export function levelFor(xp: number): { level: number; title: string; current: number; needed: number; progress: number } {
  let current = xp === Infinity ? Infinity : nonnegative(xp);
  let level = 1;
  let needed = 300;
  while (level < MAX_LEVEL && current >= needed) {
    current -= needed;
    level++;
    needed += 120;
  }
  return {
    level,
    title: TITLES[Math.floor(level / 5)],
    current,
    needed: level === MAX_LEVEL ? 0 : needed,
    progress: level === MAX_LEVEL ? 1 : current / needed,
  };
}

export type XpContext = { firstClear: boolean; newBest: boolean; firstRunToday: boolean; streakDays: number };
type XpPart = { label: string; xp: number };
type XpAward = { total: number; parts: XpPart[] };

function notesHit(run: RunSummary) {
  return run.perfects + run.greats + run.goods;
}

export function xpForRun(run: RunSummary, context: XpContext): XpAward {
  const hitXp = Math.round(notesHit(run) * DIFFICULTY_FACTOR[run.difficulty] * modMultiplier(run.mods));
  const parts: XpPart[] = [];

  if (run.failed) {
    parts.push({ label: 'Notes hit', xp: Math.round(hitXp * 0.4) });
  } else if (run.mode === 'tutorial') {
    parts.push({ label: 'Warm-up complete', xp: 300 });
  } else {
    parts.push({ label: 'Notes hit', xp: hitXp }, { label: 'Stars', xp: run.stars * 20 });
    if (run.fullCombo) parts.push({ label: 'Full combo', xp: 100 });
    if (context.firstClear) parts.push({ label: 'First time finishing this song', xp: 75 });
    else if (context.newBest) parts.push({ label: 'New best', xp: 40 });
    if (context.firstRunToday) parts.push({ label: 'Day streak', xp: Math.min(context.streakDays, 7) * 15 });
    if (run.won) parts.push({ label: 'Win', xp: 60 });
  }

  return {
    total: parts.reduce((total, part) => total + part.xp, 0),
    parts: parts.filter(part => part.xp !== 0),
  };
}

export type UnlockKind = 'highway' | 'gem' | 'fx';
export type Unlock = { id: string; kind: UnlockKind; name: string; blurb: string; level: number };

export const UNLOCKS: readonly Unlock[] = [
  { id: 'classic', kind: 'highway', name: 'Rosewood', blurb: 'Play on a rosewood fretboard.', level: 1 },
  { id: 'neon', kind: 'highway', name: 'Neon grid', blurb: 'Light the lanes with a neon grid.', level: 3 },
  { id: 'lava', kind: 'highway', name: 'Molten', blurb: 'Play over glowing lava.', level: 7 },
  { id: 'ice', kind: 'highway', name: 'Glacier', blurb: 'Play on a fretboard cut from ice.', level: 11 },
  { id: 'synthwave', kind: 'highway', name: 'Sunset drive', blurb: 'Play against a pink and orange sunset.', level: 15 },
  { id: 'void', kind: 'highway', name: 'Deep space', blurb: 'Play against a field of stars.', level: 20 },
  { id: 'gold', kind: 'highway', name: 'Solid gold', blurb: 'Play on a polished gold fretboard.', level: 30 },
  { id: 'classic', kind: 'gem', name: 'Classic', blurb: 'Play with the original note gems.', level: 1 },
  { id: 'round', kind: 'gem', name: 'Arcade buttons', blurb: 'Turn note gems into round arcade buttons.', level: 2 },
  { id: 'star', kind: 'gem', name: 'Stars', blurb: 'Turn note gems into stars.', level: 5 },
  { id: 'pixel', kind: 'gem', name: '8-bit', blurb: 'Play with pixel art note gems.', level: 9 },
  { id: 'skull', kind: 'gem', name: 'Skulls', blurb: 'Turn note gems into skulls.', level: 13 },
  { id: 'heart', kind: 'gem', name: 'Hearts', blurb: 'Turn note gems into hearts.', level: 17 },
  { id: 'bolt', kind: 'gem', name: 'Bolts', blurb: 'Turn note gems into lightning bolts.', level: 22 },
  { id: 'diamond', kind: 'gem', name: 'Diamonds', blurb: 'Play with diamond-shaped note gems.', level: 27 },
  { id: 'sparks', kind: 'fx', name: 'Sparks', blurb: 'Scatter sparks when you hit a note.', level: 1 },
  { id: 'flames', kind: 'fx', name: 'Flames', blurb: 'Send up flames when you hit a note.', level: 4 },
  { id: 'lightning', kind: 'fx', name: 'Lightning', blurb: 'Flash lightning when you hit a note.', level: 8 },
  { id: 'confetti', kind: 'fx', name: 'Confetti', blurb: 'Scatter confetti when you hit a note.', level: 12 },
  { id: 'notes', kind: 'fx', name: 'Music notes', blurb: 'Release floating music notes with each hit.', level: 16 },
  { id: 'pixels', kind: 'fx', name: 'Pixel burst', blurb: 'Scatter pixels when you hit a note.', level: 24 },
];

export function unlocksAt(level: number): Unlock[] {
  return UNLOCKS.filter(unlock => unlock.level === level);
}

export function isUnlocked(kind: UnlockKind, id: string, level: number): boolean {
  return UNLOCKS.some(unlock => unlock.kind === kind && unlock.id === id && unlock.level <= level);
}

export type Achievement = { id: string; name: string; blurb: string; secret?: boolean; xp: number };

const ACHIEVEMENT_LIST = [
  { id: 'first-gig', name: 'First gig', blurb: 'Finish your first song.', xp: 25 },
  { id: 'full-combo', name: 'Flawless run', blurb: 'Finish a song without missing a note.', xp: 50 },
  { id: 'combo-50', name: '50-note combo', blurb: 'Reach a 50-note combo.', xp: 25 },
  { id: 'combo-100', name: '100-note combo', blurb: 'Reach a 100-note combo.', xp: 50 },
  { id: 'combo-250', name: '250-note combo', blurb: 'Reach a 250-note combo.', xp: 100 },
  { id: 'combo-500', name: '500-note combo', blurb: 'Reach a 500-note combo.', xp: 200 },
  { id: 'five-stars', name: 'Five stars', blurb: 'Earn at least five stars on a song.', xp: 50 },
  { id: 'gold-star', name: 'Gold star', blurb: 'Earn six stars on a song.', xp: 150 },
  { id: 's-rank', name: 'S rank', blurb: 'Earn an S or S+ grade on a song.', xp: 50 },
  { id: 'perfectionist', name: 'Perfectionist', blurb: 'Get a perfect hit on every note in a song with at least 30 notes.', xp: 200 },
  { id: 'expert-clear', name: 'Expert clear', blurb: 'Finish a song on expert difficulty.', xp: 100 },
  { id: 'hard-clear', name: 'Hard clear', blurb: 'Finish a song on hard difficulty.', xp: 75 },
  { id: 'sudden-death', name: 'Sudden death', blurb: 'Finish a song with the Sudden death modifier.', xp: 75 },
  { id: 'mod-stack', name: 'Three modifiers', blurb: 'Finish a song with at least three modifiers active.', xp: 75 },
  { id: 'notes-1000', name: '1,000 notes', blurb: 'Hit 1,000 notes across all runs.', xp: 50 },
  { id: 'notes-10000', name: '10,000 notes', blurb: 'Hit 10,000 notes across all runs.', xp: 200 },
  { id: 'perfects-1000', name: '1,000 perfect hits', blurb: 'Land 1,000 perfect hits across all runs.', xp: 100 },
  { id: 'streak-3', name: 'Three-day streak', blurb: 'Play on three consecutive days.', xp: 50 },
  { id: 'streak-7', name: 'Seven-day streak', blurb: 'Play on seven consecutive days.', xp: 100 },
  { id: 'streak-30', name: '30-day streak', blurb: 'Play on 30 consecutive days.', xp: 300 },
  { id: 'daily-first', name: 'First daily challenge', blurb: 'Complete your first daily challenge.', xp: 50 },
  { id: 'daily-5', name: 'Five daily challenges', blurb: 'Complete five different daily challenges.', xp: 100 },
  { id: 'genres-5', name: 'Five genres', blurb: 'Play songs from five different genres.', xp: 50 },
  { id: 'genres-10', name: 'Ten genres', blurb: 'Play songs from ten different genres.', xp: 100 },
  { id: 'tour-first-venue', name: 'First venue', blurb: 'Clear all four songs at the first tour venue.', xp: 75 },
  { id: 'tour-complete', name: 'Tour complete', blurb: 'Clear every song on the tour.', xp: 300 },
  { id: 'typing-20-wpm', name: '20 words per minute', blurb: 'Reach 20 words per minute while typing.', xp: 25 },
  { id: 'typing-40-wpm', name: '40 words per minute', blurb: 'Reach 40 words per minute while typing.', xp: 50 },
  { id: 'typing-60-wpm', name: '60 words per minute', blurb: 'Reach 60 words per minute while typing.', xp: 100 },
  { id: 'home-row-hero', name: 'Home row hero', blurb: 'Pass six typing lessons.', xp: 50 },
  { id: 'academy-graduate', name: 'Academy graduate', blurb: 'Pass 20 typing lessons.', xp: 150 },
  { id: 'party-starter', name: 'Party starter', blurb: 'Play your first party game.', xp: 25 },
  { id: 'duel-winner', name: 'Duel winner', blurb: 'Win your first versus match.', xp: 50 },
  { id: 'coop-clear', name: 'Co-op clear', blurb: 'Finish a co-op song.', xp: 50 },
  { id: 'stars-50', name: '50 stars', blurb: 'Collect 50 stars across song records, counting up to five per record.', xp: 100 },
  { id: 'stars-150', name: '150 stars', blurb: 'Collect 150 stars across song records, counting up to five per record.', xp: 250 },
  { id: 'comeback', name: 'Comeback', blurb: 'Earn at least four stars on hard or expert after missing at least ten notes.', secret: true, xp: 150 },
  { id: 'night-owl', name: 'Night owl', blurb: 'Finish a song between midnight and 4:59 a.m.', secret: true, xp: 50 },
  { id: 'marathon', name: 'Marathon', blurb: 'Play for at least three hours in total.', xp: 150 },
  { id: 'level-10', name: 'Level 10', blurb: 'Reach level 10.', xp: 75 },
  { id: 'level-25', name: 'Level 25', blurb: 'Reach level 25.', xp: 150 },
  { id: 'level-50', name: 'Level 50', blurb: 'Reach level 50.', xp: 300 },
] as const satisfies readonly Achievement[];

export const ACHIEVEMENTS: readonly Achievement[] = ACHIEVEMENT_LIST;
type AchievementId = (typeof ACHIEVEMENT_LIST)[number]['id'];

export type RunExtra = { dateKey: string; hour: number; tourCleared?: number; lessonsPassed?: number; dailyKey?: string };

export type RunOutcome = {
  save: SaveData;
  xp: XpAward;
  levelBefore: number;
  levelAfter: number;
  unlocked: Unlock[];
  achievements: Achievement[];
  newBest: boolean;
  firstClear: boolean;
  previousBest: number;
  streak: { days: number; extended: boolean };
};

const RECORD_MODES: readonly RunMode[] = ['quickplay', 'tour', 'daily', 'challenge'];

function awardAchievements(save: SaveData, run: RunSummary, now: number, extra: RunExtra, xp: XpAward) {
  const { totals } = save;
  const clearedSong = !run.failed && run.mode !== 'tutorial' && run.mode !== 'typing';
  const stars = Object.values(save.records).reduce((total, record) => total + Math.min(record.stars, 5), 0);
  const tourCleared = extra.tourCleared ?? 0;
  const lessonsPassed = extra.lessonsPassed ?? 0;
  const requirements: Record<AchievementId, boolean | number> = {
    'first-gig': clearedSong,
    'full-combo': !run.failed && run.fullCombo,
    'combo-50': totals.bestCombo >= 50,
    'combo-100': totals.bestCombo >= 100,
    'combo-250': totals.bestCombo >= 250,
    'combo-500': totals.bestCombo >= 500,
    'five-stars': clearedSong && run.stars >= 5,
    'gold-star': clearedSong && run.stars === 6,
    's-rank': clearedSong && (run.grade === 'S' || run.grade === 'S+'),
    'perfectionist': clearedSong && run.totalNotes >= 30 && run.perfects === run.totalNotes,
    'expert-clear': clearedSong && run.difficulty === 'expert',
    'hard-clear': clearedSong && run.difficulty === 'hard',
    'sudden-death': clearedSong && run.mods.includes('sudden'),
    'mod-stack': clearedSong && run.mods.length >= 3,
    'notes-1000': totals.notesHit >= 1000,
    'notes-10000': totals.notesHit >= 10000,
    'perfects-1000': totals.perfects >= 1000,
    'streak-3': save.streak.best >= 3,
    'streak-7': save.streak.best >= 7,
    'streak-30': save.streak.best >= 30,
    'daily-first': totals.dailies >= 1,
    'daily-5': totals.dailies >= 5,
    'genres-5': save.genres.length >= 5,
    'genres-10': save.genres.length >= 10,
    'tour-first-venue': tourCleared >= TOUR_VENUES[0].tracks.length,
    'tour-complete': tourCleared >= TOUR_TRACKS.length,
    'typing-20-wpm': totals.bestWpm >= 20,
    'typing-40-wpm': totals.bestWpm >= 40,
    'typing-60-wpm': totals.bestWpm >= 60,
    'home-row-hero': lessonsPassed >= 6,
    'academy-graduate': lessonsPassed >= 20,
    'party-starter': totals.partyGames >= 1,
    'duel-winner': run.mode === 'versus' && run.won === true,
    'coop-clear': totals.coopClears >= 1,
    'stars-50': stars >= 50,
    'stars-150': stars >= 150,
    'comeback': clearedSong && (run.difficulty === 'hard' || run.difficulty === 'expert') && run.misses >= 10 && run.stars >= 4,
    'night-owl': clearedSong && extra.hour >= 0 && extra.hour <= 4,
    'marathon': totals.playMs >= 3 * 60 * 60 * 1000,
    'level-10': 10,
    'level-25': 25,
    'level-50': 50,
  };

  const awarded: Achievement[] = [];
  for (const achievement of ACHIEVEMENT_LIST) {
    if (Object.hasOwn(save.achievements, achievement.id)) continue;
    // Check level achievements last so XP from earlier awards can unlock them on this run.
    const requirement = requirements[achievement.id];
    const qualifies = typeof requirement === 'number'
      ? levelFor(save.xp + xp.total).level >= requirement
      : requirement;
    if (!qualifies) continue;

    save.achievements[achievement.id] = now;
    awarded.push(achievement);
    xp.parts.push({ label: achievement.name, xp: achievement.xp });
    xp.total += achievement.xp;
  }
  return awarded;
}

export function applyRun(save: SaveData, run: RunSummary, now: number, extra: RunExtra): RunOutcome {
  const { level: levelBefore } = levelFor(save.xp);
  const key = recordKey(run.songId, run.difficulty);
  const recordsSong = RECORD_MODES.includes(run.mode);
  const previous = recordsSong ? save.records[key] : undefined;
  const canSetRecord = recordsSong && !run.failed;
  const firstClear = canSetRecord && !previous;
  const newBest = canSetRecord && (!previous || run.score > previous.score);
  const previousBest = previous?.score ?? 0;
  const records = { ...save.records };
  const best = newBest ? run : previous;
  if (best) {
    records[key] = {
      score: best.score,
      stars: best.stars,
      grade: best.grade,
      rating: best.rating,
      fullCombo: (previous?.fullCombo ?? false) || run.fullCombo,
      plays: (previous?.plays ?? 0) + 1,
      bestCombo: Math.max(previous?.bestCombo ?? 0, run.bestCombo),
    };
  }

  const firstRunToday = extra.dateKey !== save.streak.lastDay;
  let streak = { ...save.streak };
  if (firstRunToday) {
    const consecutive = dateValue(extra.dateKey) - dateValue(streak.lastDay) === MILLISECONDS_PER_DAY;
    const days = consecutive ? streak.days + 1 : 1;
    streak = { days, best: Math.max(streak.best, days), lastDay: extra.dateKey };
  }

  const dailyKey = run.mode === 'daily' && !run.failed ? extra.dailyKey : undefined;
  const firstDailyClear = dailyKey !== undefined && !Object.hasOwn(save.daily, dailyKey);
  let daily = { ...save.daily };
  if (dailyKey !== undefined && (firstDailyClear || run.score > daily[dailyKey].score)) {
    daily = newestDailyResults({
      ...daily,
      [dailyKey]: { score: run.score, stars: run.stars },
    });
  }

  const totals = save.totals;
  const updated: SaveData = {
    ...save,
    totals: {
      plays: totals.plays + 1,
      notesHit: totals.notesHit + notesHit(run),
      perfects: totals.perfects + run.perfects,
      fullCombos: totals.fullCombos + Number(run.fullCombo && !run.failed),
      fails: totals.fails + Number(run.failed),
      playMs: totals.playMs + run.durationMs,
      bestCombo: Math.max(totals.bestCombo, run.bestCombo),
      wins: totals.wins + Number(run.won === true),
      dailies: totals.dailies + Number(firstDailyClear),
      partyGames: totals.partyGames + Number(run.mode === 'party'),
      coopClears: totals.coopClears + Number(run.mode === 'coop' && !run.failed),
      bestWpm: Math.max(totals.bestWpm, run.wpm ?? 0),
    },
    records,
    achievements: { ...save.achievements },
    streak,
    daily,
    genres: run.genre && !save.genres.includes(run.genre) ? [...save.genres, run.genre] : [...save.genres],
    seenTutorial: save.seenTutorial || (run.mode === 'tutorial' && !run.failed),
  };

  const xp = xpForRun(run, { firstClear, newBest, firstRunToday, streakDays: streak.days });
  if (firstDailyClear) {
    xp.parts.push({ label: 'Daily challenge', xp: 150 });
    xp.total += 150;
  }
  const achievements = awardAchievements(updated, run, now, extra, xp);
  updated.xp += xp.total;
  const { level: levelAfter } = levelFor(updated.xp);

  return {
    save: updated,
    xp,
    levelBefore,
    levelAfter,
    unlocked: UNLOCKS.filter(unlock => unlock.level > levelBefore && unlock.level <= levelAfter),
    achievements,
    newBest,
    firstClear,
    previousBest,
    streak: { days: streak.days, extended: streak.days !== save.streak.days },
  };
}
