# Keyboard Shredder

Create an original guitar track, then play its riffs, chords, and sustains on five keyboard lanes. A full track runs about 90 seconds. Quick Play takes 30 seconds. Easy, Normal, and Hard use the same recording. Easy uses fewer notes and keeps chords to one lane. Normal and Hard add denser phrases and multi-lane chords.

## Play locally

Install Node 22 using the version in `.nvmrc`, FFmpeg (with MP3 encoding support), and [uv](https://docs.astral.sh/uv/). The analysis lockfile supports macOS on Apple silicon and Linux x86-64.

```sh
npm ci
npm run setup:analysis
npm run dev:fixture
```

Open http://localhost:3000. The fixture studio generates an original, deterministic test recording. It uses the same audio analysis, scoring, and library as the live studio. It binds to loopback and uses a separate data directory.

For live generation, copy `.env.example` to `.env`. Add a server-side ElevenLabs key and enable Google and Email/Password sign-in for a Firebase project dedicated to the game. Enable the host under authorized domains and configure Firebase Admin Application Default Credentials. Run `npm run dev` locally or `npm run build && npm start` for the production build. Serve the studio over HTTPS outside localhost. The proxy must allow WebSocket upgrades on `/socket.io/`.

Keep one app instance per `SONG_DATA_DIR` volume. The volume holds the SQLite job history, player profiles, duel results, and private audio and charts. Back it up to preserve the library. If the previous library lives in the same Firebase project, set `FIREBASE_LEGACY_DATABASE_ID` to list expired browser-local recordings and reuse their prompts. Confirm that the [ElevenLabs Music terms](https://elevenlabs.io/music-terms) for the account cover in-game generation and replay before launching a public pilot.

## Host the game

The Docker image includes the charting worker, model weights, and frontend. Build for Linux x86-64. Set the Firebase and music server variables from `.env.example` on the host. Mount a persistent volume at `/app/data`. The container prepares that directory at startup, then runs the game as UID 1000. Route HTTPS and WebSocket traffic to port 3000 on the same instance. On Railway, run `railway config plan` and `railway config apply` from the linked project to apply `.railway/railway.ts`. It defines the Docker build, single replica, persistent volume, and `/healthz` check. Keep service variables in Railway.

```sh
docker build --platform linux/amd64 -t keyboard-shredder .
docker run --rm --env-file .env -e SONG_DATA_DIR=/app/data -p 127.0.0.1:3000:3000 \
  --mount source=keyboard-shredder-data,target=/app/data keyboard-shredder
```

## Starter setlist

Every account starts with 20 short songs and five full songs across eleven genres. Open **Setlist** to filter by genre or length. Every song has Easy, Normal, and Hard charts. New tracks you generate appear under **My tracks**. The starter songs come with the game and play without a music generation key.

The full songs include the originals “Voltage Parade” and “Copper Moon” and three [Creative Commons recordings](catalog/CREDITS.md). The recordings and charts live under `catalog/`. Keep that directory alongside the app when deploying. Each starter song has its own stage and is available in free play, story mode, and multiplayer.

## Play the tour

Open **Story mode** and work through six venues and a sunrise encore. Earn at least 60% accuracy to clear a song and unlock the next one. Clear every song at a venue to earn the next booking. Solo tour progress is saved for this account in the current browser.

Choose **Tour with a friend** to start a co-op tour. Share the invite and ready up together. Each player has an individual score and fret display. Your combined points have to reach the target to unlock the next song. The host can load it into the same room. Co-op progress is saved to the host's account on the server.

## Play head-to-head

Open **Head-to-head**, choose a saved track and difficulty, and copy the invite link. The guest signs in to a separate account and opens the link to join. Both players select **Ready up** after loading. The match starts on a shared countdown and shows both scores, combos, and fret activity. The room keeps playing during a disconnect. Reopen its invite to join the current position. The host can set up a rematch from the results screen.

Open **Player profile** to choose a display name, avatar, fret colors, and scroll speed. Duels award badges for finishing a match, winning, reaching 95% accuracy, building a 25-note combo, and completing ten matches. Feature an earned badge to show it on your player card.

For local two-player testing, use the loopback fixture server and open the invite in a second browser context with `&player=test-guest` appended. The default context uses `test-player`. This switch is available only in loopback test mode. Rooms live in memory and expire after 30 minutes of inactivity. Saved profiles and results survive restarts.

## Controls

Press **A S D F G** as the corresponding notes reach the line. Press all shown keys together for chords. Hold down long notes. On a touch screen, use the five pads below the fretboard and press chords with multiple fingers. Land notes and chords to charge the amp. When it is full, press Space or tap Boost to double your note multiplier for six seconds. Press Escape to pause a solo track. Open Controls and timing to remap keys or save a latency offset.

The backing mix runs throughout the song. A hit brings in the recorded guitar, a chord needs all its keys, and releasing a sustain early cuts its guitar. The isolated guitar stays silent on misses. Older personal tracks saved as a full mix still play and identify the mix below the countdown controls.

### Keyboard practice

Open **Keyboard practice** in the studio, enable practice keys, and pick any solo track. Choose Home row, Number row, Vim navigation, Touch typing, or Custom. Custom layouts support 5–12 keys across the four keyboard rows. Practice charts reuse the song's timing and spread notes across your selected keys. Chords use at most two keys. Vim navigation rehearses the positions of movement and word keys. Open **Practice progress** in the studio to see hit rates and timing for individual keys and exact chord combinations. Compare up to five recent runs with the same number of earlier runs at the selected difficulty. The browser keeps the latest 30 completed practice runs for the signed-in account.

## Verify changes

```sh
npm run lint
npm test
npm run test:analysis
npx playwright install chromium firefox
npm run build
npm run test:e2e
```

The browser suite uses the production build. It runs the real charting worker, verifies audio-derived timing, scores keyboard input, and checks that the library survives a process restart. It also checks account isolation and retrying with an existing recording. The duel test opens the same invite in two independent browser contexts and checks playback alignment, chord scoring, a rematch, and badge persistence.

With a paid provider key, run `npm run test:e2e:live` for one real 30-second track and `npm run test:e2e:live -- 90` for one 90-second track. The test uses Chromium, an isolated loopback server, and a temporary library. It logs the provider and charting stages. If your music key lacks the subscription-read scope, use the provider dashboard to check charge totals.

## Blind music comparison

Set both `ELEVENLABS_API_KEY` and `GEMINI_API_KEY`. Run `npm run benchmark:music` to generate two takes per provider for each of three guitar briefs. It can bill for 12 songs and 12 separations. The optional arguments are an output directory and a maximum number of new takes. For example, `npm run benchmark:music -- .song-data/music-benchmark 2` starts with one take from each provider.

Launch the resulting blind library with `LOCAL_TEST_AUTH=1 SONG_DATA_DIR=.song-data/music-benchmark npm start` after building. Select My tracks to see the blind test tracks. Testers play tracks by blind label. Record 1–5 scores in `scorecard.csv` for hook memorability, guitar clarity, and how closely presses match the guitar. Keep `answer-key.json` private until ratings are submitted. Use three testers, including a rhythm-game player and a newcomer. Independently annotate 30 guitar attacks per track across riff, hook, and solo. Require at least 85% of Hard-chart events in those windows to land within 60 ms of an audible attack. For the pilot, require at least five passing takes from the provider and a median of at least 4/5 in each listening category.

<details>
<summary>Original concept image</summary>

<img width="1562" height="2273" alt="Keyboard Shredder concept" src="https://github.com/user-attachments/assets/74e227f8-841b-487b-a204-d48e14ce20ba" />
</details>
