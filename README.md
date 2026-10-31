# Face Recognition App

A React app for live face comparison and voice capture, built with Vite and Tailwind CSS.

## Requirements

Use Node.js 22.22.2+, 24.15.0+, or 26+ on the supported even-numbered release lines, and npm.
Tailwind CSS 4 requires modern browsers: Safari 16.4+, Chrome 111+, or Firefox 128+.
Camera and speech features require browser support and permission; camera access requires HTTPS or localhost.

## Install

```sh
npm ci
```

## Development

```sh
npm run dev
# or
npm start
```

Runs the app in development mode and automatically opens Microsoft Edge at the
actual development server URL (normally [http://localhost:3000/face-recognition-app/](http://localhost:3000/face-recognition-app/)).
Microsoft Edge must be installed. The browser launcher uses the actual server URL,
including a different port if port 3000 is already in use.

To disable automatic opening, set `BROWSER=none` in `.env.development.local`.
The page reloads when source files change.

## Validation

```sh
npm run lint
npm test
npm run build
```

`npm test` runs the Vitest suite once. Use `npm run test:watch` for watch mode.
The app tests mock camera/model work and browser speech APIs; checking live detection
and speech capture also requires a supported browser and camera/microphone access.

## Production and GitHub Pages

`npm run build` creates the production bundle in `build/`.
`npm run preview` serves that bundle locally.

The Vite `base` setting in `vite.config.js` preserves the GitHub Pages path
`/face-recognition-app/`, including icons, manifest, and service worker registration.
Update that setting if deploying at a different path.

To publish to the configured GitHub repository, run:

```sh
npm run deploy
```

This builds the app and publishes `build/` to the `gh-pages` branch. Configure
GitHub Pages to serve that branch in the repository settings.
