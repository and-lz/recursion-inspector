# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

VS Code extension (plain CommonJS JS, no build step) that adds a CodeLens "▶ Inspecionar recursão" over recursive JS functions and opens a webview with a step-by-step timeline/tree of the recursion. UI text, comments and test names are in Portuguese; keep that.

## Commands

- `npm run check` — lint + prettier check + tests (also the `.githooks/pre-commit`, installed by `npm install` via `prepare`).
- `npm test` — `node test/run-tests.js` (detection, instrumentation, child run). Runs as one script; no per-test filter, edit/comment out calls in its `main`.
- `node test/panel-smoke.js` — loads the `media/panel-*.js` scripts in a `vm` sandbox with fake DOM elements and drives the panel. **Not part of `npm test`/`check`**; it is also subject to the lint rules. At the time of writing it already fails at "cita a condição do caso base" (pre-existing).
- `npm run lint:fix`, `npm run format`.
- Debug: F5 with `.vscode/launch.json` (Extension Development Host).

Lint limits that bite: `max-lines` 300 per file (error; split files instead of compressing), `max-lines-per-function` 60, `complexity` 12, `max-depth` 3, `id-length` min 2 (no one-letter names).

`.claude/settings.json` has a Stop hook that packages/installs the `.vsix` and auto-commits + pushes everything ("Atualização automática ao fim do chat"), so the working tree is committed after each session.

## Architecture

Pipeline: **detect → instrument → run in child process → webview renders the trace**.

1. [src/detect.js](src/detect.js) (acorn) finds recursive functions, including mutual recursion cycles, and the "probes" to insert (conditions, locals, return expressions). [src/return-picks.js](src/return-picks.js) and [src/commented-calls.js](src/commented-calls.js) are helpers.
2. [src/instrument.js](src/instrument.js) rewrites the user's file by **inserting text only on the same line** (line numbers must not change — tests assert it). Each recursive function gets a wrapper calling `__call`; probes become `__var/__cond/__operand/__term/__pick/__final` calls that return the value they receive, so program behavior is unchanged. Edits are applied back to front with rank ordering for insertions at the same position.
3. [src/run.js](src/run.js) forks [src/child.js](src/child.js), which runs the instrumented code in `vm.runInNewContext` with limits (events, probes, 5s vm timeout, 10s hard kill in run.js). It records `events` (`c` call / `r` return / `t` throw), `probes`, stdout. [src/shape.js](src/shape.js) describes tree/list/matrix/graph arguments for the board drawing.
4. [extension.js](extension.js) wires the CodeLens, command and webview, with an LRU trace cache keyed by instrumented code, and injects the panel scripts into [media/panel.html](media/panel.html).

### Webview (media/)

`panel-*.js` are **classic scripts sharing one global scope**, concatenated by `PANEL_SCRIPTS` in [extension.js](extension.js) (order matters). The same list is duplicated in [test/panel-smoke.js](test/panel-smoke.js): a new media script must be added to both. Globals such as `state`, `elements` and `RETURN_ROLES` are declared in [media/panel-state.js](media/panel-state.js) / its siblings, not imported.

- `panel-state.js` builds the trace tree from events (`buildTrace`, `findRoots`, probe attachment); `panel-roles.js` classifies each node's return role (base / propagated / combined / memo / undefined / error), which drives edge-value colors and the legend.
- `panel-tree.js` / `panel-layout.js` create and position the SVG nodes/edges; `panel-render.js` applies per-step state classes. Rendering is incremental (only nodes touched between steps), and must equal a full redraw — `checkIncrementalRender` in the smoke test enforces it, so any new per-node class must be part of the cached class string.
- `panel-details.js`, `panel-inspector.js`, `panel-tooltip.js`, `panel-board.js`, `panel-summary.js` hold the explanation text, side panels, hover tooltips, argument-structure board and summary; `panel.js` is the entry point (messages, controls).
- Colors are CSS variables at the top of [media/panel.css](media/panel.css); legend chips live in `panel.html`.
