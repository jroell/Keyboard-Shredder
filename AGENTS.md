# Repository Guidelines

## Project Structure

Keyboard Shredder is a React and TypeScript rhythm game. `src/main.tsx` mounts the app, and `src/App.tsx` handles screens, gameplay, and multiplayer client state. Feature components live in `src/components/Game/` and `src/components/Chat/`. Integration and utility modules live in `src/lib/`. Shared styles and Tailwind CSS live in `src/index.css`.

`server.ts` runs Express and Socket.IO, manages multiplayer rooms in memory, and mounts Vite in development. Firebase configuration, the data blueprint, and Firestore rules live at the repository root.

## Build and Development

- `npm ci` installs dependencies from `package-lock.json`.
- `npm run dev` starts the app and multiplayer server at `http://localhost:3000`.
- `npm run lint` runs the TypeScript checker without emitting files.
- `npm run build` builds the frontend into `dist/`.
- `npm run preview` serves the built frontend. Use the dev command for checks that need the Socket.IO server.

Use `.env.example` as a template for local configuration. Keep local environment files out of Git. Vite substitutes `GEMINI_API_KEY` into the frontend bundle, so use a dedicated development key for local Gemini checks.

## Coding Style

Use two-space indentation and follow the surrounding file's quote style. Use PascalCase for React components and their filenames, and camelCase for functions and variables. Keep Socket.IO event names in kebab-case and update the client and server together when changing an event or its payload.

## Testing

The project has no automated test script or coverage threshold. Run the type check and build before submitting changes. For gameplay changes, play through a song and check input, scoring, and the results screen. For multiplayer changes, join the same room from two browser windows and check readiness, score updates, and disconnect behavior.

## Commits and Pull Requests

Write short, action-oriented commit subjects. History includes plain subjects such as `Add image to README` and prefixed subjects such as `feat: Initialize project structure and dependencies`. In pull requests, describe what changed and how you verified it. Link related issues when available and attach screenshots for visible changes.
