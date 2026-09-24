/**
 * Shared types for agent-loop-guard.
 */

export type RepetitionKind =
  | "consecutive"
  | "line"
  | "norm-stem"
  | "char-split"
  | "broken-shell"
  | "density"
  | "unique-ratio";

export type RepetitionHit = {
  kind: RepetitionKind;
  /** Representative unit or diagnostic summary. */
  unit: string;
  /** Count / score used for thresholding. */
  repeats: number;
  /** Optional ratio for stem / char-split detectors. */
  share?: number;
};

export type GuardPushResult = RepetitionHit | null;

export interface RepetitionGuard {
  /** Append a text delta; may return a hit when the throttled check fires. */
  push(delta: string): GuardPushResult;
  /** Current accumulated text (debugging / notice formatting). */
  snapshot(): string;
  /** Clear accumulated text and the throttle counter. */
  reset(): void;
}

export type ToolCheckResult =
  | { allowed: true; count: number }
  | {
      allowed: false;
      count: number;
      reason: string;
      kind: "identical" | "same-tool";
    };

export interface ToolLoopGuard {
  check(toolName: string, args: unknown): ToolCheckResult;
  /** Clear identical-chain and name-window state on a new user turn. */
  resetOnUserMessage(): void;
  /** Hard clear of all internal state. */
  reset(): void;
}

export type GuardChunk =
  | { type: "delta"; channel: "text" | "reasoning"; text: string }
  | {
      type: "end";
      reason?: "stop" | "aborted" | "incomplete";
      detail?: unknown;
    };

export interface RepetitionConfig {
  /** Model id globs for stream guarding; empty or ["*"] = all models. */
  models: string[];
  /**
   * Model id globs for optional sampling-param injection.
   * OSS default: [] (disabled / inject nothing).
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

/** Options accepted by findRepetitionLoop / createRepetitionGuard. */
export type RepetitionOptions = Partial<RepetitionConfig> & {
  /** Strict mode skips density and unique-ratio (for reasoning streams). */
  strict?: boolean;
};
