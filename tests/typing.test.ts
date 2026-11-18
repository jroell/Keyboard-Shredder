import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { notesFor } from '../shared/difficulty';
import type { Chart, Difficulty } from '../shared/song';
import {
  ALL_TYPING_KEYS, SENTENCES, TYPING_LESSONS, WORDS, buildTypingChart, charFor, codeFor,
  keyInfo, lessonStatus, mergeKeyStats, typingStars, weakestKeys, wpm,
} from '../shared/typing';
import type { KeyStats, TypingOptions } from '../shared/typing';

const chart: Chart = JSON.parse(readFileSync(new URL('../catalog/river-amp/chart.json', import.meta.url), 'utf8'));
const songIds = new Set([
  'river-amp', 'marigold-run', 'orange-pocket', 'arc-lights', 'mirrorball-static', 'redline-radio',
  'umbra-samba', 'neon-afterhours', 'salt-motor', 'southbound-61', 'paper-antenna', 'blacktop-sparks',
  'midnight-switch', 'midnight-toll', 'glass-circuit', 'signal-coast', 'copper-moon', 'voltage-parade',
]);

test('Every lesson has a unique ID, a catalog song, and all the keys it introduces.', () => {
  assert.equal(new Set(TYPING_LESSONS.map(lesson => lesson.id)).size, TYPING_LESSONS.length);
  for (const lesson of TYPING_LESSONS) {
    assert.ok(songIds.has(lesson.songId), lesson.id);
    assert.ok(lesson.newKeys.every(code => lesson.keys.includes(code)), lesson.id);
  }
});

test('Every lesson maps its text and groups to sequential notes and valid keyboard lanes.', () => {
  for (const lesson of TYPING_LESSONS) {
    const result = buildTypingChart(chart, { ...lesson, seed: 42 });
    assert.ok(result.events.length > 0, lesson.id);
    assert.equal(result.text.length, result.events.length, lesson.id);
    assert.doesNotMatch(result.text, /^ | $| {2}/, lesson.id);
    assert.deepEqual(result.keys, ALL_TYPING_KEYS.filter(code => result.text.includes(charFor(code))));
    const covered = new Set<number>();
    for (const { text, first, last } of result.words) {
      assert.equal(text, result.text.slice(first, last + 1));
      assert.doesNotMatch(text, / /);
      for (let index = first; index <= last; index++) {
        assert.ok(!covered.has(index));
        covered.add(index);
      }
    }
    result.events.forEach((event, index) => {
      assert.equal(event.id, `type-${index}`);
      assert.equal(event.durationMs, 0);
      assert.equal(event.lanes.length, 1);
      assert.ok(event.lanes[0] >= 0 && event.lanes[0] < result.keys.length);
      assert.equal(charFor(result.keys[event.lanes[0]]), result.text[index]);
      assert.equal(covered.has(index), result.text[index] !== ' ');
      if (index > 0) assert.ok(event.timeMs > result.events[index - 1].timeMs);
    });
  }
});

test('The same seed produces the same chart and another seed changes the text.', () => {
  const options = { ...TYPING_LESSONS[0], seed: 42 };
  const first = buildTypingChart(chart, options);
  assert.deepEqual(buildTypingChart(chart, options), first);
  assert.notEqual(buildTypingChart(chart, { ...options, seed: 43 }).text, first.text);
});

test('The home row words lesson uses only home row letters and spaces.', () => {
  const lesson = TYPING_LESSONS.find(entry => entry.unit === 1 && entry.kind === 'words')!;
  const result = buildTypingChart(chart, { ...lesson, seed: 12 });
  assert.match(result.text, /^[asdfghjkl ]+$/);
  assert.ok(result.text.includes(' '));
  assert.ok(result.words.slice(0, -1).every(word => WORDS.includes(word.text)));
});

test('The word bank contains at least 700 distinct words and at least 30 home row words.', () => {
  assert.ok(WORDS.length >= 700);
  assert.equal(new Set(WORDS).size, WORDS.length);
  assert.ok(WORDS.every(word => /^[a-z]{2,8}$/.test(word)));
  assert.ok(WORDS.filter(word => /^[asdfghjkl]+$/.test(word)).length >= 30);
  assert.ok(WORDS.filter(word => /^[asdfghjklei]+$/.test(word)).length >= 30);
});

