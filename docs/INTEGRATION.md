# Integration guide — agent-loop-guard

This guide shows how to wire the two guards (text repetition + tool loop) into
three common host styles. Everything here is **model-agnostic**: no vendor id,
no model-family binding, no host-specific API appears as a requirement. All
examples import from `"agent-loop-guard"` (or the relative `dist/index.js` when
running from a checkout after `npm run build`).

- [1. Pattern A — plain function / offline](#1-pattern-a--plain-function--offline)
- [2. Pattern B — streaming host (async iterables)](#2-pattern-b--streaming-host-async-iterables)
- [3. Pattern C — plugin host (stream middleware + tools pre-execute)](#3-pattern-c--plugin-host-stream-middleware--tools-pre-execute)
- [4. State management across turns](#4-state-management-across-turns)
- [5. Optional: sampling parameter injection](#5-optional-sampling-parameter-injection)
- [6. Config validation floors](#6-config-validation-floors)
- [7. Testing your integration](#7-testing-your-integration)

---

## 1. Pattern A — plain function / offline

Use this when your host only has the complete assistant text (non-streaming
APIs, batch jobs, log post-processing, tests).

```ts
import { findRepetitionLoop } from "agent-loop-guard";

export function checkCompletion(text: string): boolean {
  const hit = findRepetitionLoop(text);
  if (hit) {
    // Decide your own policy: truncate, retry with different sampling,
    // surface a notice, or just log for metrics.
    console.warn(`repetition detected: kind=${hit.kind} repeats=${hit.repeats}`);
    return false; // reject the completion
  }
  return true;
}
```

For incremental (non-stream) generation where you receive chunks but control
the loop yourself, use the streaming guard directly:

```ts
import { createRepetitionGuard } from "agent-loop-guard";

const guard = createRepetitionGuard();
let text = "";
for (const delta of chunkSource) {
  text += delta;
  const hit = guard.push(delta);
  if (hit) {
    // Guard observed >= checkEveryChars new chars since the last check
    // and the detector fired. Stop accumulating / abort the request.
    break;
  }
}
```

Notes:

- `push()` is throttled internally (`checkEveryChars`, default `12`); calling
  it per token is fine.
- `guard.snapshot()` returns the accumulated text (useful for notice
  formatting or incident reports).
- `guard.reset()` clears state between independent generations.

## 2. Pattern B — streaming host (async iterables)

If your host exposes the model output as an `AsyncIterable` of events, map
events to the neutral chunk shape and wrap with `guardAsyncIterable`:

```ts
type GuardChunk =
  | { type: "delta"; channel: "text" | "reasoning"; text: string }
  | { type: "end"; reason?: "stop" | "aborted" | "incomplete"; detail?: unknown };
```

```ts
import {
  createRepetitionGuard,
  guardAsyncIterable,
  type GuardChunk,
  type RepetitionHit,
} from "agent-loop-guard";

async function* guardedStream(
  upstream: AsyncIterable<HostEvent>,
): AsyncGenerator<GuardChunk> {
  const textGuard = createRepetitionGuard();

  for await (const chunk of guardAsyncIterable(
    upstream,
    textGuard,
    {
      // Map your host events onto neutral chunks. Returning null skips an event.
      mapChunk: (raw): GuardChunk | null => {
        const ev = raw as HostEvent;
        if (ev.type === "text-delta") {
          return { type: "delta", channel: "text", text: ev.text };
        }
        if (ev.type === "reasoning-delta") {
          return { type: "delta", channel: "reasoning", text: ev.text };
        }
        if (ev.type === "finish") {
          return { type: "end", reason: "stop" };
        }
        return null;
      },
      // Also watch reasoning deltas with the strict detector subset:
      watchReasoning: true,
      onTrip: (hit: RepetitionHit) => {
        // Your telemetry / user-notice hook. Core does not assume a UI.
        console.warn(`[guard] trip: ${hit.kind} × ${hit.repeats}`);
      },
    },
  )) {
    if (chunk.type === "end" && chunk.reason === "aborted") {
      // Terminal synthetic chunk; `detail` is the RepetitionHit.
      yield { type: "delta", channel: "text", text: noticeText(chunk.detail) };
      yield { type: "end", reason: "stop" }; // soft stop looks like a normal end
      return;
    }
    yield chunk;
  }
}
```

Semantics you get for free:

1. On trip, `guardAsyncIterable` **stops reading upstream** and calls the
   underlying iterator's `return()` in a `finally` block (clean teardown).
2. It emits a synthetic terminal chunk
   `{ type: "end", reason: "aborted", detail: hit }`.
3. If upstream ends without a finish event, you get
   `{ type: "end", reason: "incomplete" }` — distinct from a repetition trip.
4. Reasoning deltas are scanned with the **strict** detector subset
   (no density / unique-ratio), so long technical thinking is not flagged.

If your host uses a richer block protocol (`block-start`, `text-delta`,
`block-end`, `finish`), port the same logic: on trip, stop forwarding deltas,
close any open text block, and finish open non-text blocks as `aborted` with a
stable code such as `REPETITION_LOOP`. Prefer surfacing a soft stop (visible
notice + normal finish) over a hard error whenever the protocol allows.

## 3. Pattern C — plugin host (stream middleware + tools pre-execute)

Hosts with middleware hooks (stream waterfall around the LLM call, and a
pre-execute interceptor around tool dispatch) map one-to-one onto the two
guards. A complete sanitized sketch lives in
[`examples/plugin-host.ts`](../examples/plugin-host.ts). The wiring contract:

| Host hook | Guard call | Behavior |
|---|---|---|
| Stream middleware (around model output) | `createRepetitionGuard()` per request; `push()` per text/reasoning delta | On hit: stop forwarding, append the notice text, finish with a stable code |
| Tools pre-execute interceptor | `toolGuard.check(name, args)` | On `allowed: false`: return your native deny shape (`{ deny, reason }` or equivalent) **without** executing |
| Before each agent step / on user message | `toolGuard.resetOnUserMessage()` | Clears tool-loop state so cross-turn legitimate repeats are allowed |

Per-agent state: keep one `ToolLoopGuard` per logical agent/session key (a
`WeakMap` keyed by the agent object works well) so two concurrent agents do
not share an identical-call chain.

Minimal sketch:

```ts
import { createToolLoopGuard } from "agent-loop-guard";

const guards = new WeakMap<AgentObject, ReturnType<typeof createToolLoopGuard>>();

function guardFor(agent: AgentObject) {
  let g = guards.get(agent);
  if (!g) {
    g = createToolLoopGuard({ killIdenticalAt: 4 }); // defaults: model-agnostic
    guards.set(agent, g);
  }
  return g;
}

// tools/pre-execute hook:
async function preExecute(agent: AgentObject, name: string, args: unknown, next: () => Promise<unknown>) {
  const verdict = guardFor(agent).check(name, args);
  if (!verdict.allowed) {
    return { deny: true, reason: verdict.reason }; // adapt to your host's deny shape
  }
  return next();
}
```

## 4. State management across turns

- **Text guards are per-generation.** Create a fresh `RepetitionGuard` for
  each completion request; a completed answer has no meaningful repetition
  relationship with the next one.
- **Tool guards are per-agent/per-session, reset by user turns.** Call
  `resetOnUserMessage()` when a user-authored message enters the conversation
  (detect by role or your host's message-source metadata). Do **not** reset
  when the model speaks, a tool returns, or a background retry occurs — those
  are exactly the patterns the guard exists to bound.
- **Hard reset** (`toolGuard.reset()`) is available for tests and admin
  operations.

## 5. Optional: sampling parameter injection

> The core library **never** patches `fetch` or any network API. This section
> describes an optional host-side concern for deployments that already know
> one of their model families loops less with repetition penalties.

Defaults keep this disabled and model-agnostic:

```ts
DEFAULT_REPETITION_CONFIG.samplingModels;      // [] — inject nothing
DEFAULT_REPETITION_CONFIG.injectSamplingParams; // false
```

If your host implements injection:

1. Decide the target model families **in your own configuration**, expressed
   as `*` globs (e.g. `["*flash*"]` for a flash-class family you operate).
   Never fork the library to bake in a list.
2. Gate the injection with `wildcardMatch`:

   ```ts
   import { DEFAULT_REPETITION_CONFIG, wildcardMatch } from "agent-loop-guard";

   const shouldInject = (modelId: string): boolean =>
     myConfig.injectSamplingParams &&
     myConfig.samplingModels.length > 0 &&
     wildcardMatch(modelId, myConfig.samplingModels);
   ```

3. Apply `frequencyPenalty` / `presencePenalty` (defaults `0.55` / `0.4`) as
   request fields in **your** client layer — not by wrapping global
   networking inside the library.
4. Log the decision (model id matched / not matched) so operators can audit
   which requests were modified.

Empty `samplingModels` must remain a no-op. If a user reports "the guard
changed my requests", it is a configuration error in the host, not library
behavior.

## 6. Config validation floors

`resolveRepetitionConfig` / `resolveToolLoopConfig` clamp out-of-range values
instead of throwing, so a bad config can never crash the stream. Floors:

| Key | Floor |
|---|---|
| `minRepeats` | `2` |
| `minUnitLen` / `maxUnitLen` | `2` / `4` |
| `checkEveryChars` | `4` |
| `windowChars` | `64` |
| `minLineRepeats` | `2` |
| `minDensityHits` / `densityMinLen` | `3` / `8` |
| `minStemHits` / `minStemLen` / `maxStemLen` | `4` / `2` / `4` |
| `minSingleCharLines` | `10` |
| `minBrokenShellHits` | `3` |
| `uniqueMinChars` | `40` |
| Share-type fields (`minStemShare`, `minSingleCharShare`, `minUniqueRatio`) | clamped to `[0, 1]` |
| `killIdenticalAt` | `2` |
| `killSameToolAt` | `0` (disabled) |
| `sameToolWindow` | `2` |

Boolean-like fields are coerced with `Boolean()`; non-finite numbers fall back
to defaults; an empty `noticeText` falls back to the English default.

## 7. Testing your integration

- **Determinism:** same text + same config ⇒ same hit. Snapshot `RepetitionHit`
  objects in tests.
- **Replay incidents:** store the offending text (sanitized!) and assert the
  exact `kind` / `repeats` with `findRepetitionLoop` before changing
  thresholds.
- **Bounds:** a loop must trip *at or shortly after* the threshold; a healthy
  long document must not trip. Keep both assertions in CI.
- **Tool guard:** assert that key-order-shuffled arguments count as identical,
  that the Nth identical call is the first deny, and that
  `resetOnUserMessage()` clears the chain.
- **Streaming:** fake an upstream that loops after 100 chunks and assert you
  receive exactly one synthetic `end` chunk with `reason: "aborted"` and that
  upstream teardown ran.

See [`docs/SPEC.md`](SPEC.md) for the full algorithmic contract and
[`docs/SANITIZATION.md`](SANITIZATION.md) for the privacy rules any example or
patch you publish must satisfy.
