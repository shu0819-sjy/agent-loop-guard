/**
 * Deliberate loop / collapse fixtures for detector tests.
 * Normal prose fixtures must stay under detector thresholds.
 */

/** Exact trailing unit ×3 (minUnitLen 5). */
export const EN_CONSECUTIVE_HIT =
  "Preface. " + "hello".repeat(3);

/** Chinese exact trailing unit ×3 (5+ chars). */
export const ZH_CONSECUTIVE_HIT =
  "前言。" + "你好世界啊".repeat(3);

/** Line spam: identical non-empty lines ×3. */
export const EN_LINE_HIT = ["Emit GO!", "Emit GO!", "Emit GO!"].join("\n");

/** Chinese line spam (clears length gate). */
export const ZH_LINE_HIT = ["继续输出吧", "继续输出吧", "继续输出吧"].join("\n");

/** Variation stem spam with unique tails so consecutive does not win. */
export const EN_NORM_STEM_HIT = [
  "Emit — GO one",
  "Emit (Write it!) two",
  "Now Emit three",
  "Emit — GO four",
  "Emit (again) five",
  "Please Emit six",
  "Emit — GO seven",
  "Emit (Write it!) eight",
  "Now Emit nine",
  "Emit — GO ten",
  "Emit (again) eleven",
  "Please Emit twelve",
  "Emit — GO thirteen",
  "Emit (Write it!) fourteen",
  "Now Emit fifteen",
  "Emit — GO sixteen",
].join("\n");

export const ZH_NORM_STEM_HIT = [
  "继续输出 — 甲",
  "继续输出（再写）乙",
  "请 继续输出 丙",
  "继续输出 — 丁",
  "继续输出（再写）戊",
  "请 继续输出 己",
  "继续输出 — 庚",
  "继续输出（再写）辛",
  "请 继续输出 壬",
  "继续输出 — 癸",
  "继续输出（再写）子",
  "请 继续输出 丑",
  "继续输出 — 寅",
  "继续输出（再写）卯",
  "请 继续输出 辰",
  "继续输出 — 巳",
].join("\n");

/** One-char-per-line collapse (≥40). */
export const EN_CHAR_SPLIT_HIT =
  Array.from(
    { length: 48 },
    (_, i) => "abcdefghijklmnopqrstuvwxyz"[i % 26]!,
  ).join("\n") + "\nEND";

export const ZH_CHAR_SPLIT_HIT =
  Array.from(
    { length: 48 },
    (_, i) => "甲乙丙丁戊己庚辛壬癸"[i % 10]!,
  ).join("\n") + "\n结束标记";

export const EN_BROKEN_SHELL_HIT = [
  "$",
  "$",
  "$",
  "$",
  "$",
  "$",
  "$foo",
  "$",
  "bar",
  "$",
  "baz",
  "Get-",
  "Set-",
  "x",
  "=",
].join("\n");

export const ZH_BROKEN_SHELL_HIT =
  "草稿如下：\n" + EN_BROKEN_SHELL_HIT;

/** Density phrase with unique glue (consecutive must not win). */
export const EN_DENSITY_HIT = [
  "A0 capture the screenshot now",
  "B1 capture the screenshot now",
  "C2 capture the screenshot now",
  "D3 capture the screenshot now",
  "E4 capture the screenshot now",
  "F5 capture the screenshot now",
  "G6 capture the screenshot now",
  "H7 capture the screenshot now",
].join(" | ");

/** Low diversity; pair with maxUnitLen:4 so consecutive cannot run. */
export const EN_UNIQUE_RATIO_HIT = "abcd".repeat(80);

export const EN_NORMAL_TECH = `
## Integration notes

The guardAsyncIterable helper wraps an AsyncIterable of GuardChunk values.
Hosts map their native stream events into delta/end chunks before calling
createRepetitionGuard or createToolLoopGuard. Default samplingModels is empty
and injectSamplingParams is false so the library stays model-agnostic.

When wiring OpenAI-compatible clients, pass text deltas through guard.push
and check for a non-null RepetitionHit. Tool pre-execute hooks should call
toolGuard.check(name, args) and deny when allowed is false. Reset tool state
on each new user message via resetOnUserMessage so legitimate cross-turn
retries are not blocked. Configuration floors keep minRepeats at least 2.

Example identifiers used once: findRepetitionLoop, canonicalizeToolArgs,
wildcardMatch, resolveRepetitionConfig, DEFAULT_TOOL_LOOP_CONFIG.
`.trim();

export const ZH_NORMAL_TECH = `
## 接入说明

流式守卫通过 createRepetitionGuard 累积文本增量，并按 checkEveryChars 节流检测。
工具熔断在执行前调用 check；参数键序不同仍视为相同调用。默认排除 todo_write。
新用户消息到达时调用 resetOnUserMessage 清空相同调用链与同名滑窗。

本文仅描述配置与接线，不包含复读样本。常见 API：findRepetitionLoop、
createToolLoopGuard、guardAsyncIterable、DEFAULT_REPETITION_CONFIG。
严格模式用于 reasoning 通道，跳过 density 与 unique-ratio，降低长推理误杀。
`.trim();

export const EN_TOO_SHORT = "hi";

export const EN_LINE_BELOW_THRESHOLD = ["Emit GO!", "Emit GO!"].join("\n");