test('The sentence bank contains at least 45 distinct lowercase sentences of 5 to 12 words.', () => {
  assert.ok(SENTENCES.length >= 45);
  assert.equal(new Set(SENTENCES).size, SENTENCES.length);
  assert.ok(SENTENCES.every(sentence => /^[a-z]+(?: [a-z]+){4,11}$/.test(sentence)));
  assert.ok(SENTENCES.includes('the quick brown fox jumps over the lazy dog'));
});

test('Each difficulty keeps letters at least its minimum gap in milliseconds apart.', () => {
  const gaps: Record<Difficulty, number> = { beginner: 420, easy: 300, medium: 220, hard: 170, expert: 130 };
  const events = [0, 129, 130, 169, 170, 219, 220, 299, 300, 419, 420, 638, 900].map((timeMs, index) => ({
    id: String(index), timeMs, lanes: [0, 1], durationMs: 500,
  }));
  const denseChart: Chart = { ...chart, beatsMs: [], downbeatsMs: [], events: { normal: events, hard: events, easy: events } };
  for (const [difficulty, gap] of Object.entries(gaps) as [Difficulty, number][]) {
    const result = buildTypingChart(denseChart, { ...TYPING_LESSONS[0], difficulty, seed: 7 });
    const expected: number[] = [];
    for (const note of notesFor(denseChart, difficulty)) {
      if (note.timeMs - (expected.at(-1) ?? -Infinity) >= gap) expected.push(note.timeMs);
    }
    assert.deepEqual(result.events.map(event => event.timeMs), expected, difficulty);
  }
});

test('A song with a four second rest still gives one letter per 500 ms beat through the rest.', () => {
  const notes = [0, 500, 5000, 5500].map((timeMs, index) => ({ id: String(index), timeMs, lanes: [0], durationMs: 0 }));
  const beatsMs = Array.from({ length: 13 }, (_, index) => index * 500);
  const quiet: Chart = { version: 1, durationMs: 7000, bpm: 120, beatsMs, downbeatsMs: [0, 2000, 4000, 6000], events: { normal: notes, hard: notes, easy: notes } };
  const times = buildTypingChart(quiet, { ...TYPING_LESSONS[0], difficulty: 'easy', seed: 3 }).events.map(event => event.timeMs);
  assert.deepEqual(times, beatsMs);
});

test('Drills avoid triples across groups and fall back to drills when too few words are typeable.', () => {
  const options: TypingOptions = {
    kind: 'drill', difficulty: 'easy', keys: ['KeyF', 'KeyJ'], newKeys: ['KeyF'], focus: ['KeyF'], seed: 15,
  };
  const drill = buildTypingChart(chart, options);
  assert.match(drill.text, /^[fj]+$/);
  assert.doesNotMatch(drill.text, /(.)\1\1/);
  assert.ok(drill.words.every(group => group.text.length >= 2 && group.text.length <= 5));
  assert.deepEqual(buildTypingChart(chart, { ...options, kind: 'words' }), drill);
  assert.deepEqual(buildTypingChart(chart, { ...options, kind: 'sentences' }), drill);
});

test('Sentence charts start with a whole sentence and fill short charts with typeable text.', () => {
  const options: TypingOptions = { kind: 'sentences', difficulty: 'hard', keys: ALL_TYPING_KEYS.filter(code => code.startsWith('Key')), seed: 12 };
  const result = buildTypingChart(chart, options);
  assert.ok(SENTENCES.some(sentence => result.text === sentence || result.text.startsWith(sentence + ' ')));
  const shortChart = { ...chart, events: { ...chart.events, normal: chart.events.normal.slice(0, 4) } };
  const shortResult = buildTypingChart(shortChart, options);
  assert.equal(shortResult.text.length, shortResult.events.length);
  assert.ok(shortResult.text.length > 0);
  assert.doesNotMatch(shortResult.text, /^ | $| {2}/);
});

