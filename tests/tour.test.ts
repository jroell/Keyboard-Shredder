import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  isTourSongUnlocked, normalizeTourProgress, recordTourResult, TOUR_TRACKS, TOUR_VENUES, tourStart, type TourProgress,
} from '../shared/tour';
import { catalogTracks } from '../backend/catalog-data';

test('The nine tour venues and the encore contain every playable catalog track once', () => {
  assert.equal(TOUR_VENUES.length, 10);
  for (const venue of TOUR_VENUES) assert.equal(venue.tracks.length, venue.id === 'sunrise-encore' ? 1 : 4);
  assert.deepEqual(TOUR_TRACKS.map(track => track.id).sort(), catalogTracks.map(([id]) => id).sort());
  for (const track of TOUR_TRACKS) {
    const chart = JSON.parse(readFileSync(new URL(`../catalog/${track.id}/chart.json`, import.meta.url), 'utf8'));
    assert.ok(chart.events.easy.length > 0 && chart.events.normal.length > 0 && chart.events.hard.length > 0);
  }
});

test('A 59% result leaves the next song locked and 60% opens it', () => {
  const [first, second, third] = TOUR_TRACKS;
  const attempted = recordTourResult({}, first.id, 59);
  assert.equal(tourStart(attempted), first.id);
  assert.equal(attempted[first.id], 59);
  assert.equal(isTourSongUnlocked(second.id, attempted), false);
  assert.equal(recordTourResult(attempted, second.id, 100), attempted);
  const cleared = recordTourResult(attempted, first.id, 60);
  assert.equal(tourStart(cleared), second.id);
  assert.equal(isTourSongUnlocked(second.id, cleared), true);
  assert.equal(isTourSongUnlocked(third.id, cleared), false);
  assert.equal(recordTourResult(cleared, first.id, 40), cleared);
});

test('Clearing every song in order opens the next venue and completes the tour after 37 clears', () => {
  let progress: TourProgress = {};
  for (const [index, track] of TOUR_TRACKS.entries()) {
    assert.equal(tourStart(progress), track.id);
    if (index + 1 < TOUR_TRACKS.length) assert.equal(isTourSongUnlocked(TOUR_TRACKS[index + 1].id, progress), false);
    progress = recordTourResult(progress, track.id, 60);
  }
  assert.equal(tourStart(progress), null);
  assert.equal(Object.keys(progress).length, 37);
});

test('Restoring account progress drops impossible clears and keeps the best valid attempt', () => {
  const [first, second, third] = TOUR_TRACKS;
  assert.deepEqual(normalizeTourProgress({ [first.id]: 80, [second.id]: 55, [third.id]: 99, elsewhere: 100 }),
    { [first.id]: 80, [second.id]: 55 });
  assert.deepEqual(normalizeTourProgress({ [first.id]: Infinity }), {});
  assert.deepEqual(recordTourResult({}, first.id, 101), {});
});
