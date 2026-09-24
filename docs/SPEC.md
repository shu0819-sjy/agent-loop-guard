# agent-loop-guard Specification (v0.1)

> Generic, host-agnostic specification extracted from a production agent
> anti-loop setup. This document is the source of truth for implementation.
> No host-proprietary APIs appear in the core library contract.

## 1. Problem definition

LLM agents fail in two distinct loop modes that waste tokens, stall tools, and
confuse users:

| Mode | Layer | Symptom | Typical cause |
|---|---|---|---|
| **A. Text repetition / collapse** | Model output stream | Short phrases, lines, or stems repeat; or early “broken draft” collapse (one-char-per-line, shattered shell `$` drafts) | Weak sampling, long-context drift, command-writing failure before a visible loop |
| **B. Tool call thrash** | Tool dispatch | Same tool + same args hammered; or same tool name over-dense in a sliding window | Agent retries identical calls instead of changing approach |

Official “reminder only” plugins do **not** stop execution. This project hard-
trips both layers:

1. **Repetition guard** — streaming / offline detectors over assistant text
   (and optionally reasoning).
2. **Tool-loop guard** — pre-execute deny on identical / same-name tool spam.

Out of scope for v0.1 core: automatic “resume after trip” (documented as an
optional host policy in §8), model-specific sampling injection as a default,
and any host bus / plugin runtime.

---

## 2. Text-layer detectors

All detectors operate on a **tail window** of the accumulated text
(`windowChars`, default **1600**). They return a hit object or `null`:

```ts
type RepetitionHit = {
  kind:
    | "consecutive"
    | "line"
    | "norm-stem"
    | "char-split"
    | "broken-shell"
    | "density"
    | "unique-ratio";
  unit: string;       // representative unit or diagnostic summary
  repeats: number;    // count / score used for thresholding
  share?: number;     // optional ratio for stem / char-split
};
```

**Evaluation order** (first hit wins) for full (non-strict) mode:

1. `consecutive`
2. `line`
3. `norm-stem` (if `enableNormStem`)
4. `char-split` then `broken-shell` (if `enableCollapseDetect`)
5. `density` (if `enableDensity`) — **skipped in strict mode**
6. `unique-ratio` (if `enableUniqueRatio`) — **skipped in strict mode**

**Strict mode** (used for reasoning / thinking streams): only steps 1–4.
Density and unique-ratio are omitted because long technical reasoning often
reuses API names / identifiers without being a loop.

**Early exit / length gate** before any detector:

```
if text is not a string → null
if text.length < minUnitLen * min(minRepeats, 3) → null
tail = text.length > windowChars ? text.slice(-windowChars) : text
```

### 2.1 `consecutive` — exact trailing unit repeats

**Intent:** catch `abcabcabc` / short phrase glued repeats at the end of the
stream.

**Algorithm (pseudocode):**

```
maxLen = min(maxUnitLen, floor(tail.length / minRepeats))
for unitLen from minUnitLen to maxLen:
  unit = tail.slice(-unitLen)
  if unit is whitespace-only: continue
  repeats = 1
  pos = tail.length - unitLen
  while pos >= unitLen:
    prev = tail.slice(pos - unitLen, pos)
    if prev != unit: break
    repeats += 1
    pos -= unitLen
  if repeats >= minRepeats: return { kind: "consecutive", unit, repeats }
return null
```

| Parameter | Default | Notes |
|---|---|---|
| `minRepeats` | `3` | Inclusive of the current unit |
| `minUnitLen` | `5` | Avoid tiny noise units |
| `maxUnitLen` | `96` | Cap search cost |

**False-positive risk:** intentional code fences / ASCII art with repeated
blocks. Mitigated by `minUnitLen` and requiring exact adjacent copies at the
**end** only.

**Default on:** yes (always evaluated).

### 2.2 `line` — identical consecutive non-empty lines

**Intent:** catch line-oriented spam (`Emit\nEmit\nEmit`).

**Algorithm:**

```
lines = tail.split(/\r?\n/).map(trim).filter(nonEmpty)
if lines.length < minLineRepeats: return null
last = lines[last]
if last.length < 4: return null
repeats = 1
for i from lines.length-2 downto 0:
  if lines[i] != last: break
  repeats += 1
if repeats >= minLineRepeats: return { kind: "line", unit: last, repeats }
```

