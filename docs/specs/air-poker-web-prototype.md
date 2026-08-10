# Air Poker Web Prototype

## Status

Accepted for implementation on 2026-08-06. `air-poker.md` version 0.11 is the gameplay source of truth; this document records the implementation and product decisions resolved during discovery.

The discovery Q&A is intentionally not stored as a verbatim transcript. Confirmed decisions, completion criteria, exclusions, and rationale are distilled here so future work can rely on the current outcome without replaying the conversation.

## Goal

Deliver a complete, locally playable five-round Air Poker match against one fair medium-strength AI in a desktop browser. The prototype exists to validate target-number scheduling, timed hand construction, shared card-state planning, betting, BIOS pressure, conflicts, and explainable outcomes.

## Audience and platform

- Internal playtesting by the creator and a small group of testers.
- Traditional Chinese interface.
- Desktop-first browser application, designed at 1280×720 and usable down to 1024×768.
- Current stable desktop Chrome, Edge, Firefox, and Safari.

## Product flow

The main menu exposes Continue Match, New Match, Tutorial, Replay / Import, and Settings. The standalone five-part tutorial is recommended on first launch but may be skipped and replayed later. A player's first formal AI match enables the assistance described in `air-poker.md`; later matches default to Standard mode.

Match input is click- and keyboard-first. Drag-and-drop, controller input, and mobile layouts are out of scope. Suit and state information cannot rely on color alone, and interactive controls must expose visible focus and accessible names.

Timer presets are Standard, Relaxed, and Untimed. Match records store the selected preset. Timers pause while the page is hidden or closed and resume from the saved remaining time. AI calculation is immediate, but seeded short delays make its visible actions readable without exposing which side locked first.

The visual direction is a restrained science-fiction survival table built with Tailwind CSS, CSS effects, text, and programmatic card symbols. `BIOS` remains the prototype resource name. The prototype has no sound or music.

## Architecture

- React, TypeScript, Vite, Tailwind CSS, and npm.
- A pure deterministic TypeScript domain engine owns all rules. Its public seam is an initial state plus an explicit game event producing the next state and emitted effects.
- React renders projections of domain state and sends commands/events; components do not implement game rules.
- All entropy is derived from a match seed and recorded in an ordered event log.
- An exact solver runs through a Web Worker request/response seam and is shared by AI, tutorial hints, number-pack validation, and tests.
- The application is client-only. There are no accounts, remote APIs, or authoritative server in this version.

The architecture rationale is recorded in `docs/adr/0001-separate-deterministic-game-engine.md`.

## AI and content

The first version has one medium-strength AI. It only receives public match information plus its own private state. The solver may enumerate legal answers, but seeded heuristics choose among them using hand strength, future card value, collision risk, scheduling value, and a non-perfect betting personality. The AI never reads the player's hidden candidate or submission and does not deliberately produce malformed submissions.

An offline generator and validator produces an initial bank of approximately 30 fixed number packs. Every pack must pass the global-solvability constraint from `air-poker.md`. Pack choice, side assignment, timeouts, and AI choices are reproducible from the match seed.

## Local data, replay, and reports

- One active match is auto-saved on the device.
- Completed replays retain the latest 20 matches.
- Completed replays reveal both players' full selection trajectories, intermediate invalid submissions, and AI decisions.
- Match records can be imported and exported as versioned JSON.
- The results screen reports per-round BIOS changes, target-number order, validity rate, construction time, betting, bluffs, and conflicts.
- No telemetry leaves the browser.

## Test seams

1. **Game engine seam** — scenario events produce rules-correct state and effects, including timeout and settlement boundaries.
2. **Solver seam** — a request describing target number and card availability returns independently verifiable legal ranked hands.
3. **Repository seam** — active match, replay retention, JSON import, and JSON export behave through the public local repository interface.
4. **Player interaction seam** — accessible UI roles support number choice, card construction, locking, betting, reveal, settings, and navigation.
5. **Browser flow seam** — a player can complete tutorial and match flows, resume a saved match, and replay an imported record.

Vitest covers domain, solver, timing, AI, and repository behavior. Testing Library covers player-visible React behavior. Playwright covers critical flows in Chromium and smoke coverage in Firefox and WebKit.

## Completion criteria

- All items under “第一版可玩原型範圍／必須完成” in `air-poker.md` are playable.
- The menu, tutorial, settings, save/resume, result report, replay, and JSON import/export decisions above are implemented.
- The exact solver and the bundled number packs pass automated validation.
- Keyboard-only use can complete the primary match flow.
- Production build and automated checks pass.

## Explicitly out of scope

- Human multiplayer, accounts, backend services, ranking, and seasons.
- Mobile layout, controller input, and PWA installation.
- Sound, music, final branding, high-cost illustration, and character art.
- Character skills, relics, story, maps, and Roguelite progression.
