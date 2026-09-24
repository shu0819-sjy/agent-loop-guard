# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-25

Initial release. Extracted from a production agent anti-loop setup and
generalized into a host-agnostic, zero-dependency library.

### Added — text layer (anti-repetition)

- Six detectors evaluated in fixed order over a tail window
  (`windowChars`, default 1600), first hit wins:
  - `consecutive` — exact trailing unit repeats (`minRepeats: 3`).
  - `line` — identical consecutive non-empty lines (`minLineRepeats: 3`).
  - `norm-stem` — Unicode-aware normalized stem dominance
    (`minStemHits: 12`, `minStemShare: 0.35`), catches variation spam.
  - `char-split` — one-char-per-line / single-char token collapse
    (`minSingleCharLines: 40`, `minSingleCharShare: 0.3`).
  - `broken-shell` — shattered shell drafts: lone `$`, `$`+newline+identifier,
    orphaned cmdlet verbs, assignment shatter (weighted, `minBrokenShellHits: 8`).
  - `density` — non-adjacent multi-word phrase density (**default off**).
  - `unique-ratio` — low unique 4-gram ratio (**default off**).
- Strict mode for reasoning / thinking streams (skips `density` and
  `unique-ratio`).
- Length gate: short texts are never evaluated.
- API: `findRepetitionLoop`, `createRepetitionGuard` (`push` / `snapshot` /
  `reset`), `normalizeStems`.
- Streaming guard `guardAsyncIterable` over neutral `GuardChunk`s with
  throttled checking (`checkEveryChars`, default 12), dual text/reasoning
  channels, upstream teardown on trip, and a synthetic
  `{ type: "end", reason: "aborted", detail: hit }` terminal chunk; distinct
  `incomplete` reason when upstream ends without a finish.
- Configurable English default notice; `appendNotice` on by default.

### Added — tool layer (loop hard kill)

- `createToolLoopGuard` with pre-execute deny:
  - Key-order-independent argument canonicalization
    (`canonicalizeToolArgs` / `sortJsonValue`).
  - Identical-call chain deny at `killIdenticalAt` (default 4, floor 2) with
    an actionable English reason.
  - Optional same-tool-name sliding window (`killSameToolAt`, default 0 =
    disabled; `sameToolWindow` default 10).
  - `include` / `exclude` wildcard lists (default exclude: `todo_write`);
    excluded tools are fully ignored.
  - `resetOnUserMessage()` for cross-turn legitimate repeats; `reset()` hard
    clear.

### Added — configuration & utilities

- `DEFAULT_REPETITION_CONFIG`, `DEFAULT_TOOL_LOOP_CONFIG`, `DEFAULT_CONFIG`,
  `DEFAULT_NOTICE_TEXT` (frozen, model-agnostic: `samplingModels: []`,
  `injectSamplingParams: false`, no vendor/model ids).
- `resolveRepetitionConfig` / `resolveToolLoopConfig` with validation floors
  and clamping.
- `wildcardMatch` / `wildcardToRegExp` glob helpers.

### Added — packaging & docs

- Zero runtime dependencies; Node >= 18; ESM-only with TypeScript
  declarations and source maps; `files` whitelist with `prepack` build.
- Examples: `examples/openai-loop.mjs` (OpenAI-compatible streaming + tool
  loop, offline dry-run mode) and `examples/plugin-host.ts` (sanitized
  plugin-host wiring sketch).
- Documentation: `README.md` (EN), `README.zh-CN.md` (中文), `docs/SPEC.md`
  (full algorithm specification), `docs/INTEGRATION.md` (three host wiring
  patterns + optional sampling injection), `docs/SANITIZATION.md` (privacy
  checklist), `docs/PUSH_GUIDE.md` (GitHub/npm publishing).
- `CONTRIBUTING.md`, `SECURITY.md`, MIT `LICENSE`
  (© agent-loop-guard contributors).
- Vitest test suite and GitHub Actions CI (Node 18 / 20 / 22).

[0.1.0]: https://github.com/shu0819-sjy/agent-loop-guard/releases/tag/v0.1.0