| Parameter | Default |
|---|---|
| `minLineRepeats` | `3` |

**False-positive risk:** repeated log lines in pasted output. Threshold ≥ 3
and `last.length ≥ 4` reduce noise.

**Default on:** yes.

### 2.3 `norm-stem` — normalized short-stem dominance

**Intent:** catch **variation** spam where punctuation / asides change but the
stem stays (`Emit — GO`, `Emit (Write it!)`, `Now Emit`).

**Normalization:**

```
normalizeStems(text):
  replace \( ... \) and \[ ... \] (≤80 chars insides) with space
  replace em/en dashes, | _ / \ runs with space
  replace non-letter/non-number (Unicode \p{L}\p{N}) with space
  lower-case, collapse whitespace, trim
```

**Algorithm:**

```
tokens = normalizeStems(tail).split(" ")
         .filter(t => len in [minStemLen, maxStemLen])
if tokens.length < minStemHits: return null
freq = count(tokens)
for each stem, hits in freq:
  if hits < minStemHits: continue
  share = hits / tokens.length
  if share < minStemShare: continue
  keep best by hits
return best as { kind: "norm-stem", unit: stem, repeats: hits, share }
```

| Parameter | Default | Reason |
|---|---|---|
| `enableNormStem` | `true` | Primary defense against variation loops |
| `minStemHits` | `12` | Absolute count floor |
| `minStemShare` | `0.35` | Relative dominance |
| `minStemLen` | `3` | Drop tiny tokens |
| `maxStemLen` | `24` | Drop long unique words |

**False-positive risk:** bilingual glossaries repeating a keyword. Dual
threshold (hits + share) mitigates.

**Runs in strict mode:** yes.

### 2.4 `char-split` — one-char-per-line / spaced single-char tokens

**Intent:** early collapse before a readable loop — model shreds a command into
single characters (`E\nr\nr\no\nr` or `E r r o r A c t i o n`).

**Algorithm (two branches):**

```
# Branch A: newline-split single-char lines
lines = non-empty trimmed lines
if lines.length >= minSingleCharLines:
  single = lines where Array.from(line).length === 1
  share = single.length / lines.length
  if single.length >= minSingleCharLines AND share >= minSingleCharShare:
    return char-split hit (unit = singleCharLines=N)

# Branch B: whitespace-split single-char tokens across newlines→spaces
tokens = tail with newlines→space, split on whitespace
same thresholds on single-char tokens → unit = singleCharTokens=N
```

| Parameter | Default |
|---|---|
| `enableCollapseDetect` | `true` (gates both 2.4 and 2.5) |
| `minSingleCharLines` | `40` |
| `minSingleCharShare` | `0.3` |

**False-positive risk:** vertical acrostics / letter lists. High absolute
threshold (40) keeps it safe.

**Runs in strict mode:** yes (under `enableCollapseDetect`).

### 2.5 `broken-shell` — shattered `$` / cmdlet drafts

**Intent:** catch broken PowerShell / shell drafts that precede loops:

- `$` alone on a line
- `$` then newline then identifier
- cmdlet verb left on its own line (`Get-`, `Set-`, …)
- assignment shatter (`x\n=`)

**Scoring:**

```
hits = dollarAlone
     + dollarBreak * 2
     + splitCmdlet
     + assignShatter
if hits >= minBrokenShellHits → { kind: "broken-shell", unit: diagnostics, repeats: hits }
```

Regex families (conceptual):

| Signal | Pattern idea | Weight |
|---|---|---|
| `dollarAlone` | `^\s*\$\s*$` (m) | 1 |
| `dollarBreak` | `\$\s*\n\s*[A-Za-z_]` | 2 |
| `splitCmdlet` | `^\s*(Get\|Set\|New\|Write\|Select\|Test\|Move\|Copy\|Out\|Add\|Remove)-\s*$` (mi) | 1 |
| `assignShatter` | `^\s*[A-Za-z_]\s*$\n\s*=` (m) | 1 |

| Parameter | Default |
|---|---|
| `minBrokenShellHits` | `8` |

**False-positive risk:** legitimate multi-line shell tutorials with many `$`.
Weighting + threshold keep normal docs under the bar.

