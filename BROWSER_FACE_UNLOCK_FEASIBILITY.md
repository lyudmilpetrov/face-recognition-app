# Browser-only face enrollment and information unlocking

Date: 2026-11-01  
Status: Feasibility proposal with an implemented local prototype, described below.

## Implementation status

The project now has sidebar pages for Face Comparison, Voice Comparison, Voice
Translation, Lock / Unlock, and Fingerprint Reading. The original feasibility
discussion below remains useful as the design rationale; references to the
previous two-camera interface describe the baseline before this implementation.

Implemented in [FaceLock.jsx](./src/Components/FaceLock.jsx) and
[faceVault.js](./src/services/faceVault.js):

- Ten-sample face enrollment plus three fresh confirmation captures.
- Passphrase-protected AES-GCM encryption of a local note and its face template.
- Three-sample face verification after passphrase entry; full lock on navigation,
  page hiding, or five minutes of inactivity, with stale async results rejected.
- Encrypted IndexedDB persistence, backup download/import, explicit passphrase
  recovery, re-enrollment, and confirmed local deletion.

The face decision is an uncalibrated demonstration with no liveness detection.
The passphrase protects the key; face matching supplies an additional interface
check. Recovery intentionally bypasses that check and requires re-enrollment
before editing. The separate WebAuthn page demonstrates device authentication;
PRF-based vault unlocking and server-account authorization are not implemented.
The translation page uses supported local browser APIs without a remote fallback.
See [README.md](./README.md) for usage and browser requirements.

## Is it possible?

**Yes.** A web application can use the camera and TensorFlow.js to learn reference features of your face, then compare a fresh camera capture with those references. Face processing can run entirely in the browser, without uploading photographs or using a recognition backend.

For this project, the practical approach is **face enrollment with an existing pretrained recognition model**. Training a new recognition network from scratch is unnecessary. A separate decision is how to protect the information: a face match can control the interface, but secure storage needs encryption and an independently protected key.

Assumptions for this proposal: one person enrolls on a trusted device, the initial target is information stored locally in that browser, and the application is served over HTTPS or localhost. A static host can serve the application and model files; no custom backend is needed for the local prototype. Browser-only processing does not automatically mean offline availability: that requires explicitly caching the application, models, and runtime assets.

| Goal | Feasible in the browser? | Practical limit |
| --- | --- | --- |
| Enroll your face and recognize it later | Yes | Recognition accuracy and spoof resistance need evaluation. |
| Hide and reveal a panel after a face match | Yes | This is a convenience feature; browser code can be modified. |
| Keep local information encrypted between visits | Yes | Decryption needs a protected secret or authenticator, beyond a JavaScript face-match result. |
| Use device biometrics through WebAuthn | On supported devices | The operating system controls enrollment and verification; the site cannot require a particular face modality. |
| Authorize access to a server account using only a client-side match | No | The server must independently verify authentication and enforce permissions. |

## What the project already provides

These observations describe the baseline working tree before the prototype above.

| Existing file | Reusable behavior |
| --- | --- |
| [package.json](./package.json) | Includes TensorFlow.js 4.22 and the pinned `@vladmandic/face-api` 1.7.15 package. |
| [src/Components/FaceRecognitionBlaze.jsx](./src/Components/FaceRecognitionBlaze.jsx) | Camera access, live face detection, clean frame capture, WebGL/CPU execution, and camera cleanup. |
| [src/services/faceComparison.js](./src/services/faceComparison.js) | Detects exactly one face, aligns it, extracts a 128-value descriptor, and compares descriptors with Euclidean distance. |
| [src/App.jsx](./src/App.jsx) | Two-image comparison interface, pending/error handling, duplicate-call prevention, and stale-result handling. |
| [public/models/face-api-1.7.15/](./public/models/face-api-1.7.15/) | Locally served detection, landmark, and recognition model assets. |

BlazeFace finds faces; the recognition model supplies the identity-related features. Bounding-box position or size should not be used to recognize a person.

The current face flow keeps photographs and descriptors transient. It has no face enrollment, persistent face template, liveness check, encrypted vault, or lock/unlock feature. Its descriptor-extraction function is private, and `compareFaceImages()` returns only the distance, threshold, and match result. Enrollment would require a deliberate extension of that service API.

The current comparison uses `distance < 0.6`. This is an uncalibrated demo threshold, not an authentication guarantee or an identity probability. A multi-reference enrollment method must be evaluated separately rather than inheriting that threshold unchanged.

## What “training the application to know my face” means

There are two different approaches:

