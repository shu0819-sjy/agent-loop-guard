/**
 * Reference mapping: wire agent-loop-guard into a generic plugin host that
 * exposes an LLM stream middleware hook and a tools pre-execute hook.
 *
 * This file is a sanitized sketch — it does not import any host SDK and does
 * not hard-code private paths, ports, or model-family bindings. Adapt the
 * `HostContext` surface to your runtime's actual event names.
 */

import {
  createRepetitionGuard,
  createToolLoopGuard,
  DEFAULT_REPETITION_CONFIG,
  DEFAULT_TOOL_LOOP_CONFIG,
  type RepetitionConfig,
  type RepetitionHit,
  type ToolLoopConfig,
} from "../dist/index.js";

/** Minimal host surface used by this sketch (replace with your types). */
export interface HostContext {
  /** Register stream middleware around the model output iterator. */
  on(
    event: "llm/stream",
    handler: (
      stream: AsyncIterable<HostStreamEvent>,
      next: (s: AsyncIterable<HostStreamEvent>) => AsyncIterable<HostStreamEvent>,
    ) => AsyncIterable<HostStreamEvent>,
  ): void;
  /** Register a pre-execute interceptor for tool calls. */
  on(
    event: "tools/pre-execute",
    handler: (
      exec: { name: string; arguments: unknown; agent: object },
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): void;
  /** Fired once per agent step before tools/LLM run. */
  on(
    event: "agent/pre-step",
    handler: (
      step: { agent: object; messages: Array<{ role?: string; source?: { kind?: string } }> },
      next: () => unknown,
    ) => unknown,
  ): void;
  logger?: { info?(msg: string): void; warn?(msg: string): void };
}

export type HostStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "finish"; reason: string }
  | { type: string; [key: string]: unknown };

export type PluginConfig = {
  repetition?: Partial<RepetitionConfig>;
  toolLoop?: Partial<ToolLoopConfig>;
};

/**
 * Apply both guards to a host context.
 * - Repetition → llm/stream waterfall (text + optional reasoning).
 * - Tool loop → tools/pre-execute deny.
 * - User message → resetOnUserMessage.
 */
export function applyAgentLoopGuard(ctx: HostContext, config: PluginConfig = {}): void {
  const repetition = { ...DEFAULT_REPETITION_CONFIG, ...config.repetition };
  const toolLoop = { ...DEFAULT_TOOL_LOOP_CONFIG, ...config.toolLoop };

  // Per-agent tool state via WeakMap keeps the sketch host-agnostic.
  const toolGuards = new WeakMap<object, ReturnType<typeof createToolLoopGuard>>();

  function getToolGuard(agent: object) {
    let guard = toolGuards.get(agent);
    if (!guard) {
      guard = createToolLoopGuard(toolLoop);
      toolGuards.set(agent, guard);
    }
    return guard;
  }

  ctx.on("agent/pre-step", (step, next) => {
    const hasUser = step.messages?.some(
      (m) => m?.source?.kind === "user" || m?.role === "user",
    );
    if (hasUser && step.agent) {
      getToolGuard(step.agent).resetOnUserMessage();
    }
    return next();
  });

  ctx.on("tools/pre-execute", async (exec, next) => {
    if (!exec?.agent) return next();
    const verdict = getToolGuard(exec.agent).check(exec.name, exec.arguments);
    if (!verdict.allowed) {
      ctx.logger?.warn?.(verdict.reason);
      return { kind: "deny", reason: verdict.reason };
    }
    return next();
  });

  ctx.on("llm/stream", (source, _next) => {
    const textGuard = createRepetitionGuard(repetition);
    const reasoningGuard = repetition.watchReasoning
      ? createRepetitionGuard({ ...repetition, strict: true })
      : null;

    return (async function* guarded() {
      let trip: RepetitionHit | null = null;

      for await (const event of source) {
        if (trip) break;

        if (event.type === "text-delta" && typeof event.text === "string") {
          const hit = textGuard.push(event.text);
          if (hit) {
            trip = hit;
            if (repetition.appendNotice) {
              const notice = formatNotice(repetition.noticeText, hit);
              yield { type: "text-delta", text: notice };
            }
            yield {
              type: "finish",
              reason: "stop",
              detail: { code: "REPETITION_LOOP", hit },
            };
            break;
          }
        }

        if (
          event.type === "reasoning-delta" &&
          typeof event.text === "string" &&
          reasoningGuard
        ) {
          const hit = reasoningGuard.push(event.text);
          if (hit) {
            trip = hit;
            if (repetition.appendNotice) {
              const notice = formatNotice(repetition.noticeText, hit);
              yield { type: "text-delta", text: notice };
            }
            yield {
              type: "finish",
              reason: "stop",
              detail: { code: "REPETITION_LOOP", hit },
            };
            break;
          }
        }

        yield event;
      }
    })();
  });

  ctx.logger?.info?.(
    `agent-loop-guard: repetition checkEveryChars=${repetition.checkEveryChars} ` +
      `toolLoop killIdenticalAt=${toolLoop.killIdenticalAt} ` +
      `samplingInjection=${repetition.injectSamplingParams} ` +
      `(samplingModels=${JSON.stringify(repetition.samplingModels)})`,
  );
}

function formatNotice(base: string, hit: RepetitionHit): string {
  const detail = ` kind=${hit.kind}×${hit.repeats}`;
  if (!base) return detail;
  return `${base}${detail}`;
}

/**
 * Optional Chinese notice template for integrators (not the library default).
 * Keep it generic — no personal nicknames or internal product codenames.
 */
export const NOTICE_TEXT_ZH =
  "\n\n[agent-loop-guard: 文本循环已触发熔断，生成已中止。回复「继续」可恢复输出。]";