**Runs in strict mode:** yes (under `enableCollapseDetect`).

### 2.6 `density` — short phrase density in window (optional)

**Intent:** same phrase appears many times in the window, not necessarily
adjacent. **Default OFF** — technical prose reuses identifiers
(`captureScreenshot`, etc.) and end-of-window slices can hit mid-token
fragments.

**Guards against mid-token slices:**

- Candidate must start at a word/sentence boundary (prev char is whitespace /
  punctuation / CJK punct, or start of string).
- Candidate must contain whitespace (multi-word phrase).
- `densityMinLen` floor (default 20) ≥ `minUnitLen`.

| Parameter | Default | Reason |
|---|---|---|
| `enableDensity` | `false` | High FP on technical long-form |
| `minDensityHits` | `8` | |
| `densityMinLen` | `20` | Prefer phrases over tokens |

**Strict mode:** never runs.

### 2.7 `unique-ratio` — 4-gram diversity (optional)

**Intent:** very low unique 4-gram ratio ⇒ low diversity loop. **Default OFF** —
long coherent thinking can look “low diversity” without being stuck.

```
if tail.length < uniqueMinChars: return null
grams = set of all length-4 substrings
ratio = grams.size / (tail.length - 3)
if ratio < minUniqueRatio → hit (unit = unique4gram=…, repeats ≈ (1-ratio)*100)
```

| Parameter | Default |
|---|---|
| `enableUniqueRatio` | `false` |
| `minUniqueRatio` | `0.12` |
| `uniqueMinChars` | `200` |

**Strict mode:** never runs.

---

## 3. Streaming contract

### 3.1 Core streaming guard (host-agnostic)

The portable API is **not** tied to any host block protocol. Core surface:

```ts
type GuardPushResult = RepetitionHit | null;

interface RepetitionGuard {
  /** Append a text delta; may return a hit when throttled check fires. */
  push(delta: string): GuardPushResult;
  /** Current accumulated text (debugging / notice formatting). */
  snapshot(): string;
  /** Clear accumulated text + throttle counter. */
  reset(): void;
}
```

**Throttle:** accumulate `delta.length` into `sinceCheck`; only call
`findRepetitionLoop` when `sinceCheck >= checkEveryChars`, then reset
`sinceCheck` to 0. Default `checkEveryChars = 12`.

**Dual detectors when watching reasoning:**

| Stream | Mode |
|---|---|
| Assistant / text | `strict: false` (all enabled detectors) |
| Reasoning / thinking | `strict: true` (no density / unique-ratio) |

### 3.2 Generic async-iterable adapter

For hosts that expose chunked streams, provide
`guardAsyncIterable(source, guard, options)` with a **neutral** chunk shape
(adapters map host events ↔ this shape):

```ts
type GuardChunk =
  | { type: "delta"; channel: "text" | "reasoning"; text: string }
  | { type: "end"; reason?: "stop" | "aborted" | "incomplete"; detail?: unknown };
```

**Semantics on trip:**

1. Invoke `onTrip(hit)` if provided.
2. Stop reading upstream (call iterator `return` in `finally`).
3. Emit a synthetic terminal chunk `{ type: "end", reason: "aborted", detail: hit }`.
4. Optionally append a visible notice string (see §3.3) via callback —
   **core must not assume a block protocol**.

### 3.3 Host block-protocol mapping (reference only)

Production hosts may use richer events (`block-start`, `text-delta`,
`reasoning-delta`, `block-end`, `finish`). Reference adapter behavior when
porting:

| Concern | Required behavior |
|---|---|
| Trip on text/reasoning | Stop consuming upstream; do not forward further deltas |
| Open text/reasoning blocks | Emit `block-end` with accumulated text |
| Open non-text blocks (e.g. tool-call) | Cannot safely close → finish as `aborted` with code `REPETITION_LOOP` |
| Visible notice | If `appendNotice`: append into an open text block, else open a new text block |
| Upstream ends without finish | Emit `aborted` / `STREAM_INCOMPLETE` (distinct from repetition) |
| Finish reason on clean trip with no open non-text | Prefer `stop` (user-visible soft stop) over hard error when possible |

