import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createProfileStore } from '../backend/profiles';
import { TOUR_TRACKS, tourStart } from '../shared/tour';

test('A co-op host keeps cleared stages across restart without awarding either player a duel badge', () => {
  const root = mkdtempSync(join(tmpdir(), 'shredder-coop-'));
  const previousDir = process.env.SONG_DATA_DIR;
  process.env.SONG_DATA_DIR = root;
  try {
    const profiles = createProfileStore();
    const [first, second] = TOUR_TRACKS;
    assert.deepEqual(profiles.recordCoop('host', second.id, 100), {});
    assert.equal(tourStart(profiles.recordCoop('host', first.id, 59)), first.id);
    assert.equal(tourStart(profiles.recordCoop('host', first.id, 60)), second.id);
    assert.equal(tourStart(profiles.recordCoop('host', first.id, 23)), second.id);

    const restarted = createProfileStore();
    assert.deepEqual(restarted.coopProgress('host'), { [first.id]: 60 });
    assert.deepEqual(restarted.coopProgress('guest'), {});
    assert.equal(tourStart(restarted.coopProgress('host')), second.id);
    for (const uid of ['host', 'guest']) {
      assert.equal(restarted.get(uid).played, 0);
      assert.equal(restarted.get(uid).wins, 0);
      assert.deepEqual(restarted.get(uid).badges, []);
    }
  } finally {
    if (previousDir === undefined) delete process.env.SONG_DATA_DIR;
    else process.env.SONG_DATA_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  }
});
