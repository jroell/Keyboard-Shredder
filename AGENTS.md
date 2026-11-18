# Repository Guidelines

## Project Structure

Keyboard Shredder is a React 19 + TypeScript rhythm game built with Vite. `src/main.tsx` mounts the app, and `src/App.tsx` owns routing between screens (title, menu, songs, tour, academy, party, online, locker, settings, create, play), sign-in state and the shared app context.

`src/ui/` has one file per screen plus `GameScreen.tsx` (the stage during a song), `Results.tsx`, `PlayerHud.tsx` and `KeyboardGuide.tsx`. `src/game/` is the engine: `session.ts` (playback, input, fail rules, input log), `renderer.ts` (canvas neck, gems, particles, crowd), `sfx.ts` (synthesized sound effects), `themes.ts` and `layouts.ts`. `src/state/` holds browser storage: `store.ts` (settings, save data, tour and lesson progress in localStorage keys starting with `ks:`) and `progress.ts` (records a finished run). `src/lib/` holds `api.ts` (guest token, fetch helpers, leaderboards), `transport.ts` (audio clock), `preview.ts` (song previews and menu music) and `recording.ts`. `src/styles/` holds `base.css`, `menus.css` and `stage.css`. Plain CSS, no Tailwind.

`shared/` holds rules used by both browser and server: `scoring.ts`, `difficulty.ts`, `modifiers.ts`, `rating.ts`, `typing.ts`, `progression.ts`, `daily.ts`, `tour.ts`, `duel.ts` and `song.ts`. `server.ts` runs Express and Socket.IO. `backend/` holds `duels.ts` (online rooms in memory), `leaderboard.ts` (replays a run's key presses to verify the score), `profiles.ts`, `jobs.ts`, `music.ts` (track generation) and `catalog.ts` (the 37 starter songs under `catalog/`).

## Build and Development

Run `npm ci` to install dependencies. Run `npm run dev:fixture` for the local server on http://localhost:3000 with test sign-in and fake music. Run `npm run build` for the production build.

## Coding Style

Use two-space indent and single quotes. Use PascalCase component files and camelCase functions. Socket.IO event names are kebab-case; change client (`src/ui/Online.tsx`) and server (`backend/duels.ts`) together. A change to scoring must keep browser and server in agreement, because the server re-scores runs for leaderboards and duels with the same `shared/scoring.ts`.

## Testing

Run `npm run lint` for the TypeScript check. Run `npm test` for unit tests in `tests/*.test.ts`, run with node:test through tsx. Run `npm run test:e2e` for the Playwright suite `tests/game.spec.ts` against the production build. `tests/helpers/player.ts` plays a song through real key events for browser tests. For gameplay changes, play a song and check input, scoring and the results screen. For online changes, open the invite in a second browser context.

## Commits

Commit subjects use `type(scope): short description`, lowercase, at most 72 characters.