**Notice formatting:** default English, configurable. If the notice template
contains a stable marker phrase, implementations may inject
` kind=<kind>×<repeats>` for operator visibility. Suggested default:

```
\n\n[agent-loop-guard: repetition loop detected; generation stopped. Reply "continue" to resume.]
```

Chinese template may be supplied by integrators; do **not** hard-code personal
or host-specific copy in the library default.

### 3.4 Offline pure function

```ts
findRepetitionLoop(text: string, config?: Partial<RepetitionConfig>): RepetitionHit | null
```

Same detector order and defaults as the streaming path. Used by tests and by
hosts that only have complete strings.

---

## 4. Tool-loop hard kill

### 4.1 Goals

- Deny **before** execution (pre-execute), never merely remind.
- Treat argument key order as irrelevant (`canonicalize`).
- Reset on a new **user** turn so cross-turn legitimate repeats are allowed.
- Optional same-name density kill for “slightly mutated args” spam.

### 4.2 Canonicalization

```
sortJsonValue(value):
  array → map recursively
  object → keys sorted lexicographically, values recursive
  else → value as-is

canonicalize(args) = JSON.stringify(sortJsonValue(args))
  on throw → String(args)
```

Identity key: `JSON.stringify([toolName, canonicalize(args)])`.

### 4.3 Identical-call chain

Per agent (or per logical session key supplied by the host):

```
identicalCount = (prev.key === key) ? prev.count + 1 : 1
store { key, count: identicalCount }
if identicalCount >= killIdenticalAt:
  return deny with actionable reason (change args / approach / finish)
```

| Parameter | Default | Notes |
|---|---|---|
| `killIdenticalAt` | `4` | Inclusive; minimum allowed config is 2 |

**Deny reason (English default):** state tool name, count, threshold, and tell
the model to change arguments, change approach, or finish — do not repeat.

### 4.4 Same-tool sliding window (optional)

```
if killSameToolAt > 0:
  push toolName into window
  trim to sameToolWindow
  if count(name == toolName) >= killSameToolAt → deny
```

| Parameter | Default | Notes |
|---|---|---|
| `killSameToolAt` | `0` | `0` = disabled |
| `sameToolWindow` | `10` | Sliding length |

Suggested ops range when enabling: `killSameToolAt` 6–8 with window 10.

### 4.5 Include / exclude wildcards

```
wildcard → RegExp: escape regex metas, then * → .*
tracked(name):
  if include non-empty AND no include match → false
  if any exclude match → false
  else true
```

| Parameter | Default | Notes |
|---|---|---|
| `include` | `[]` | Empty = track all |
| `exclude` | `["todo_write"]` | Never count / never reset via these calls |

Excluded tools are ignored entirely (neither counted nor used to break an
identical chain).

### 4.6 Reset policy

`resetOnUserMessage()` (or host hook when a user-authored message appears in the
incoming step): clear identical chain + name window for that agent/session.

Do **not** reset merely because the model spoke or a tool returned.

### 4.7 Portable API

```ts
type ToolCheckResult =
  | { allowed: true; count: number }
  | { allowed: false; count: number; reason: string; kind: "identical" | "same-tool" };

interface ToolLoopGuard {
  check(toolName: string, args: unknown): ToolCheckResult;
  resetOnUserMessage(): void;
  reset(): void; // hard clear
}
```

Hosts map `allowed: false` onto their native deny / abort mechanism.

---

## 5. Unified configuration schema

### 5.1 TypeScript draft (conceptual)

```ts
export interface RepetitionConfig {
  /** Model id globs for stream guarding; empty = all models. */
  models: string[];
  /**
   * Model id globs for optional sampling-param injection.
   * OSS DEFAULT: [] (disabled / inject nothing).
   * Upstream production often pinned flash-class models — must NOT ship as default.
   */
  samplingModels: string[];
  minRepeats: number;
  minUnitLen: number;
  maxUnitLen: number;
  checkEveryChars: number;
  windowChars: number;
  minLineRepeats: number;
  enableDensity: boolean;
  minDensityHits: number;
  densityMinLen: number;
  enableNormStem: boolean;
  minStemHits: number;
  minStemShare: number;
  minStemLen: number;
  maxStemLen: number;
  enableCollapseDetect: boolean;
  minSingleCharLines: number;
  minSingleCharShare: number;
  minBrokenShellHits: number;
  enableUniqueRatio: boolean;
  minUniqueRatio: number;
  uniqueMinChars: number;
  appendNotice: boolean;
  noticeText: string;
  watchReasoning: boolean;
  /** Optional host concern; core default false. */
  injectSamplingParams: boolean;
  frequencyPenalty: number;
  presencePenalty: number;
}

export interface ToolLoopConfig {
  killIdenticalAt: number;
  killSameToolAt: number;
  sameToolWindow: number;
  include: string[];
  exclude: string[];
}

export interface AgentLoopGuardConfig {
  repetition: RepetitionConfig;
  toolLoop: ToolLoopConfig;
}
```

