import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRepetitionGuard } from "../../dist/repetition-guard.js";
import { guardAsyncIterable } from "../../dist/stream.js";
import { EN_CONSECUTIVE_HIT } from "./fixtures.mjs";

async function* asAsync(items) {
  for (const item of items) yield item;
}

describe("createRepetitionGuard — throttle", () => {
  it("does not check until checkEveryChars is reached", () => {
    const guard = createRepetitionGuard({ checkEveryChars: 20, minRepeats: 3 });
    assert.equal(guard.push("hello"), null);
    assert.equal(guard.snapshot(), "hello");
  });

  it("trips after enough deltas accumulate a consecutive loop", () => {
    const guard = createRepetitionGuard({ checkEveryChars: 5, minRepeats: 3 });
    let hit = null;
    for (const ch of EN_CONSECUTIVE_HIT) {
      hit = guard.push(ch);
      if (hit) break;
    }
    assert.equal(hit?.kind, "consecutive");
  });

  it("reset clears snapshot and throttle", () => {
    const guard = createRepetitionGuard({ checkEveryChars: 4 });
    guard.push("abcd");
    guard.reset();
    assert.equal(guard.snapshot(), "");
    assert.equal(guard.push("ab"), null);
  });
});

describe("guardAsyncIterable — trip semantics", () => {
  it("emits aborted end chunk, calls onTrip, and stops upstream", async () => {
    const trips = [];
    const guard = createRepetitionGuard({ checkEveryChars: 5, minRepeats: 3 });
    const chunks = [
      { type: "delta", channel: "text", text: EN_CONSECUTIVE_HIT.slice(0, 8) },
      { type: "delta", channel: "text", text: EN_CONSECUTIVE_HIT.slice(8) },
      { type: "delta", channel: "text", text: "SHOULD_NOT_SEE" },
      { type: "end", reason: "stop" },
    ];
    let returnCalled = false;
    let i = 0;
    const source = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (i >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[i++] };
          },
          async return() {
            returnCalled = true;
            return { done: true, value: undefined };
          },
        };
      },
    };

    const out = [];
    for await (const chunk of guardAsyncIterable(source, guard, {
      onTrip: (hit) => trips.push(hit),
      watchReasoning: false,
    })) {
      out.push(chunk);
    }

    assert.equal(trips.length, 1);
    assert.equal(trips[0].kind, "consecutive");
    const last = out[out.length - 1];
    assert.equal(last.type, "end");
    assert.equal(last.reason, "aborted");
    assert.equal(last.detail.kind, "consecutive");
    assert.equal(
      out.some((c) => c.type === "delta" && c.text === "SHOULD_NOT_SEE"),
      false,
    );
    assert.equal(returnCalled, true);
  });

  it("emits incomplete end when upstream finishes without end chunk", async () => {
    const guard = createRepetitionGuard({ checkEveryChars: 100 });
    const out = [];
    for await (const chunk of guardAsyncIterable(
      asAsync([{ type: "delta", channel: "text", text: "ok" }]),
      guard,
      { watchReasoning: false },
    )) {
      out.push(chunk);
    }
    assert.deepEqual(out.at(-1), { type: "end", reason: "incomplete" });
  });

  it("passes through explicit end without incomplete trailer", async () => {
    const guard = createRepetitionGuard({ checkEveryChars: 100 });
    const out = [];
    for await (const chunk of guardAsyncIterable(
      asAsync([
        { type: "delta", channel: "text", text: "fine" },
        { type: "end", reason: "stop" },
      ]),
      guard,
      { watchReasoning: false },
    )) {
      out.push(chunk);
    }
    assert.deepEqual(out.at(-1), { type: "end", reason: "stop" });
  });

  it("supports mapChunk and skips null mappings", async () => {
    const guard = createRepetitionGuard({ checkEveryChars: 100 });
    const raw = [
      { keep: true, text: "a" },
      { keep: false },
      { keep: true, text: "b" },
    ];
    const out = [];
    for await (const chunk of guardAsyncIterable(asAsync(raw), guard, {
      watchReasoning: false,
      mapChunk: (item) => {
        if (!item.keep) return null;
        return { type: "delta", channel: "text", text: item.text ?? "" };
      },
    })) {
      out.push(chunk);
    }
    assert.equal(out.filter((c) => c.type === "delta").length, 2);
    assert.deepEqual(out.at(-1), { type: "end", reason: "incomplete" });
  });
});
