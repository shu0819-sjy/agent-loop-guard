import { resolveToolLoopConfig } from "./config.js";
import type { ToolCheckResult, ToolLoopConfig, ToolLoopGuard } from "./types.js";
import { canonicalizeToolArgs, wildcardToRegExp } from "./utils.js";

/**
 * Pre-execute hard kill for identical / same-name tool spam.
 * Argument key order is ignored via canonicalizeToolArgs.
 */
export function createToolLoopGuard(
  partial?: Partial<ToolLoopConfig>,
): ToolLoopGuard {
  const config = resolveToolLoopConfig(partial);
  const includePatterns = config.include.map(wildcardToRegExp);
  const excludePatterns = config.exclude.map(wildcardToRegExp);

  let identical: { key: string; count: number } | undefined;
  let nameWindow: string[] = [];

  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some((p) => p.test(toolName))) {
      return false;
    }
    return !excludePatterns.some((p) => p.test(toolName));
  }

  return {
    check(toolName: string, args: unknown): ToolCheckResult {
      if (!tracked(toolName)) {
        return { allowed: true, count: 0 };
      }

      const canonical = canonicalizeToolArgs(args);
      const key = JSON.stringify([toolName, canonical]);
      const identicalCount =
        identical !== undefined && identical.key === key ? identical.count + 1 : 1;
      identical = { key, count: identicalCount };

      if (identicalCount >= config.killIdenticalAt) {
        return {
          allowed: false,
          count: identicalCount,
          kind: "identical",
          reason:
            `[agent-loop-guard] identical tool call blocked: "${toolName}" × ${identicalCount} ` +
            `(threshold ${config.killIdenticalAt}). Do not repeat the same arguments — ` +
            `change approach, change arguments, or finish the task.`,
        };
      }

      if (config.killSameToolAt > 0) {
        nameWindow.push(toolName);
        while (nameWindow.length > config.sameToolWindow) nameWindow.shift();
        const sameNameHits = nameWindow.filter((n) => n === toolName).length;
        if (sameNameHits >= config.killSameToolAt) {
          return {
            allowed: false,
            count: sameNameHits,
            kind: "same-tool",
            reason:
              `[agent-loop-guard] tool-name loop blocked: "${toolName}" appeared ${sameNameHits} ` +
              `times in the last ${config.sameToolWindow} tracked calls ` +
              `(threshold ${config.killSameToolAt}). Switch tools or finish — stop hammering this one.`,
          };
        }
      }

      return { allowed: true, count: identicalCount };
    },

    resetOnUserMessage(): void {
      identical = undefined;
      nameWindow = [];
    },

    reset(): void {
      identical = undefined;
      nameWindow = [];
    },
  };
}
