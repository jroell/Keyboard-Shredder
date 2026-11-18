# Keyboard Shredder

Keyboard Shredder is a browser rhythm game. Gems slide down a 3D guitar neck, and you press the matching key when a gem reaches its ring at the strike line. It teaches touch typing in the Typing academy, where gems carry letters. Play free at https://shredder.jasonroell.com.

## Game modes

- **Quick play:** Pick a song, a difficulty and optional modifiers. The list plays a preview of the highlighted song and shows your best stars and grade.
- **World tour:** Play nine venues and a sunrise encore across 37 songs. Hit 60% of the notes to clear a song and unlock the next. Tour with a friend is an online co-op tour with one team target.
- **Typing academy:** Study 30 lessons in seven units, including capitals, coder keys and a Vim lesson. Finger columns are colour coded, and an on-screen keyboard lights the next key and names the finger. Pass key drills at 80% accuracy and words and sentences at 85%. Results show words per minute, accuracy and a heat map of missed keys.
- **Party mode:** Two players share one keyboard. Player 1 uses A S D F G and Space. Player 2 uses H J K L ; and Enter. Battle is highest score wins, and overdrive shakes the other player's neck. Co-op uses one team score, and solo play can battle the computer at three skill levels.
- **Play online:** Create an invite link, send it to a friend, and both press Ready. Choose head-to-head play or a co-op tour. The server keeps both players in sync and scores both, and duels award badges.
- **Daily challenge:** One song, difficulty and modifier set is fixed for everyone each UTC day, with its own leaderboard.
- **Locker:** Equip unlocked necks (7), gem styles (8) and hit effects (6), and view 42 achievements and lifetime stats.
- **Create a track:** When the server has a music key, sign in with Google or email through Firebase and describe any style of music. You get a 30 or 90 second track with a playable chart about a minute later.

## How to play

Beginner: three keys, one note per beat, cannot fail. Easy: five keys, single notes. Medium: faster riffs and a few two-key chords. Hard: full riffs with chords. Expert: every note, tight timing. An empty crowd meter ends Hard and Expert sets early.

Press A S D F G. Press chord keys together and hold long notes until the tail ends. Perfect is within 45 ms (100 points), Great within 80 ms (75) and Good within the window from 160 ms on Beginner to 85 ms on Expert (50 per key).

Streaks of 10, 20 and 30 notes give 2x, 3x and 4x. A miss or stray press resets the streak. Accurate hits charge the amp, and Space gives double points for 8 seconds in overdrive. Runs earn 0 to 5 stars and a grade from D to S, with a gold star and S+ for a full combo at 96% or better. Modifiers: Hyperspeed (+10%), Fade out (+15%), Precision (+20%), Sudden death (+25%). Mirror flips the chart with no bonus.

Escape pauses. On a phone or tablet, five touch pads sit under the lanes and a lightning button starts overdrive. Typing lessons need a physical keyboard.

## Guitar controllers

The game works with Guitar Hero and Rock Band guitars and ordinary gamepads through the browser Gamepad API. Plug in by USB or dongle and press any button. Default mapping follows Xbox 360 style guitars for the frets, strum bar, overdrive, pause and whammy. Two play styles in Settings: "Strum" (hold frets and strum each note) and "Tap" (press a fret to play). If buttons differ, Settings > Guitar controller > "Map the buttons" walks through nine presses and saves the mapping. Guitar Hero Live guitars (six buttons) connect through their USB dongle (PlayStation 3, Wii U or PlayStation 4 version) in Chrome or Edge; press "Wake the dongle" in Settings first, and map five of the six buttons for five lanes. Support was tested with a simulated standard-layout guitar and has not yet been tested with physical guitars.

## Practice tools

Start from song select ("Practice") or the results song map at 50%, 75% or 100% speed, for the whole song or one of eight sections: Intro, Verse, Chorus, Build, Breakdown, Solo, Finale, with repeats numbered such as "Verse 2". Names show on the song map and practice card, where Start and End move one beat at a time. The loop runs at least four beats until you stop. A panel shows the last and best passes, with notes hit, timing rating and holds dropped. Practice shows "Chord landed" and "Hold paid +N". On Medium and harder, an unscored song offers "Drill the busiest part at 75% speed" on the section with the most chords and holds. The song map caption names the costliest section, counting missed notes, stray presses and holds let go early. Nothing is saved or ranked. Headline sets earn gold at an 80% average timing rating and platinum at 85% or better on every song.

"Slow-mo" modifier plays a song at three-quarter speed; not ranked. Each venue has a headline set once every song there is cleared: its songs back to back with one running score. Each player picks their own difficulty, and the battle is decided by timing rating when difficulties differ, so a beginner can beat an expert.

## Typing academy

There are 30 lessons in seven units: home row, top row, bottom row, fluency, capitals and punctuation, numbers, and coder keys (including Vim motions such as hjkl, gg and wb). By default the song waits at each letter until you type it; only wrong keys count against accuracy. "Keep the beat" turns that off for a rhythm challenge.

## Progress and leaderboards

Progress saves in the browser, including level, stars, unlocks, typing history and settings. Runs earn experience to level 50 and unlock cosmetics. The server re-scores finished setlist runs from recorded key presses before they join a leaderboard.

## How it is built

- React 19 and TypeScript, built with Vite.
- The neck is drawn on a canvas in `src/game/renderer.ts`.
- Game rules for browser and server live in `shared/`.
- The Express and Socket.IO server in `server.ts` and `backend/` uses SQLite files on the data volume.
- `npm run dev:fixture` starts a local server at http://localhost:3000 with test sign-in and a fake music generator.
- Add `?bot=0.9` to let the computer play at 90% skill for demos. Bot runs are not saved or ranked.

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

The Docker image includes the charting worker, model weights, and frontend. Build for Linux x86-64. Set the Firebase and music server variables from `.env.example` on the host. Mount a persistent volume at `/app/data`. The container prepares that directory at startup, then runs the game as UID 1000. Route HTTPS and WebSocket traffic to the app’s `PORT` on the same instance. Local Docker uses port 3000. The Railway service uses port 8080. On Railway, run `railway config plan` and `railway config apply` from the linked project to apply `.railway/railway.ts`. It defines the Docker build, single replica, persistent volume, and `/healthz` check. Keep service variables in Railway.

```sh
docker build --platform linux/amd64 -t keyboard-shredder .
docker run --rm --env-file .env -e SONG_DATA_DIR=/app/data -p 127.0.0.1:3000:3000 \
  --mount source=keyboard-shredder-data,target=/app/data keyboard-shredder
```

The recordings and charts live under `catalog/`. Keep that directory alongside the app when deploying.

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
