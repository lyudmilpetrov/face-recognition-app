# Face Recognition App

A React app with separate face comparison, voice comparison, voice translation,
face enrollment and encrypted note storage, and device authentication pages,
built with Vite and Tailwind CSS.

## Pages and navigation

Use the sidebar on desktop, or **Open menu** on smaller screens. Pages have
bookmarkable hash URLs, so static hosting does not require route rewrites:

- `#/face-comparison`: the existing two-capture face comparison.
- `#/voice-comparison`: reference/test voice recording and comparison.
- `#/voice-translation`: on-device speech transcription and text translation,
  when the browser supports the local SpeechRecognition and Translator APIs.
- `#/lock-unlock`: face enrollment and a passphrase-encrypted local note.
- `#/fingerprint-reading`: a local WebAuthn device authentication demonstration.

Leaving a page unmounts its camera, microphone, and model work. Face Comparison
starts its existing camera previews on entry; the new enrollment and speech
tools wait for explicit user actions. Theme and device-capability controls are
available on all pages.

## Face enrollment and encrypted notes

1. Open **Lock / Unlock**, start the camera, and capture 10 distinct face samples
   in steady lighting with small pose changes. Capture 3 more fresh samples to
   confirm the enrollment. Restarting enrollment clears samples and keeps drafts.
2. Enter a private note and a strong passphrase of at least 12 characters, confirm
   the passphrase, and select **Create encrypted vault**. Creation saves the vault
   and locks it.
3. On a later visit, enter the passphrase, then capture 3 fresh face samples to
   reveal the note. Edit it and select **Save encrypted note** to persist changes.
4. **Lock now**, leaving the page, hiding the page, and 5 minutes of inactivity
   clear the open session. Unsaved edits are discarded. Download an encrypted
   backup and keep its passphrase separately. Restore is available when no local
   vault exists. Deletion requires an explicit acknowledgement and removes both
   the local note and face enrollment; a damaged vault can also be deleted before
   restoring a backup.

The model is pretrained; enrollment stores reference descriptors rather than
retraining model weights. Enrollment requires consistent, non-duplicate samples.
Verification requires all three frames' mean reference distance to be below 0.6.
This is an uncalibrated demo rule and has no liveness detection. Photos, replayed
video, or a modified browser can bypass the face check.

The passphrase supplies the cryptographic protection. Web Crypto encrypts the
note and face template with a random AES-256-GCM data key. PBKDF2-SHA-256 with
600,000 iterations and a random salt derives the key that protects that data key.
IndexedDB stores only the versioned encrypted record and its public parameters;
passphrases, readable keys, images, and plaintext notes are not persisted.
Fresh encryption IVs are generated for saves. Backup import is bounded and
validated, and encrypted data is authenticated again when opening it.

**Passphrase recovery** explicitly skips the experimental face check and opens a
read-only note; re-enroll before editing again. It also works when the stored
face model version is incompatible. Re-enrollment replaces the existing vault
only after successful encrypted storage, and lets you choose a new passphrase.
There is no recovery from a forgotten passphrase. Clearing site data removes
the vault. It does not automatically sync across browser profiles or devices.
Malicious application code or a compromised device can access an unlocked note.

The scope is a single local note in a trusted browser, with no server account or
remote authorization. WebAuthn PRF-based vault unlocking is not implemented;
the device-authentication page is a separate demonstration. See
[the feasibility and implementation guide](./BROWSER_FACE_UNLOCK_FEASIBILITY.md).

## Voice translation and device authentication