1. **Enrollment, recommended here:** keep the recognition model unchanged and save several descriptors extracted from your face. Future captures are compared with that reference set. Re-enrollment changes the personal reference data, not the network weights.
2. **Actual training:** use TensorFlow.js to train a small classifier on top of a pretrained model. This is technically possible in the browser, but needs representative training and evaluation data, including other people. A classifier trained only on “me” examples does not demonstrate reliable rejection of everyone else. TensorFlow describes reusing a pretrained model in its [transfer-learning guide](https://www.tensorflow.org/js/tutorials/transfer/what_is_transfer_learning).

For a single-person unlock experiment, enrollment is simpler and fits the existing service. Actual training should be a later experiment with measured benefits. Do not silently update the template after successful matches; a mistaken acceptance could gradually teach it the wrong person.

## Proposed enrollment and verification process

### 1. Enroll explicitly

- Explain what will be captured, where reference data will be kept, and how to delete it. Require an explicit enrollment action.
- Request camera permission and guide the user to show exactly one clear face. Camera access needs permission and a secure context; use HTTPS in deployment and localhost for development. See [camera API requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- Capture a small set of distinct, good-quality samples across modest pose and lighting changes. Around 10–20 samples is an initial prototype parameter, not an established accuracy requirement. Avoid many nearly identical adjacent frames.
- Extract a descriptor from each accepted sample. Reject missing/multiple faces, invalid vectors, and visibly poor captures. Blur, lighting, pose, and sample-consistency checks would be new work.
- Confirm enrollment with fresh captures not used to build the reference set. Save the model version, preprocessing version, descriptor shape, and enrollment metadata with the template.
- Protect replacement of an existing enrollment with the vault's independent credential. A reset must not let someone substitute their face and gain access to existing encrypted information.

For the first prototype, keep the template only in memory. Persistence is a separate stage described below.

### 2. Verify a fresh capture

- Start from a locked interface and begin verification only after the user chooses **Unlock**.
- Capture a short sequence with exactly one usable face per evaluated frame, then extract descriptors using the same model and preprocessing as enrollment.
- Choose one scoring rule, such as the mean Euclidean distance from a fresh descriptor to the retained reference descriptors. Calibrate that complete rule using separate genuine-user and other-person captures. Keep the model's expected metric; do not invent a percentage from the distance.
- Require consistent results over several fresh captures before accepting. This can improve stability, but does not establish liveness or make correlated frames independent security evidence.
- On a mismatch, camera failure, model error, or cancellation, keep the interface locked and offer a clear retry or independent recovery method. Block duplicate requests and ignore results from cancelled or superseded attempts.

### 3. Lock again

Provide a visible **Lock** action and a defined inactivity policy. Cancel pending verification, invalidate late results, stop camera tracks, and remove revealed information when locking. For an encrypted vault, also discard references to the decryption key and plaintext. JavaScript garbage collection does not guarantee immediate secure erasure.

Keeping the key in memory for quick face-only re-entry is a convenience lock for that session. A full lock that releases the key requires the independent credential again on the next unlock.

## What “locking information” must protect

### Option A: a demonstration with non-sensitive content

The application can conditionally render a panel after a successful face comparison. Use this to test enrollment, recognition, and the interaction. Keep face references in memory and demonstrate with placeholder content.

A hidden panel, route guard, or `isUnlocked` state does not protect plaintext already present in the bundle, application state, browser storage, or a downloaded response. Someone who controls the browser can bypass that condition.

### Option B: a browser-only encrypted local vault

For private notes or files, the recommended design is an encrypted vault with a separately protected key. This is a proposed architecture, not an implemented security claim:

1. Generate a random data-encryption key and encrypt the content with authenticated encryption such as AES-GCM. Use a fresh, unique IV for every encryption under that key.
2. Protect the data key with a key derived from a strong user passphrase, or a supported authenticator mechanism. Web Crypto provides PBKDF2 for passphrase stretching and HKDF for deriving keys from high-entropy material such as PRF output; HKDF alone is unsuitable for passwords. Select and benchmark derivation parameters during implementation. Do not use a short PIN as the sole protection against offline guessing. See the [Web Cryptography specification](https://www.w3.org/TR/webcrypto-1/).
3. Persist ciphertext, the protected data key, IVs, salts, and versioned metadata in IndexedDB. Do not persist the passphrase, an unprotected data key, or plaintext content.
4. If face templates must persist, encrypt them under the same independent protection. This means the passphrase or authenticator must first release the key before the application can read the template and perform the custom face comparison.
5. Reveal the content after the required checks, and release key/plaintext references on full lock. Provide an encrypted backup and a separate recovery method before relying on the vault for valuable information.

This ordering is intentional: the custom TensorFlow face match is an additional interface check. The independent secret or authenticator supplies the cryptographic protection. Encrypting a template does not make it possible to compare it before obtaining its decryption key.

Do not derive a key by hashing a face descriptor. Captures produce slightly different vectors, and a face is observable rather than a password-like secret. Saving a readable key beside the template and releasing it after `isMatch` would still allow the check to be bypassed.

Encryption protects stored ciphertext when the key is unavailable. Malicious same-origin JavaScript, a compromised dependency, or a compromised device can access information during an unlocked session. The proposed design assumes trusted application delivery and a trusted device.

### Option C: device biometrics through WebAuthn

If the main goal is secure, convenient unlocking, evaluate WebAuthn/passkeys instead of building the primary authentication mechanism from camera frames. The authenticator handles user verification and keeps its biometric data away from the website. Request `userVerification: "required"`, but expect the device to choose an available method, which can include a PIN or fingerprint. The site does not enroll the operating system's face model or force face-only verification. See [WebAuthn user verification and biometric privacy](https://www.w3.org/TR/webauthn-3/#sctn-authenticator-biometrics).

Ordinary WebAuthn signatures do not automatically provide a vault decryption key. Where supported, the **PRF extension** can supply credential-bound output for deriving a key that protects the vault's data key. Feature-detect it and verify the actual extension result; ordinary passkey support does not imply PRF support. Provide independent recovery when the credential or required capability is unavailable. See [WebAuthn extensions: PRF](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions#prf).

A local PRF-based vault can be designed without a custom application backend, subject to browser/authenticator behavior. A remote account still needs a trusted server to validate fresh WebAuthn assertions and enforce authorization. This project's proposed local vault does not replace that server responsibility.

## Recognition, spoofing, and privacy limits

Face matching is probabilistic. Evaluate false acceptances and false rejections across relevant people, cameras, lighting, glasses, facial-hair changes, and time between sessions. Measure performance with held-out captures; neighboring frames from one recording are insufficient evidence.

The current project has no spoof detection. Photos, replayed videos, and injected or virtual-camera streams are relevant attacks. A randomized blink or head-turn challenge may deter a simple static photograph, but does not establish resistance to replay, deepfakes, or injected frames. NIST explains why biometrics are not secrets and why presentation-attack defenses and additional factors matter in [its biometric authentication guidance](https://pages.nist.gov/800-63-4/sp800-63b.html). This proposal does not establish compliance with that guidance.

Treat descriptors as sensitive biometric data even though they are not photographs. Retain only what is necessary, avoid storing raw captures, and keep templates out of logs, URLs, analytics, `localStorage`, and `sessionStorage`. Offer deletion and authenticated re-enrollment. Local attempt delays may discourage casual retries but can be reset by someone controlling the browser.

IndexedDB is local storage, not a backup or hardware security boundary. Its data is scoped to an origin and browser profile; it does not automatically follow the user to another browser or device. Clearing site data, private browsing, storage eviction, or changing the deployment origin can remove access. Handle unavailable storage and failed writes explicitly. See [browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

TensorFlow.js can also [save compatible models in IndexedDB](https://www.tensorflow.org/js/guide/save_load), but its ordinary model-saving API does not encrypt personal training data or model weights. Enrollment descriptors are application records, not a newly trained TensorFlow model, and need their own storage/protection design.

## Suggested implementation stages

1. **Session-only proof of concept:** extend the existing face service with a reusable single-image descriptor operation; add enrollment, verification, and lock controls using placeholder information. Preserve current capture cleanup and stale-result handling. Add no biometric persistence.
2. **Recognition evaluation:** collect consented, representative test captures, choose a multi-reference scoring rule, measure genuine/impostor results, and document the chosen threshold. Treat spoof testing separately from ordinary recognition accuracy.
3. **Local vault:** implement Web Crypto key management, encrypted IndexedDB records, full lock behavior, encrypted backup/recovery, and authenticated re-enrollment. A cold start requires the independent key-unlock method.
4. **Authenticator integration:** evaluate WebAuthn and PRF on target browser/device combinations. Keep a documented fallback and recovery path. Add a backend only if remote authentication or shared/server data becomes part of the goal.

New components and services should follow the existing React, Tailwind, and service-module patterns. Keep camera/model work out of render, handle loading/empty/error states, and avoid adding another state-management or UI library.

## Validation for a future implementation

Use the existing npm lockfile and scripts. Start with the relevant face tests, then run lint, the full suite, and a production build when application code is changed:

```sh
npm test -- src/services/faceComparison.test.js src/Components/FaceRecognitionBlaze.test.jsx src/App.test.jsx
npm run lint
npm test
npm run build
```

Add meaningful coverage for cancelled enrollment/verification, stale results after locking, failed storage writes, wrong credentials, tampered ciphertext, template/model-version mismatches, and recovery. Mocked camera/model tests verify application behavior; real-device testing is required for recognition performance, camera permissions, spoof resistance, and WebAuthn/PRF support.

The implementation adds coverage for encryption, storage, enrollment, lock/cancel
behavior, recovery, navigation, local speech/translation, and device assertions.
Run the validation commands above when changing these flows. Mocked models and
authenticators do not establish real-world biometric accuracy or spoof resistance.
