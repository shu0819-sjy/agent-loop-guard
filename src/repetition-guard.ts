import { resolveRepetitionConfig } from "./config.js";
import { findRepetitionLoop } from "./detectors.js";
import type {
  GuardPushResult,
  RepetitionConfig,
  RepetitionGuard,
  RepetitionOptions,
} from "./types.js";

export type CreateRepetitionGuardOptions = RepetitionOptions;

/**
 * Streaming repetition guard with character-throttle.
 * Pass `{ strict: true }` for reasoning / thinking streams
 * (skips density and unique-ratio detectors).
 */
export function createRepetitionGuard(
  options?: CreateRepetitionGuardOptions,
): RepetitionGuard {
  const { strict = false, ...partial } = options ?? {};
  const config: RepetitionConfig = resolveRepetitionConfig(partial);
  let text = "";
  let sinceCheck = 0;

  return {
    push(delta: string): GuardPushResult {
      if (!delta) return null;
      text += delta;
      sinceCheck += delta.length;
      if (sinceCheck < config.checkEveryChars) return null;
      sinceCheck = 0;
      return findRepetitionLoop(text, { ...config, strict });
    },
    snapshot(): string {
      return text;
    },
    reset(): void {
      text = "";
      sinceCheck = 0;
    },
  };
}
