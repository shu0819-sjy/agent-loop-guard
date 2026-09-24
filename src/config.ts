import type {
  AgentLoopGuardConfig,
  RepetitionConfig,
  ToolLoopConfig,
} from "./types.js";

/** Default English notice appended when a repetition trip fires. */
export const DEFAULT_NOTICE_TEXT =
  '\n\n[agent-loop-guard: repetition loop detected; generation stopped. Reply "continue" to resume.]';

/**
 * Model-agnostic repetition defaults.
 * samplingModels is empty and injectSamplingParams is false by design —
 * hosts opt in explicitly if they want penalty injection.
 */
export const DEFAULT_REPETITION_CONFIG: Readonly<RepetitionConfig> = Object.freeze({
  models: ["*"],
  samplingModels: [],
  minRepeats: 3,
  minUnitLen: 5,
  maxUnitLen: 96,
  checkEveryChars: 12,
  windowChars: 1600,
  minLineRepeats: 3,
  enableDensity: false,
  minDensityHits: 8,
  densityMinLen: 20,
  enableNormStem: true,
  minStemHits: 12,
  minStemShare: 0.35,
  minStemLen: 3,
  maxStemLen: 24,
  enableCollapseDetect: true,
  minSingleCharLines: 40,
  minSingleCharShare: 0.3,
  minBrokenShellHits: 8,
  enableUniqueRatio: false,
  minUniqueRatio: 0.12,
  uniqueMinChars: 200,
  appendNotice: true,
  noticeText: DEFAULT_NOTICE_TEXT,
  watchReasoning: true,
  injectSamplingParams: false,
  frequencyPenalty: 0.55,
  presencePenalty: 0.4,
});

export const DEFAULT_TOOL_LOOP_CONFIG: Readonly<ToolLoopConfig> = Object.freeze({
  killIdenticalAt: 4,
  killSameToolAt: 0,
  sameToolWindow: 10,
  include: [],
  exclude: ["todo_write"],
});

export const DEFAULT_CONFIG: Readonly<AgentLoopGuardConfig> = Object.freeze({
  repetition: DEFAULT_REPETITION_CONFIG,
  toolLoop: DEFAULT_TOOL_LOOP_CONFIG,
});

function clampShare(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function floorAtLeast(value: number, min: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

/** Merge partial overrides onto OSS defaults with validation floors. */
export function resolveRepetitionConfig(
  partial?: Partial<RepetitionConfig>,
): RepetitionConfig {
  const base = { ...DEFAULT_REPETITION_CONFIG, ...partial };
  return {
    ...base,
    models: Array.isArray(base.models) ? [...base.models] : ["*"],
    samplingModels: Array.isArray(base.samplingModels) ? [...base.samplingModels] : [],
    minRepeats: floorAtLeast(base.minRepeats, 2, DEFAULT_REPETITION_CONFIG.minRepeats),
    minUnitLen: floorAtLeast(base.minUnitLen, 2, DEFAULT_REPETITION_CONFIG.minUnitLen),
    maxUnitLen: floorAtLeast(base.maxUnitLen, 4, DEFAULT_REPETITION_CONFIG.maxUnitLen),
    checkEveryChars: floorAtLeast(
      base.checkEveryChars,
      4,
      DEFAULT_REPETITION_CONFIG.checkEveryChars,
    ),
    windowChars: floorAtLeast(base.windowChars, 64, DEFAULT_REPETITION_CONFIG.windowChars),
    minLineRepeats: floorAtLeast(
      base.minLineRepeats,
      2,
      DEFAULT_REPETITION_CONFIG.minLineRepeats,
    ),
    minDensityHits: floorAtLeast(
      base.minDensityHits,
      3,
      DEFAULT_REPETITION_CONFIG.minDensityHits,
    ),
    densityMinLen: floorAtLeast(
      base.densityMinLen,
      8,
      DEFAULT_REPETITION_CONFIG.densityMinLen,
    ),
    minStemHits: floorAtLeast(base.minStemHits, 4, DEFAULT_REPETITION_CONFIG.minStemHits),
    minStemShare: clampShare(base.minStemShare, DEFAULT_REPETITION_CONFIG.minStemShare),
    minStemLen: floorAtLeast(base.minStemLen, 2, DEFAULT_REPETITION_CONFIG.minStemLen),
    maxStemLen: floorAtLeast(base.maxStemLen, 4, DEFAULT_REPETITION_CONFIG.maxStemLen),
    minSingleCharLines: floorAtLeast(
      base.minSingleCharLines,
      10,
      DEFAULT_REPETITION_CONFIG.minSingleCharLines,
    ),
    minSingleCharShare: clampShare(
      base.minSingleCharShare,
      DEFAULT_REPETITION_CONFIG.minSingleCharShare,
    ),
    minBrokenShellHits: floorAtLeast(
      base.minBrokenShellHits,
      3,
      DEFAULT_REPETITION_CONFIG.minBrokenShellHits,
    ),
    minUniqueRatio: clampShare(
      base.minUniqueRatio,
      DEFAULT_REPETITION_CONFIG.minUniqueRatio,
    ),
    uniqueMinChars: floorAtLeast(
      base.uniqueMinChars,
      40,
      DEFAULT_REPETITION_CONFIG.uniqueMinChars,
    ),
    noticeText:
      typeof base.noticeText === "string" && base.noticeText.length > 0
        ? base.noticeText
        : DEFAULT_NOTICE_TEXT,
    enableDensity: Boolean(base.enableDensity),
    enableNormStem: Boolean(base.enableNormStem),
    enableCollapseDetect: Boolean(base.enableCollapseDetect),
    enableUniqueRatio: Boolean(base.enableUniqueRatio),
    appendNotice: Boolean(base.appendNotice),
    watchReasoning: Boolean(base.watchReasoning),
    injectSamplingParams: Boolean(base.injectSamplingParams),
    frequencyPenalty: Number.isFinite(base.frequencyPenalty)
      ? base.frequencyPenalty
      : DEFAULT_REPETITION_CONFIG.frequencyPenalty,
    presencePenalty: Number.isFinite(base.presencePenalty)
      ? base.presencePenalty
      : DEFAULT_REPETITION_CONFIG.presencePenalty,
  };
}

/** Merge partial overrides onto tool-loop defaults with validation floors. */
export function resolveToolLoopConfig(
  partial?: Partial<ToolLoopConfig>,
): ToolLoopConfig {
  const base = { ...DEFAULT_TOOL_LOOP_CONFIG, ...partial };
  return {
    killIdenticalAt: floorAtLeast(
      base.killIdenticalAt,
      2,
      DEFAULT_TOOL_LOOP_CONFIG.killIdenticalAt,
    ),
    killSameToolAt: floorAtLeast(
      base.killSameToolAt,
      0,
      DEFAULT_TOOL_LOOP_CONFIG.killSameToolAt,
    ),
    sameToolWindow: floorAtLeast(
      base.sameToolWindow,
      2,
      DEFAULT_TOOL_LOOP_CONFIG.sameToolWindow,
    ),
    include: Array.isArray(base.include) ? [...base.include] : [],
    exclude: Array.isArray(base.exclude) ? [...base.exclude] : ["todo_write"],
  };
}
