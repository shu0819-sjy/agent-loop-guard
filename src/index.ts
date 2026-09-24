/**
 * agent-loop-guard — host-agnostic repetition + tool-loop hard-trip guards.
 * Zero runtime dependencies. Node >= 18 / ESM.
 */

export type {
  AgentLoopGuardConfig,
  GuardChunk,
  GuardPushResult,
  RepetitionConfig,
  RepetitionGuard,
  RepetitionHit,
  RepetitionKind,
  RepetitionOptions,
  ToolCheckResult,
  ToolLoopConfig,
  ToolLoopGuard,
} from "./types.js";

export {
  DEFAULT_CONFIG,
  DEFAULT_NOTICE_TEXT,
  DEFAULT_REPETITION_CONFIG,
  DEFAULT_TOOL_LOOP_CONFIG,
  resolveRepetitionConfig,
  resolveToolLoopConfig,
} from "./config.js";

export { findRepetitionLoop, normalizeStems } from "./detectors.js";

export {
  createRepetitionGuard,
  type CreateRepetitionGuardOptions,
} from "./repetition-guard.js";

export { createToolLoopGuard } from "./tool-loop-guard.js";

export {
  guardAsyncIterable,
  type GuardAsyncIterableOptions,
} from "./stream.js";

export {
  canonicalizeToolArgs,
  sortJsonValue,
  wildcardMatch,
  wildcardToRegExp,
} from "./utils.js";
