# Face Recognition App

A React app for live face comparison and voice capture, built with Vite and Tailwind CSS.

## Requirements

Use Node.js 22.22.2+, 24.15.0+, or 26+ on the supported even-numbered release lines, and npm.
Tailwind CSS 4 requires modern browsers: Safari 16.4+, Chrome 111+, or Firefox 128+.
Camera and speech features require browser support and permission; camera access requires HTTPS or localhost.

## Install

Install the locked dependencies, including the Vite development server:

```sh
npm ci --include=dev
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

If `npm run dev` or `npm start` reports that `vite` is not recognized, run
`npm ci --include=dev` from the project root, wait for it to finish successfully,
then retry. This restores missing or incomplete local development dependencies.

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

### Automatic publishing

The [Deploy to GitHub Pages workflow](.github/workflows/deploy-pages.yml) follows
the same deployment approach as `client-side-free-ai`, adapted to this repository's
`master` branch and `build/` output directory.

Every push to `master` installs the locked dependencies with Node.js 24, runs lint
and tests, builds the app, and publishes `build/` to
[the live site](https://lyudmilpetrov.github.io/face-recognition-app/).
Pull requests targeting `master` run the same checks and build without publishing.
Failed checks prevent deployment. Deployments use GitHub's built-in token and
Pages artifact actions; no personal access token or deployment secret is required.

The linked repository is configured to use GitHub Actions and allow `master` in
the `github-pages` deployment environment. To reproduce the setup, follow
[GitHub's publishing source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
and these steps:

1. In [repository Settings → Pages](https://github.com/lyudmilpetrov/face-recognition-app/settings/pages),
   set **Build and deployment → Source** to **GitHub Actions**.
2. If the `github-pages` environment restricts deployment branches, allow `master`.
3. Commit `package-lock.json` together with the workflow and source changes. The
   workflow requires the lockfile for `npm ci` and the npm dependency cache.
4. Push or merge the changes to `master`. Track the run in
   [GitHub Actions](https://github.com/lyudmilpetrov/face-recognition-app/actions/workflows/deploy-pages.yml).

Future updates only require committing and pushing to `master`; GitHub builds and
publishes the site automatically. To redeploy without changing code, select
**Deploy to GitHub Pages → Run workflow → master** in the Actions tab.

The service worker checks the network for page navigations so an online reload
can receive the latest deployment, with cached HTML available when offline.
After the first deployment of the updated service worker, an already open tab
may need another reload once its new worker activates.

The existing `npm run deploy` command is a legacy alternative that writes to the
`gh-pages` branch. It requires Pages' **Deploy from a branch** source; use the
Actions workflow above for automatic publishing.