Voice Translation uses the browser's on-device Translator API and opts into
`SpeechRecognition.processLocally` when available. Browsers such as Edge that do
not expose local speech recognition use a multilingual Whisper Tiny model through
Transformers.js and WebAssembly instead. The first start downloads about 41 MB of
model weights and the speech runtime; only model files are cached, never audio
or transcripts. Choose the source and target languages, then
press **Start microphone**. This prepares the translator, downloads any needed
local language packs, and requests microphone access. Allow access, then speak:
finalized speech appears as text and is translated automatically while recording.
Every **Start microphone** clears the previous transcript and translation. The
microphone panel shows **Idle**, **Starting**, **Listening**, or **Stopped**.
When **Listening** appears, you can speak; the live waveform follows microphone
audio and stays flat during silence. It disappears as soon as capture stops,
even while the last phrase is still being transcribed or translated.
With the Whisper fallback, pause briefly between phrases so each phrase can be
transcribed locally. CPU speed affects how quickly the text appears.
**Stop microphone** finishes the transcript and any pending translation; recording
also stops after one minute or 5,000 characters. **Cancel** stops the current work
and keeps the transcript for editing. You can also type and press **Translate text**;
it prepares the translator automatically. Language packs download only after one
of these actions. If the browser requires another gesture to authorize a download,
follow the retry message and press the button again. There is no cloud fallback. If local
speech is unavailable, type text instead; translating it still requires a
supported Translator API and language pair. The microphone button remains
clickable while idle so setup failures display an actionable message. Availability varies by browser,
operating system, device, and language. See the official
[Translator API](https://developer.chrome.com/docs/ai/translator-api) and
[on-device speech documentation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally),
and [Whisper model](https://huggingface.co/onnx-community/whisper-tiny).

Fingerprint Reading uses WebAuthn platform credentials with required user
verification. **Register device**, then **Verify device** to verify a fresh signed
challenge locally. Registration metadata stays in memory for this page visit;
leaving the page clears it. The app validates the challenge, origin, RP hash,
credential, verification flags, and signature. No raw fingerprints are exposed
to JavaScript; the operating system may use a fingerprint, face, or PIN. This
does not unlock the note vault or authenticate a server account. See
[WebAuthn](https://www.w3.org/TR/webauthn-3/).

## Requirements

Use Node.js 22.22.2+, 24.15.0+, or 26+ on the supported even-numbered release lines, and npm.
Tailwind CSS 4 requires modern browsers: Safari 16.4+, Chrome 111+, or Firefox 128+.
Camera and microphone recording require browser support, permission, and HTTPS or localhost.
Voice comparison also requires Web Audio, Web Workers, and WebAssembly.

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

### Following image capture and comparison

Open the browser's DevTools Console and filter by `[FaceCapture:video1]`,
`[FaceCapture:video2]`, or `[FaceComparison]` to follow the two camera panels and
their comparison. Capture steps are logged once per lifecycle, with updates when
the detection state changes, to keep the continuous frame loop readable.

1. Each panel requests permission for the front-facing camera. Video metadata
   supplies the dimensions used to size its canvas.
2. TensorFlow selects WebGL, falling back to the CPU if necessary, then loads
   BlazeFace. The model estimates face boxes from available video frames; the
   canvas copies the live video and draws the estimated boxes. Inference and drawing
   happen sequentially, so preview pixels can be newer than the estimated frame.
   The next estimate is scheduled after the previous one finishes.
3. **Stop Recognition** copies a still directly from the camera at its native
   resolution before releasing the stream. A detached canvas holds clean image
   pixels without overlay boxes; the panel displays that same still. Restarting
   clears the saved capture and any earlier comparison result.
4. **Compare Faces** loads the local face-recognition models on first use. Each
   frozen image is processed again to detect a face, align it using 68 landmarks,
   and extract a 128-value learned facial-feature descriptor. Each image must
   contain exactly one detected face; missing faces and groups produce a clear
   error instead of silently selecting a person.
5. The comparison uses Euclidean distance between those feature vectors. Smaller
   distances mean more similar facial features. The demo reports **Similar facial
   features** when the distance is strictly below **0.6**, the library's default
   threshold, and **Different facial features** otherwise. This replaces the
   previous bounding-box calculation and its percentage/cutoff.

The distance is not an identity probability. Lighting, pose, image quality, and
the chosen threshold affect results; the demo has no liveness or spoof detection.
The threshold has not been calibrated for this application's users or cameras.
Images and descriptors remain in memory, with no uploads or browser-storage
writes. New console messages describe stages without logging photos, landmarks,
or feature vectors. Duplicate comparisons are blocked, and results from captures
that were restarted or replaced during inference are ignored.

The pinned [FaceAPI 1.7.15](https://github.com/vladmandic/face-api) no-bundle browser
entry shares TensorFlow 4.22 with the camera detector. Its WASM backend package is
required by the entry's imports, while this app uses WebGL with a CPU fallback.
The recognition module is loaded lazily. The three model manifest/binary pairs
(about 6.7 MiB) and upstream MIT license are included in
`public/models/face-api-1.7.15/`, copied from the package's `model/` directory.
Vite serves them under its configured base path, including on GitHub Pages; no
manual model download or external recognition service is needed. Keep the
manifests and binary files together when updating models. The upstream repository
is archived, so the dependency and model version are deliberately pinned.
See the [model pipeline](https://github.com/vladmandic/face-api/blob/master/TUTORIAL.md)
and [default matcher threshold](https://github.com/vladmandic/face-api/blob/master/src/globalApi/FaceMatcher.ts).

## Comparing voices locally

1. In **Reference voice**, record a clip of the known speaker or upload an audio file.
2. In **Test voice**, record or upload the voice to compare. Use clear speech from
   one speaker per clip, ideally 5–10 seconds. Recording stops automatically after
   10 seconds. Uploaded clips must be 3–15 seconds, at most two channels, no larger
   than 20 MB, and decodable by the browser.
3. Use the playback controls to check the clips, then select **Compare Voices**.
   Loading and analysis progress appears below the panels. **Cancel comparison**
   stops the worker; recordings remain available for another attempt.
4. The result is cosine similarity from −1 to 1. Higher values mean the speaker
   model finds the recordings more alike. This is an uncalibrated similarity,
   not an identity probability, authentication check, or same-person guarantee.
   Noise, microphones, languages, and changes in a person's voice can affect it.

Audio is decoded locally, mixed to mono, and resampled to 16 kHz using Web Audio.
A simple signal-energy check rejects silence and clips with too little audible
signal; it is not speech detection. A dedicated Web Worker runs the speaker
embedding model with ONNX Runtime Web's single-threaded WASM backend, which works
on static hosting without cross-origin isolation. Only static model/runtime files
are downloaded. Recordings and voice embeddings are never sent to a server or
written to browser storage; audio previews use temporary object URLs. Clearing,
re-recording, or leaving the page releases recordings and microphone resources.
The former speech-to-text panel has been replaced and no speech-recognition
service is used for this flow.

The first comparison downloads about 42 MB of model weights plus the WASM
runtime. Model weights are cached using the Cache API when browser storage allows;
only the model is stored. A blocked model download shows a retryable error.
The application bundle serves the version-matched runtime assets from its own
`assets/` directory, including when hosted under the GitHub Pages base path.

Model credit: [SpeechBrain ECAPA-TDNN](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb),
trained on VoxCeleb, and the [Equivl browser ONNX export](https://huggingface.co/Pawls2theWall/equivl-ecapa-voxceleb-onnx),
both licensed Apache-2.0. The export is pinned to revision
`4393ad2afd9af3621bcf602ac49e380c9de8306b`, file `model_fp16.onnx`.
See those model cards for license and attribution details. There is no fixed
same-speaker threshold; establish one using representative recordings before
making any application-specific classification.

## Validation

```sh
npm run lint
npm test
npm run build
```

`npm test` runs the Vitest suite once. Use `npm run test:watch` for watch mode.
The app tests mock camera/model work and browser recording/audio APIs; checking live
detection and microphone capture also requires a supported browser and camera/microphone access.

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

### Install as an app

Recognition Lab has a web app manifest, a stable installation identity, standalone
window mode, SVG/ICO favicons, Apple touch icon, and standard and maskable app
icons. In a supported browser, choose **Install app** in the header when offered,
or use the browser's install menu. On iPhone/iPad, use Safari's **Share → Add to
Home Screen**. The install button is hidden when installation is unavailable or
the app is already running in standalone mode.

Installation requires HTTPS in production (GitHub Pages provides it); localhost
also works for development. To verify the production service worker locally,
run `npm run build`, then `npm run preview` and open the printed URL.

The service worker manages its lifecycle and removes this app's old shell caches.
It does not intercept requests, cache pages, or provide an offline mode. Browser
model caches remain separate. Updates take effect after existing app windows are
closed and reopened, without interrupting microphone or camera sessions.

The existing `npm run deploy` command is a legacy alternative that writes to the
`gh-pages` branch. It requires Pages' **Deploy from a branch** source; use the
Actions workflow above for automatic publishing.
