# Keyboard Shredder

Create an original guitar track, then play its riffs, chords, and sustains on five keyboard lanes. A full track runs about 90 seconds. Quick Play takes 30 seconds. Normal and Hard use the same recording.

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

## Play head-to-head

Open **Head-to-head**, choose a saved track and difficulty, and copy the invite link. The guest signs in to a separate account and opens the link to join. Both players select **Ready up** after loading. The match starts on a shared countdown and shows both scores, combos, and fret activity. The room keeps playing during a disconnect. Reopen its invite to join the current position. The host can set up a rematch from the results screen.

Open **Player profile** to choose a display name, avatar, fret colors, and scroll speed. Duels award badges for finishing a match, winning, reaching 95% accuracy, building a 25-note combo, and completing ten matches. Feature an earned badge to show it on your player card.

For local two-player testing, use the loopback fixture server and open the invite in a second browser context with `&player=test-guest` appended. The default context uses `test-player`. This switch is available only in loopback test mode. Rooms live in memory and expire after 30 minutes of inactivity. Saved profiles and results survive restarts.

## Controls

Press **A S D F G** as the corresponding notes reach the line. Press all shown keys together for chords. Hold down long notes. Press Escape to pause a solo track. Open Controls and timing to remap keys or save a latency offset.

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

Launch the resulting blind library with `LOCAL_TEST_AUTH=1 SONG_DATA_DIR=.song-data/music-benchmark npm start` after building. Testers play tracks by blind label. Record 1–5 scores in `scorecard.csv` for hook memorability, guitar clarity, and how closely presses match the guitar. Keep `answer-key.json` private until ratings are submitted. Use three testers, including a rhythm-game player and a newcomer. Independently annotate 30 guitar attacks per track across riff, hook, and solo. Require at least 85% of Hard-chart events in those windows to land within 60 ms of an audible attack. For the pilot, require at least five passing takes from the provider and a median of at least 4/5 in each listening category.

<details>
<summary>Original concept image</summary>

<img width="1562" height="2273" alt="Keyboard Shredder concept" src="https://github.com/user-attachments/assets/74e227f8-841b-487b-a204-d48e14ce20ba" />
</details>
