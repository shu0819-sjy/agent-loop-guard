# agent-loop-guard

**Hard-trip guards against repetition loops and tool-call thrash in LLM agents.**

`agent-loop-guard` is a zero-runtime-dependency TypeScript library that stops two
failure modes every long-running LLM agent eventually hits:

1. **Text repetition / collapse** — the model emits `abcabcabc…`, spams the same
   line, or collapses into shattered drafts (one character per line, broken shell
   fragments) before an obvious loop even forms.
2. **Tool-call thrash** — the agent retries the same tool with the same
   arguments over and over instead of changing approach.

Unlike "reminder-only" plugins that append a warning and let generation continue,
`agent-loop-guard` **hard-trips**: it stops the stream before execution and denies
tool calls *before* they run, with a structured reason you can feed back to the
model.

> Extracted from a production agent setup, rewritten as a host-agnostic library.
> No model-family, host, or environment bindings ship as defaults.

```text
Zero runtime dependencies · Node >= 18 · ESM · TypeScript strict · MIT
```

---

## Why

| Failure mode | Layer | Symptom | What the guard does |
|---|---|---|---|
| Text repetition / collapse | Model output stream | Short phrases, lines, or stems repeat; one-char-per-line collapse; broken shell drafts | Streaming detectors trip, stop the stream, optionally append a visible notice |
| Tool-call thrash | Tool dispatch | Same tool + same args hammered (key order shuffled to dodge naive checks) | Pre-execute deny with an actionable reason; optional same-name sliding-window kill |

