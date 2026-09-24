import { describe, expect, it, vi } from "vitest";
import { createRepetitionGuard } from "../src/repetition-guard.js";
import { guardAsyncIterable } from "../src/stream.js";
import type { GuardChunk, RepetitionHit } from "../src/types.js";
import { EN_CONSECUTIVE_HIT } from "./fixtures/text-samples.js";

async function* asAsync<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("createRepetitionGuard — throttle", () => {
  it("does not check until checkEveryChars is reached", () => {
    const guard = createRepetitionGuard({ checkEveryChars: 20, minRepeats: 3 });
    // First push below throttle — even if content would later hit.
    expect(guard.push("hello")).toBeNull();
    expect(guard.snapshot()).toBe("hello");
  });

  it("trips after enough deltas accumulate a consecutive loop", () => {
    const guard = createRepetitionGuard({ checkEveryChars: 1, minRepeats: 3 });
    let hit: RepetitionHit | null = null;
    for (const ch of EN_CONSECUTIVE_HIT) {
      hit = guard.push(ch);
      if (hit) break;
    }
    expect(hit?.kind).toBe("consecutive");
  });

  it("reset clears snapshot and throttle", () => {
    const guard = createRepetitionGuard({ checkEveryChars: 4 });
    guard.push("abcd");
    guard.reset();
    expect(guard.snapshot()).toBe("");
    expect(guard.push("ab")).toBeNull();
  });
});

describe("guardAsyncIterable — trip semantics", () => {
  it("emits aborted end chunk, calls onTrip, and stops upstream", async () => {
    const trips: RepetitionHit[] = [];
    const guard = createRepetitionGuard({ checkEveryChars: 5, minRepeats: 3 });

    const chunks: GuardChunk[] = [
      { type: "delta", channel: "text", text: EN_CONSECUTIVE_HIT.slice(0, 8) },
      { type: "delta", channel: "text", text: EN_CONSECUTIVE_HIT.slice(8) },
      { type: "delta", channel: "text", text: "SHOULD_NOT_SEE" },
      { type: "end", reason: "stop" },
    ];

    const returnSpy = vi.fn(async () => ({ done: true as const, value: undefined }));
    const source: AsyncIterable<GuardChunk> = {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i >= chunks.length) return { done: true as const, value: undefined };
            const value = chunks[i++]!;
            return { done: false as const, value };
          },
          return: returnSpy,
        };
      },
    };

    const out: GuardChunk[] = [];
    for await (const chunk of guardAsyncIterable(source, guard, {
      onTrip: (hit) => trips.push(hit),
      watchReasoning: false,
    })) {
      out.push(chunk);
    }

    expect(trips.length).toBe(1);
    expect(trips[0]!.kind).toBe("consecutive");
    const last = out[out.length - 1]!;
    expect(last.type).toBe("end");
    if (last.type === "end") {
      expect(last.reason).toBe("aborted");
      expect((last.detail as RepetitionHit).kind).toBe("consecutive");
    }
    expect(out.some((c) => c.type === "delta" && c.text === "SHOULD_NOT_SEE")).toBe(
      false,
    );
    expect(returnSpy).toHaveBeenCalled();
  });

  it("emits incomplete end when upstream finishes without end chunk", async () => {
    const guard = createRepetitionGuard({ checkEveryChars: 100 });
    const out: GuardChunk[] = [];
    for await (const chunk of guardAsyncIterable(
      asAsync<GuardChunk>([{ type: "delta", channel: "text", text: "ok" }]),
      guard,
      { watchReasoning: false },
    )) {
      out.push(chunk);
    }
    expect(out.at(-1)).toEqual({ type: "end", reason: "incomplete" });
  });

  it("passes through explicit end without incomplete trailer", async () => {
    const guard = createRepetitionGuard({ checkEveryChars: 100 });
    const out: GuardChunk[] = [];
    for await (const chunk of guardAsyncIterable(
      asAsync<GuardChunk>([
        { type: "delta", channel: "text", text: "fine" },
        { type: "end", reason: "stop" },
      ]),
      guard,
      { watchReasoning: false },
    )) {
      out.push(chunk);
    }
    expect(out.at(-1)).toEqual({ type: "end", reason: "stop" });
  });

  it("supports mapChunk and skips null mappings", async () => {
    const guard = createRepetitionGuard({ checkEveryChars: 100 });
    const raw = [{ keep: true, text: "a" }, { keep: false }, { keep: true, text: "b" }];
    const out: GuardChunk[] = [];
    for await (const chunk of guardAsyncIterable(asAsync(raw), guard, {
      watchReasoning: false,
      mapChunk: (item) => {
        const v = item as { keep: boolean; text?: string };
        if (!v.keep) return null;
        return { type: "delta", channel: "text", text: v.text ?? "" };
      },
    })) {
      out.push(chunk);
    }
    expect(out.filter((c) => c.type === "delta")).toHaveLength(2);
    expect(out.at(-1)).toEqual({ type: "end", reason: "incomplete" });
  });
});
