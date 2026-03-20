# epermits-mobile.client/AGENTS.md

Directory-specific instructions for Codex and other coding agents working in the frontend application.

This file applies to work under `epermits-mobile.client/` and is intended to layer on top of the repository root `AGENTS.md`. Follow the root file first, then use the more specific rules below for React, Tailwind, and CSS work.

## Scope

This area contains the **React frontend** styled with **Tailwind CSS** and local CSS files.

Primary goals in this directory:

- keep UI changes small, predictable, and reviewable
- preserve the existing component, routing, and state patterns
- keep rendering logic simple and pure
- maintain accessibility, responsiveness, and visual consistency
- avoid introducing frontend security risks while implementing features quickly

## Start here before editing

Inspect the nearest relevant files first instead of guessing project structure.

Prioritize these files when present:

- `package.json`
- lockfile (`pnpm-lock.yaml`, `yarn.lock`, or `package-lock.json`)
- `src/main.*`, `src/index.*`, `src/App.*`
- router setup
- shared API client / service modules
- shared hooks
- shared UI component folders
- `tailwind.config.*`
- `postcss.config.*`
- CSS entry files and any design-token files
- ESLint / TypeScript / test configuration

Before making changes, identify:

1. the screen, route, or component entry point
2. the existing API/data-fetching pattern
3. the nearest reusable component or hook
4. the validation commands for this frontend app

## React engineering rules

- Use function components and Hooks.
- Call Hooks only at the top level of function components or custom hooks.
- Never call Hooks conditionally, in loops, in nested functions, in event handlers, or inside `try/catch/finally` blocks.
- Keep render logic pure and deterministic.
- Do not call known impure APIs during render when that changes output unpredictably, such as `Date.now()`, `new Date()`, `Math.random()`, or `crypto.randomUUID()`.
- Do not set state during render.
- Do not mutate props, state, context values, hook arguments, or cached query data directly.
- Prefer derived values over duplicating state.
- Keep state local unless multiple parts of the app truly need a shared source of truth.
- Reuse the existing state-management approach already used in this codebase. Do not introduce a new global state library or pattern without explicit need.
- Prefer composition and smaller focused components over large monolithic components.
- Extract custom hooks only when logic is reused or meaningfully simplified.
- Preserve existing error-boundary, suspense, lazy-loading, and routing patterns where present.

## Data fetching and API usage

- Use the existing API client, service layer, query hooks, or request wrapper already used by the app.
- Do not fetch directly inside random components if the codebase already centralizes API access.
- Keep request and response shapes aligned with backend DTOs and existing frontend contract types.
- Handle loading, success, empty, and error states for user-facing async flows.
- Prevent duplicate submissions for mutating actions when the UI already has a pattern for pending state.
- Preserve existing retry, caching, invalidation, and cancellation patterns.
- Do not silently swallow API errors.
- Keep user-facing error messages safe and clear; do not expose raw server internals.

## Forms and user input

- Use the form approach already present in the app.
- Keep client-side validation for UX, but never assume it provides security.
- Normalize and trim input only when consistent with nearby code and API expectations.
- Preserve existing validation messages and field-level error display patterns.
- For destructive actions, preserve confirmation and safety affordances already used by the UI.

## Tailwind and CSS rules

- Reuse existing design tokens, spacing scales, typography, breakpoints, color usage, and layout conventions.
- Prefer existing shared components before building one-off styling from scratch.
- Prefer Tailwind utilities over inline styles when the project is already Tailwind-first.
- Use local CSS only when Tailwind is not the right fit or when the repo already uses CSS modules / scoped CSS / shared stylesheet patterns for that case.
- Avoid arbitrary values unless there is a strong design reason and no existing token covers the need.
- Avoid overly long duplicated class strings when an existing helper, component abstraction, or variant pattern already exists.
- Keep responsive behavior intentional; check mobile, tablet, and desktop impacts when changing layout-heavy components.
- Preserve dark-mode, theme, and motion-reduction support if the app already supports them.
- Do not introduce a new component library or styling system unless explicitly requested.

## Accessibility rules

- Prefer semantic HTML over div-heavy structures.
- Use correct button types.
- Preserve visible labels, keyboard access, focus states, and meaningful control names.
- Use ARIA only when native HTML semantics do not solve the problem.
- Keep forms, dialogs, dropdowns, tables, and navigation keyboard-usable.
- Do not remove accessible names, alt text, or focus management without replacing them appropriately.

## Frontend security and safety rules

- Never hardcode secrets, API keys, tokens, connection strings, or environment-specific credentials in frontend source.
- Treat all data from APIs, query params, browser storage, and user input as untrusted.
- Do not introduce `dangerouslySetInnerHTML` unless the task explicitly requires it and the content is sanitized through an approved, existing sanitization path.
- Do not introduce new storage of access tokens, refresh tokens, secrets, or sensitive personal data in `localStorage`, `sessionStorage`, URLs, or logs.
- Do not expose stack traces, raw exception objects, internal IDs, or backend implementation details in the UI.
- Do not rely on hidden fields, disabled buttons, route guards, or client-side checks as the only enforcement for authorization.
- Preserve existing auth flows, protected routes, and permission checks.
- Do not bypass auth, feature flags, tenant checks, or role-based UI guards for convenience.
- Encode or safely construct route params, query-string values, and external links.
- Use `rel="noopener noreferrer"` for new external links opened with `target="_blank"`.
- Do not trust file names, file types, or file sizes from the browser without corresponding backend validation.
- Avoid logging PII, tokens, secrets, full payloads, or raw auth objects to the browser console.

## Performance rules

- Avoid premature optimization, but do not introduce obvious unnecessary re-renders.
- Preserve existing memoization patterns only when they are useful and correct.
- Do not add `useMemo` or `useCallback` everywhere by default.
- Avoid large synchronous computations inside render.
- Use virtualization or pagination patterns already present in the app for large lists.
- Keep bundle impact small; do not add dependencies for problems already solved in the repo.

## Testing and validation

Use the package manager implied by the lockfile.

Typical validation for this directory:

- install: `pnpm install` / `yarn` / `npm ci`
- lint: `pnpm lint` / `yarn lint` / `npm run lint`
- test: `pnpm test` / `yarn test` / `npm run test`
- build: `pnpm build` / `yarn build` / `npm run build`

Validation expectations:

- Run lint for frontend code changes.
- Run the smallest relevant test scope first, then broader validation if needed.
- Run a production build for changes that affect types, bundling, routes, environment usage, or styling pipelines.
- If a change affects API contracts, auth flows, or shared DTO assumptions, verify the backend side as well.
- If a command cannot be run, state exactly which command was skipped and why.

## Restrictions

- Do not perform broad visual redesigns unless explicitly requested.
- Do not rename or move shared components without a task-specific reason.
- Do not introduce a new state library, form library, validation library, router, or CSS framework without explicit approval.
- Do not suppress lint or TypeScript errors with `eslint-disable`, `@ts-ignore`, or `any` unless unavoidable and explained.
- Do not remove loading, empty, or error states to simplify the implementation.
- Do not weaken auth UX or permission-based UI handling to make a task pass.

## Done criteria for frontend work

Frontend work is complete only when all of the following are true:

- the requested behavior is implemented
- the change matches existing React, Tailwind, and CSS conventions
- UI states for async work are handled appropriately
- relevant lint/tests/build commands have been run
- no new obvious accessibility regressions were introduced
- no secrets, unsafe HTML paths, or unsafe token handling were added
- the final summary lists changed files, behavior changes, validation run, and any assumptions