test('Lessons pass at their accuracy goal and unlock the next lesson.', () => {
  const [first, second] = TYPING_LESSONS;
  const play = { bestAccuracy: first.goal.accuracy - 1, bestWpm: first.goal.wpm, stars: 0, plays: 1 };
  const progress = { [first.id]: play };
  assert.equal(lessonStatus(first.id, {}), 'open');
  assert.equal(lessonStatus(first.id, progress), 'open');
  assert.equal(lessonStatus(second.id, progress), 'locked');
  play.bestAccuracy = first.goal.accuracy;
  assert.equal(lessonStatus(first.id, progress), 'passed');
  assert.equal(lessonStatus(second.id, progress), 'open');
});

test('Typing stars need the lesson accuracy goal for one star, 92% for two and 97% for three.', () => {
  const lesson = TYPING_LESSONS[0];
  assert.equal(typingStars(lesson.goal.accuracy - 1, 20, lesson), 0);
  assert.equal(typingStars(lesson.goal.accuracy, 20, lesson), 1);
  assert.equal(typingStars(91.99, 20, lesson), 1);
  assert.equal(typingStars(92, 20, lesson), 2);
  assert.equal(typingStars(96.99, 20, lesson), 2);
  assert.equal(typingStars(97, 20, lesson), 3);
  assert.equal(typingStars(100, 0, lesson), 0);
});

test('Words per minute use five characters per word and round to one decimal after 1000 milliseconds.', () => {
  assert.equal(wpm(100, 999), 0);
  assert.equal(wpm(1, 1000), 12);
  assert.equal(wpm(103, 30_000), 41.2);
  assert.equal(wpm(103, 31_000), 39.9);
});

test('Weakest keys sort by hit rate, then by slower mean timing, and filter low attempt counts.', () => {
  const stats: KeyStats = {
    KeyA: { attempts: 5, hits: 4, timingTotal: 80 },
    KeyB: { attempts: 10, hits: 8, timingTotal: 240 },
    KeyC: { attempts: 5, hits: 3, timingTotal: 30 },
    KeyD: { attempts: 4, hits: 0, timingTotal: 0 },
    KeyE: { attempts: 6, hits: 0, timingTotal: 0 },
  };
  assert.deepEqual(weakestKeys(stats, 4), ['KeyE', 'KeyC', 'KeyB', 'KeyA']);
  assert.deepEqual(weakestKeys(stats, 1, 8), ['KeyB']);
  assert.deepEqual(weakestKeys(stats, 0), []);
});

test('Merging key statistics adds counts and timing without sharing the original entries.', () => {
  const first = { KeyA: { attempts: 6, hits: 4, timingTotal: 80 } };
  const second = { KeyA: { attempts: 3, hits: 2, timingTotal: 30 }, KeyB: { attempts: 1, hits: 0, timingTotal: 0 } };
  const merged = mergeKeyStats(first, second);
  assert.deepEqual(merged, { KeyA: { attempts: 9, hits: 6, timingTotal: 110 }, KeyB: second.KeyB });
  assert.notStrictEqual(merged.KeyB, second.KeyB);
  assert.equal(first.KeyA.attempts, 6);
  assert.equal(second.KeyA.attempts, 3);
});

test('Key metadata uses physical rows, columns, fingers, and hands.', () => {
  const samples = [
    ['Digit1', 0, 0, 'L-pinky', 'L'], ['KeyF', 2, 3, 'L-index', 'L'],
    ['KeyH', 2, 5, 'R-index', 'R'], ['KeyI', 1, 7, 'R-middle', 'R'],
    ['Period', 3, 8, 'R-ring', 'R'], ['BracketRight', 1, 9, 'R-pinky', 'R'],
    ['Space', 4, 4.5, 'thumb', 'both'],
  ] as const;
  for (const [code, row, column, finger, hand] of samples) {
    const key = keyInfo(code)!;
    assert.deepEqual([key.row, key.column, key.finger, key.hand], [row, column, finger, hand]);
  }
  for (const code of ALL_TYPING_KEYS) assert.equal(codeFor(charFor(code)), code);
  assert.equal(codeFor('A'), 'KeyA');
  assert.equal(codeFor('ab'), undefined);
  assert.equal(keyInfo('Enter'), undefined);
});