### 5.2 Default value table (OSS / model-agnostic)

#### Repetition

| Key | Default | Upstream note |
|---|---|---|
| `models` | `["*"]` | Empty also means “all”; `["*"]` is explicit |
| `samplingModels` | `[]` | **Changed from upstream** flash globs → empty |
| `minRepeats` | `3` | Patch files may use 4; library default stays 3 |
| `minUnitLen` | `5` | |
| `maxUnitLen` | `96` | |
| `checkEveryChars` | `12` | Patch may use 16 |
| `windowChars` | `1600` | |
| `minLineRepeats` | `3` | |
| `enableDensity` | `false` | Patch may enable; library stays safe-off |
| `minDensityHits` | `8` | |
| `densityMinLen` | `20` | |
| `enableNormStem` | `true` | |
| `minStemHits` | `12` | |
| `minStemShare` | `0.35` | |
| `minStemLen` | `3` | |
| `maxStemLen` | `24` | |
| `enableCollapseDetect` | `true` | |
| `minSingleCharLines` | `40` | |
| `minSingleCharShare` | `0.3` | |
| `minBrokenShellHits` | `8` | |
| `enableUniqueRatio` | `false` | |
| `minUniqueRatio` | `0.12` | |
| `uniqueMinChars` | `200` | |
| `appendNotice` | `true` | |
| `noticeText` | English default in §3.3 | No personal / host copy |
| `watchReasoning` | `true` | |
| `injectSamplingParams` | `false` | **Changed:** upstream true; OSS off by default |
| `frequencyPenalty` | `0.55` | Only if injection enabled by host |
| `presencePenalty` | `0.4` | Only if injection enabled by host |

#### Tool loop

| Key | Default |
|---|---|
| `killIdenticalAt` | `4` |
| `killSameToolAt` | `0` |
| `sameToolWindow` | `10` |
| `include` | `[]` |
| `exclude` | `["todo_write"]` |

Validation floors (reject or clamp in factory):

- `minRepeats ≥ 2`, `killIdenticalAt ≥ 2`
- `checkEveryChars ≥ 4`, `windowChars ≥ 64`
- `minStemShare` / `minSingleCharShare` / `minUniqueRatio` ∈ `[0, 1]` (share fields also ≥ `0.1` recommended)

---

## 6. Target public API (v0.1)

```ts
// Pure detectors
export function findRepetitionLoop(
  text: string,
  config?: Partial<RepetitionConfig>,
): RepetitionHit | null;

// Factories
export function createRepetitionGuard(
  config?: Partial<RepetitionConfig>,
): RepetitionGuard;

export function createToolLoopGuard(
  config?: Partial<ToolLoopConfig>,
): ToolLoopGuard;

// Stream helper (neutral chunks)
export function guardAsyncIterable<T extends GuardChunk>(
  source: AsyncIterable<T>,
  guard: RepetitionGuard,
  options?: {
    onTrip?: (hit: RepetitionHit) => void;
    watchReasoning?: boolean;
    mapChunk?: (raw: unknown) => T | null; // optional host mapper hook
  },
): AsyncGenerator<T>;

// Config
export const DEFAULT_REPETITION_CONFIG: Readonly<RepetitionConfig>;
export const DEFAULT_TOOL_LOOP_CONFIG: Readonly<ToolLoopConfig>;
export function resolveRepetitionConfig(
  partial?: Partial<RepetitionConfig>,
): RepetitionConfig;
export function resolveToolLoopConfig(
  partial?: Partial<ToolLoopConfig>,
): ToolLoopConfig;

// Optional utilities
export function wildcardMatch(value: string, patterns: string[]): boolean;
export function canonicalizeToolArgs(args: unknown): string;
```