Reminder-only approaches do not stop execution — the model keeps burning tokens
and the user keeps staring at a spinner. `agent-loop-guard` treats both layers as
circuit breakers: detect, stop, explain, and let the host decide what "resume"
means (see [Optional: resume policy](#optional-resume-policy)).

## Install

```bash
npm install agent-loop-guard
```

Requires **Node >= 18**. The package ships ESM only (`"type": "module"`), with
TypeScript declarations, source maps, and no runtime dependencies.

```js
import {
  findRepetitionLoop,
  createRepetitionGuard,
  createToolLoopGuard,
  guardAsyncIterable,
} from "agent-loop-guard";
```

## Quickstart (5 minutes)

### 1. Detect a loop in a complete string

```js
import { findRepetitionLoop } from "agent-loop-guard";

const hit = findRepetitionLoop("Error: retry Error: retry Error: retry");
if (hit) {
  console.log(hit);
  // { kind: "consecutive", unit: "Error: retry", repeats: 3 }
}
```

### 2. Guard a streaming response

```js
import { createRepetitionGuard } from "agent-loop-guard";

const guard = createRepetitionGuard(); // defaults: model-agnostic, notice on

for await (const delta of tokenStream) {
  const hit = guard.push(delta);
  if (hit) {
    // Throttled internal check fired: stop consuming, show the notice.
    console.warn(`loop detected: ${hit.kind} × ${hit.repeats}`);
    break;
  }
  process.stdout.write(delta);
}
```

`push()` accumulates text and runs the detector only every `checkEveryChars`
characters (default `12`), so per-token overhead stays negligible. The same
guard can watch a reasoning/thinking stream — pass `{ strict: true }` there, or
use `guardAsyncIterable` which maintains both automatically.

### 3. Hard-kill a tool loop (OpenAI-compatible agents)

```js
import { createToolLoopGuard } from "agent-loop-guard";

const toolGuard = createToolLoopGuard({ killIdenticalAt: 4 });

async function runTool(name, args) {
  const verdict = toolGuard.check(name, args);
  if (!verdict.allowed) {
    // Feed the reason back as the tool result; the model is told to
    // change arguments, change approach, or finish — not to repeat.
    return { role: "tool", name, content: verdict.reason };
  }
  return executeTool(name, args); // your dispatcher
}

// On every new user-authored message:
toolGuard.resetOnUserMessage();
```

`check()` canonicalizes arguments first, so `{"city":"Paris","unit":"c"}` and
`{"unit":"c","city":"Paris"}` count as the **same** call — key order shuffling
does not evade the guard.

A complete runnable agent loop (streaming + tools) lives in
[`examples/openai-loop.mjs`](examples/openai-loop.mjs); a sanitized plugin-host
mapping sketch lives in [`examples/plugin-host.ts`](examples/plugin-host.ts).

## Public API

| Export | Kind | Purpose |
|---|---|---|
| `findRepetitionLoop(text, options?)` | pure function | Offline detection over a complete string |
| `createRepetitionGuard(options?)` | factory | Streaming guard: `push(delta)` / `snapshot()` / `reset()` |
| `createToolLoopGuard(config?)` | factory | Pre-execute guard: `check(name, args)` / `resetOnUserMessage()` / `reset()` |
| `guardAsyncIterable(source, guard, options?)` | async generator | Wraps an async-iterable of neutral chunks; trips with `{ type: "end", reason: "aborted", detail: hit }` |
| `DEFAULT_REPETITION_CONFIG` / `DEFAULT_TOOL_LOOP_CONFIG` / `DEFAULT_CONFIG` / `DEFAULT_NOTICE_TEXT` | consts | Frozen model-agnostic defaults |
| `resolveRepetitionConfig(partial?)` / `resolveToolLoopConfig(partial?)` | functions | Merge partial overrides onto defaults with validation floors |
| `normalizeStems(text)` | pure function | Unicode-aware stem normalization used by the `norm-stem` detector |
| `wildcardMatch(value, patterns)` / `wildcardToRegExp(pattern)` | utilities | Simple `*` glob matching (case-insensitive / case-sensitive) |
| `canonicalizeToolArgs(args)` / `sortJsonValue(value)` | utilities | Stable, key-order-independent JSON canonicalization |

The neutral chunk shape for streaming hosts:

```ts
type GuardChunk =
  | { type: "delta"; channel: "text" | "reasoning"; text: string }
  | { type: "end"; reason?: "stop" | "aborted" | "incomplete"; detail?: unknown };
```

Adapters map host-specific events onto this shape; the core never assumes a
particular block protocol. See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for
three wiring patterns.

## Text-layer detectors

All detectors evaluate a **tail window** of the accumulated text
(`windowChars`, default `1600`) in a fixed order; the first hit wins. A hit
looks like `{ kind, unit, repeats, share? }`.

| # | `kind` | Catches | Default | Key thresholds |
|---|---|---|---|---|
| 1 | `consecutive` | Exact trailing unit repeats (`abcabcabc`) | on | `minRepeats: 3`, `minUnitLen: 5`, `maxUnitLen: 96` |
| 2 | `line` | Identical consecutive non-empty lines | on | `minLineRepeats: 3` |
| 3 | `norm-stem` | Variation spam — punctuation/asides change, stem stays (`Emit — GO`, `Emit (Write it!)`) | on | `minStemHits: 12`, `minStemShare: 0.35` |
| 4 | `char-split` | Early collapse: one char per line / single-char token shreds | on | `minSingleCharLines: 40`, `minSingleCharShare: 0.3` |
| 5 | `broken-shell` | Shattered shell drafts: lone `$`, `$`+newline+identifier, orphaned cmdlet verbs | on | `minBrokenShellHits: 8` (weighted scoring) |
| 6 | `density` | Same multi-word phrase many times, non-adjacent | **off** | `minDensityHits: 8`, `densityMinLen: 20` |
| 7 | `unique-ratio` | Very low unique 4-gram ratio (low diversity) | **off** | `minUniqueRatio: 0.12`, `uniqueMinChars: 200` |

**Strict mode** (for reasoning / thinking streams) runs detectors 1–5 only.
Density and unique-ratio are skipped because long technical reasoning reuses
API names and identifiers without being a loop.

**Length gate:** text shorter than `minUnitLen * min(minRepeats, 3)` characters
is never evaluated, so short legitimate outputs are free.

## Tool-loop guard behavior

- **Canonicalization** — arguments are serialized with recursively sorted keys;
  the identity key is `JSON.stringify([toolName, canonicalArgs])`.
- **Identical-call chain** — the *same* call (tool + canonical args) repeated
  `killIdenticalAt` times (default `4`, minimum allowed `2`) is denied
  **before execution** with a reason that names the tool, the count, the
  threshold, and the instruction to change approach or finish.
- **Same-name window (optional)** — `killSameToolAt > 0` enables a sliding
  window (`sameToolWindow`, default `10`) over tracked tool names; hitting the
  threshold denies with `kind: "same-tool"`. Suggested ops range: `6–8` with
  window `10`. Default `0` = disabled.
- **Include / exclude wildcards** — `include: []` tracks everything; `exclude`
  (default `["todo_write"]`) tools are ignored entirely: never counted, and
  they do not break an identical chain.
- **Reset policy** — `resetOnUserMessage()` clears the identical chain and the
  name window for cross-turn legitimate repeats. The model merely speaking or
  a tool returning does **not** reset state.

## Configuration defaults

Both configs are frozen objects; pass partial overrides to the factories and
`resolve*Config` applies validation floors (e.g. `minRepeats >= 2`,
`killIdenticalAt >= 2`, `checkEveryChars >= 4`, `windowChars >= 64`).

### Repetition (`DEFAULT_REPETITION_CONFIG`)

| Key | Default | Notes |
|---|---|---|
| `models` | `["*"]` | Model id globs this guard applies to; empty also means all |
| `samplingModels` | `[]` | Globs for optional sampling-param injection; **empty = inject nothing** |
| `minRepeats` | `3` | Inclusive repeat count for `consecutive` |
| `minUnitLen` | `5` | Smallest unit length considered |
| `maxUnitLen` | `96` | Search cost cap |
| `checkEveryChars` | `12` | Streaming throttle: run detector every N chars |
| `windowChars` | `1600` | Tail window size |
| `minLineRepeats` | `3` | `line` detector threshold |
| `enableNormStem` | `true` | `norm-stem` detector switch |
| `minStemHits` | `12` | Absolute stem count floor |
| `minStemShare` | `0.35` | Relative dominance floor (0–1) |
| `minStemLen` / `maxStemLen` | `3` / `24` | Token length band |
| `enableCollapseDetect` | `true` | Gates `char-split` + `broken-shell` |
| `minSingleCharLines` | `40` | Absolute floor for `char-split` |
| `minSingleCharShare` | `0.3` | Share floor for `char-split` |
| `minBrokenShellHits` | `8` | Weighted score threshold |
| `enableDensity` | `false` | Off by default (false positives on technical prose) |
| `minDensityHits` | `8` | |
| `densityMinLen` | `20` | Prefer multi-word phrases |
| `enableUniqueRatio` | `false` | Off by default (coherent thinking can look "low diversity") |
| `minUniqueRatio` | `0.12` | |
| `uniqueMinChars` | `200` | |
| `appendNotice` | `true` | Append visible notice on trip (in `guardAsyncIterable`-style integrations) |
| `noticeText` | see below | Configurable; inject `kind=<kind>×<repeats>` for operators |
| `watchReasoning` | `true` | `guardAsyncIterable` also scans reasoning deltas (strict mode) |
| `injectSamplingParams` | `false` | Core never patches `fetch`; hosts opt in explicitly |
| `frequencyPenalty` | `0.55` | Used only if a host implements injection |
| `presencePenalty` | `0.4` | Used only if a host implements injection |

Default notice:

```text
\n\n[agent-loop-guard: repetition loop detected; generation stopped. Reply "continue" to resume.]
```

### Tool loop (`DEFAULT_TOOL_LOOP_CONFIG`)

| Key | Default | Notes |
|---|---|---|
| `killIdenticalAt` | `4` | Inclusive threshold for identical calls; minimum `2` |
| `killSameToolAt` | `0` | `0` = same-name window disabled |
| `sameToolWindow` | `10` | Sliding window length |
| `include` | `[]` | Empty = track all tools |
| `exclude` | `["todo_write"]` | Ignored entirely |

## False positives and tuning

Every threshold trades recall against false positives. Defaults were chosen
conservatively; tune from evidence, not vibes:

| Symptom | First knob |
|---|---|
| Legitimate repeated log lines pasted into answers trip `line` | Raise `minLineRepeats` to `4–5` |
| A glossary/tutorial legitimately reuses one keyword | Raise `minStemHits` / `minStemShare`, or `enableNormStem: false` |
| Shell tutorial with many standalone `$` prompts | Raise `minBrokenShellHits` or `enableCollapseDetect: false` |
| Streaming check fires too eagerly | Raise `checkEveryChars` |
| Tool guard denies a legitimately idempotent retry loop | Raise `killIdenticalAt`, or add the tool to `exclude` |
| "Slightly mutated args" spam still passes | Enable `killSameToolAt: 6–8` with `sameToolWindow: 10` |

Determinism guarantee: the same text + config always produce the same hit, so
you can replay incidents offline with `findRepetitionLoop` and pin thresholds
with tests before changing production.

## Comparison with reminder-only approaches

| | Reminder-only plugins | `agent-loop-guard` |
|---|---|---|
| Stops the stream on a loop | ✗ (appends a warning, generation continues) | ✓ hard-trips with structured `RepetitionHit` |
| Denies tool calls | ✗ | ✓ pre-execute, before the side effect happens |
| Argument key-order shuffles | not applicable / naive string checks evaded | canonicalization defeats them |
| Reasoning-stream awareness | rare | ✓ strict detector subset |
| Host coupling | usually host-specific | core is host-agnostic; adapters are thin |
| Dependencies | varies | **zero runtime dependencies** |

## Optional: sampling parameter injection

Some model families are known to loop less with `frequency_penalty` /
`presence_penalty` set. `agent-loop-guard` ships this as an **opt-in host
concern**: defaults are `samplingModels: []` and `injectSamplingParams: false`,
and the core library never patches `fetch` or any network API. If your host
implements injection, gate it on `samplingModels` globs via `wildcardMatch`
and keep the model list in *your* configuration — the library will not
hard-code any vendor or model id. See
[`docs/INTEGRATION.md §5`](docs/INTEGRATION.md).

## Optional: resume policy

The core guarantees trip detection, a structured hit, and clean stream
termination. Whether to auto-send a "continue" message afterwards is a host
decision. A commonly deployed policy (not part of this library): max 2 soft
resumes after a repetition trip, backoff `[5, 15, 30]` seconds, skip
subagents, and clear counters when a human user message arrives.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
npm test            # build + node:test suite (vitest: npm run test:vitest)
node examples/openai-loop.mjs   # offline demo without any API key
```

CI runs typecheck, tests, and the build on Node 18 / 20 / 22 (see
`.github/workflows/`). See [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines.

## Documentation

- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — wiring patterns for three host styles + optional sampling injection
- [`docs/SPEC.md`](docs/SPEC.md) — full algorithm specification (detector pseudocode, defaults, contracts)
- [`docs/SANITIZATION.md`](docs/SANITIZATION.md) — privacy/sanitization checklist enforced on this repo
- [`docs/PUSH_GUIDE.md`](docs/PUSH_GUIDE.md) — publish to GitHub and npm
- [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md) · [`CHANGELOG.md`](CHANGELOG.md)

## License

[MIT](LICENSE) © agent-loop-guard contributors

---

*Acknowledgment: the detection strategies were extracted from a production
agent setup and generalized. No personal identity, private endpoint, or
vendor-specific binding is included in this repository.*