Package constraints:

- **Zero runtime dependencies**
- **Node ≥ 18**, ESM (`"type": "module"`)
- No imports of host SDKs in `src/`
- Examples may illustrate host wiring but must stay sanitized

---

## 7. Portability constraints

1. Core algorithms are pure functions + closures — no `fetch` monkey-patch in
   core. Sampling injection, if demonstrated, lives in **examples / integration
   docs** as an optional host concern.
2. No Cordis / plugin bus / schemastery / Zod required at runtime. Config is
   plain objects + documented defaults.
3. No filesystem, network, or process APIs in core.
4. Unicode-aware stem normalization (`\p{L}`, `\p{N}`) — requires a modern JS
   engine (Node 18+).
5. Deterministic: same text + config ⇒ same hit (stable for tests).
6. Comments and exported docs strings in **English**; user-visible notice
   configurable.

---

## 8. Optional extension: resume policy (non-core)

Some deployments auto-send a “continue” message after a soft stop. This is
**not** part of the v0.1 core library, but integrators may implement:

| Concern | Recommended default |
|---|---|
| Soft resumes after repetition / incomplete stream | max **2** |
| Hard failure resumes (timeout / network / 5xx whitelist) | max **3** |
| Backoff seconds | `[5, 15, 30]` |
| Subagents | skip by default |
| Human user message or deleted queued continue | clear counters / cancel timer |
| Event payload (if host has a bus) | `{ model, kind: "repetition" \| "stream-incomplete", detector?, repeats? }` |

Core only guarantees: trip detection + structured hit + clean stream
termination hooks. Resume orchestration stays in the host.

---

## 9. Host wiring patterns (descriptive)

### 9.1 Generic function / offline

Call `findRepetitionLoop(completeText)` after generation, or wrap incremental
tokens with `createRepetitionGuard().push`.

### 9.2 OpenAI-compatible tool loop

- Stream `chat.completions` deltas through `createRepetitionGuard`.
- Before each tool execution, `toolGuard.check(name, args)`; on deny, feed the
  reason back as a tool error / force the model to stop thrashing.

### 9.3 Plugin host (llm stream + tools pre-execute)

Map:

- Repetition guard → stream middleware / waterfall around the LLM stream.
- Tool-loop guard → pre-execute hook returning native `{ deny, reason }`.
- On new user message in the turn → `resetOnUserMessage()`.

Exact host event names are **examples only** and must not appear as required
core APIs. Any patch YAML samples in docs must be scrubbed of personal paths,
local ports, and model-vendor private ids (see `SANITIZATION.md`).

### 9.4 Sampling parameters (optional)

Hosts that know a model family benefits from penalties may set
`frequency_penalty` / `presence_penalty` via their own settings layer. Library
default: **do not inject**. If an example shows fetch wrapping, it must gate on
`samplingModels` (default empty ⇒ no-op) and never hard-code a single vendor
model id.

---

## 10. Version plan

### v0.1.0 (this spec)

- Six text detectors + strict subset
- Streaming guard + `findRepetitionLoop`
- Tool-loop guard with canonicalize + optional same-tool window
- Neutral async-iterable helper
- Two examples (OpenAI-style loop + host-plugin mapping sketch)
- Vitest suite + GitHub Actions (Node 18/20/22)
- Dual README (EN + zh-CN), MIT under “agent-loop-guard contributors”

### Later (non-blocking ideas)

- Pluggable detector registry
- Telemetry hooks (counters only, no payload logging by default)
- First-class resume helper package (optional peer)

---

## 11. Acceptance mapping for implementers

| Spec section | Must ship |
|---|---|
| §2.1–2.5 | Always-on path + collapse + norm-stem |
| §2.6–2.7 | Code present, default disabled |
| §3 | `push` / throttle / `reset` / strict reasoning |
| §4 | canonicalize, identical kill@4, exclude `todo_write`, user reset |
| §5 | `DEFAULT_*` model-agnostic (`samplingModels=[]`, `injectSamplingParams=false`) |
| §6 | Exported factories match names above |
| §7 | `dependencies: {}` in package.json |

End of specification.
