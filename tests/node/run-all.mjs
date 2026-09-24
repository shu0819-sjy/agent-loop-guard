/**
 * Single-process test runner (no child_process).
 * Works inside restricted Windows sandboxes where spawn is EPERM.
 */
import assert from "node:assert/strict";
import { findRepetitionLoop } from "../../dist/detectors.js";
import { createRepetitionGuard } from "../../dist/repetition-guard.js";
import { createToolLoopGuard } from "../../dist/tool-loop-guard.js";
import { guardAsyncIterable } from "../../dist/stream.js";
import { canonicalizeToolArgs } from "../../dist/utils.js";
import {
  EN_BROKEN_SHELL_HIT,
  EN_CHAR_SPLIT_HIT,
  EN_CONSECUTIVE_HIT,
  EN_DENSITY_HIT,
  EN_LINE_BELOW_THRESHOLD,
  EN_LINE_HIT,
  EN_NORM_STEM_HIT,
  EN_NORMAL_TECH,
  EN_TOO_SHORT,
  EN_UNIQUE_RATIO_HIT,
  ZH_BROKEN_SHELL_HIT,
  ZH_CHAR_SPLIT_HIT,
  ZH_CONSECUTIVE_HIT,
  ZH_LINE_HIT,
  ZH_NORM_STEM_HIT,
  ZH_NORMAL_TECH,
} from "./fixtures.mjs";

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok - ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.error(`not ok - ${name}`);
    console.error(err);
  }
}

async function* asAsync(items) {
  for (const item of items) yield item;
}

await test("consecutive EN hit", () => {
  const hit = findRepetitionLoop(EN_CONSECUTIVE_HIT);
  assert.equal(hit?.kind, "consecutive");
  assert.ok(hit.repeats >= 3);
});

await test("consecutive ZH hit", () => {
  const hit = findRepetitionLoop(ZH_CONSECUTIVE_HIT);
  assert.equal(hit?.kind, "consecutive");
  assert.ok(hit.repeats >= 3);
});

await test("consecutive misses short", () => {
  assert.equal(findRepetitionLoop(EN_TOO_SHORT), null);
});

await test("line EN hit", () => {
  const hit = findRepetitionLoop(EN_LINE_HIT);
  assert.equal(hit?.kind, "line");
  assert.ok(hit.repeats >= 3);
});

await test("line ZH hit", () => {
  const hit = findRepetitionLoop(ZH_LINE_HIT);
  assert.equal(hit?.kind, "line");
  assert.ok(hit.repeats >= 3);
});

await test("line below threshold miss", () => {
  assert.equal(findRepetitionLoop(EN_LINE_BELOW_THRESHOLD), null);
});

await test("norm-stem EN hit", () => {
  const hit = findRepetitionLoop(EN_NORM_STEM_HIT);
  assert.equal(hit?.kind, "norm-stem");
  assert.ok(hit.repeats >= 12);
  assert.ok(hit.share >= 0.35);
});

await test("norm-stem ZH hit", () => {
  const hit = findRepetitionLoop(ZH_NORM_STEM_HIT);
  assert.equal(hit?.kind, "norm-stem");
  assert.ok(hit.repeats >= 12);
});

await test("norm-stem can disable", () => {
  assert.equal(
    findRepetitionLoop(EN_NORM_STEM_HIT, { enableNormStem: false }),
    null,
  );
});

await test("char-split EN hit", () => {
  // maxUnitLen 4 prevents consecutive from winning on short cyclic lines
  const hit = findRepetitionLoop(EN_CHAR_SPLIT_HIT, { maxUnitLen: 4 });
  assert.equal(hit?.kind, "char-split");
  assert.ok(hit.repeats >= 40);
});

await test("char-split ZH hit", () => {
  const hit = findRepetitionLoop(ZH_CHAR_SPLIT_HIT, { maxUnitLen: 4 });
  assert.equal(hit?.kind, "char-split");
  assert.ok(hit.repeats >= 40);
});

await test("broken-shell EN hit", () => {
  const hit = findRepetitionLoop(EN_BROKEN_SHELL_HIT);
  assert.equal(hit?.kind, "broken-shell");
  assert.ok(hit.repeats >= 8);
});

await test("broken-shell ZH hit", () => {
  const hit = findRepetitionLoop(ZH_BROKEN_SHELL_HIT);
  assert.equal(hit?.kind, "broken-shell");
  assert.ok(hit.repeats >= 8);
});

await test("density opt-in hit", () => {
  const hit = findRepetitionLoop(EN_DENSITY_HIT, { enableDensity: true });
  assert.equal(hit?.kind, "density");
  assert.ok(hit.repeats >= 8);
});

await test("density default-off miss", () => {
  assert.equal(findRepetitionLoop(EN_DENSITY_HIT), null);
});

await test("density skipped in strict", () => {
  assert.equal(
    findRepetitionLoop(EN_DENSITY_HIT, { enableDensity: true, strict: true }),
    null,
  );
});

await test("unique-ratio opt-in hit", () => {
  const hit = findRepetitionLoop(EN_UNIQUE_RATIO_HIT, {
    enableUniqueRatio: true,
    maxUnitLen: 4,
  });
  assert.equal(hit?.kind, "unique-ratio");
});

await test("unique-ratio default-off miss", () => {
  assert.equal(
    findRepetitionLoop(EN_UNIQUE_RATIO_HIT, { maxUnitLen: 4 }),
    null,
  );
});

await test("unique-ratio skipped in strict", () => {
  assert.equal(
    findRepetitionLoop(EN_UNIQUE_RATIO_HIT, {
      enableUniqueRatio: true,
      strict: true,
      maxUnitLen: 4,
    }),
    null,
  );
});

await test("FP guard EN tech prose", () => {
  assert.equal(findRepetitionLoop(EN_NORMAL_TECH), null);
});

await test("FP guard ZH tech prose", () => {
  assert.equal(findRepetitionLoop(ZH_NORMAL_TECH), null);
});

await test("tool identical threshold", () => {
  const guard = createToolLoopGuard({ killIdenticalAt: 4 });
  const args = { path: "a.ts", mode: "r" };
  assert.equal(guard.check("read", args).allowed, true);
  assert.equal(guard.check("read", args).allowed, true);
  assert.equal(guard.check("read", args).allowed, true);
  const blocked = guard.check("read", args);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.kind, "identical");
  assert.equal(blocked.count, 4);
});

await test("tool key-order identical", () => {
  const guard = createToolLoopGuard({ killIdenticalAt: 3 });
  assert.equal(guard.check("write", { a: 1, b: 2 }).allowed, true);
  assert.equal(guard.check("write", { b: 2, a: 1 }).allowed, true);
  assert.equal(guard.check("write", { a: 1, b: 2 }).allowed, false);
});

await test("tool args change resets chain", () => {
  const guard = createToolLoopGuard({ killIdenticalAt: 3 });
  assert.equal(guard.check("read", { path: "a" }).allowed, true);
  assert.equal(guard.check("read", { path: "a" }).allowed, true);
  assert.equal(guard.check("read", { path: "b" }).allowed, true);
  assert.equal(guard.check("read", { path: "b" }).allowed, true);
  assert.equal(guard.check("read", { path: "b" }).allowed, false);
});

await test("tool resetOnUserMessage", () => {
  const guard = createToolLoopGuard({ killIdenticalAt: 3 });
  const args = { q: "x" };
  guard.check("search", args);
  guard.check("search", args);
  guard.resetOnUserMessage();
  assert.equal(guard.check("search", args).allowed, true);
  assert.equal(guard.check("search", args).allowed, true);
  assert.equal(guard.check("search", args).allowed, false);
});

await test("tool reset()", () => {
  const guard = createToolLoopGuard({ killIdenticalAt: 2 });
  guard.check("read", { n: 1 });
  guard.reset();
  assert.equal(guard.check("read", { n: 1 }).allowed, true);
});

await test("tool exclude wildcards", () => {
  const guard = createToolLoopGuard({
    killIdenticalAt: 2,
    exclude: ["todo_write", "status_*"],
  });
  for (let i = 0; i < 5; i++) {
    assert.equal(guard.check("todo_write", { items: [] }).allowed, true);
    assert.equal(guard.check("status_ping", {}).allowed, true);
  }
});

await test("tool include wildcards", () => {
  const guard = createToolLoopGuard({
    killIdenticalAt: 2,
    include: ["read", "write_*"],
    exclude: [],
  });
  for (let i = 0; i < 4; i++) {
    assert.equal(guard.check("search", { q: 1 }).allowed, true);
  }
  assert.equal(guard.check("read", { path: "a" }).allowed, true);
  assert.equal(guard.check("read", { path: "a" }).allowed, false);
  assert.equal(guard.check("write_file", { path: "b" }).allowed, true);
  assert.equal(guard.check("write_file", { path: "b" }).allowed, false);
});

await test("sameTool disabled at 0", () => {
  const guard = createToolLoopGuard({
    killIdenticalAt: 100,
    killSameToolAt: 0,
    sameToolWindow: 10,
  });
  for (let i = 0; i < 12; i++) {
    assert.equal(guard.check("read", { i }).allowed, true);
  }
});

await test("sameTool window trip", () => {
  const guard = createToolLoopGuard({
    killIdenticalAt: 100,
    killSameToolAt: 4,
    sameToolWindow: 6,
  });
  assert.equal(guard.check("read", { i: 1 }).allowed, true);
  assert.equal(guard.check("write", { i: 2 }).allowed, true);
  assert.equal(guard.check("read", { i: 3 }).allowed, true);
  assert.equal(guard.check("read", { i: 4 }).allowed, true);
  const blocked = guard.check("read", { i: 5 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.kind, "same-tool");
  assert.ok(blocked.count >= 4);
});

await test("canonicalizeToolArgs key order", () => {
  assert.equal(
    canonicalizeToolArgs({ z: 1, a: { c: 3, b: 2 } }),
    canonicalizeToolArgs({ a: { b: 2, c: 3 }, z: 1 }),
  );
});

await test("repetition guard throttle", () => {
  const guard = createRepetitionGuard({ checkEveryChars: 20, minRepeats: 3 });
  assert.equal(guard.push("hello"), null);
  assert.equal(guard.snapshot(), "hello");
});

await test("repetition guard trips on consecutive", () => {
  const guard = createRepetitionGuard({ checkEveryChars: 1, minRepeats: 3 });
  let hit = null;
  for (const ch of EN_CONSECUTIVE_HIT) {
    hit = guard.push(ch);
    if (hit) break;
  }
  assert.equal(hit?.kind, "consecutive");
});

await test("repetition guard reset", () => {
  const guard = createRepetitionGuard({ checkEveryChars: 4 });
  guard.push("abcd");
  guard.reset();
  assert.equal(guard.snapshot(), "");
  assert.equal(guard.push("ab"), null);
});

await test("stream trip + onTrip + stop upstream", async () => {
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

await test("stream incomplete end", async () => {
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

await test("stream explicit end passthrough", async () => {
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

await test("stream mapChunk skip null", async () => {
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

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n# tests ${results.length}`);
console.log(`# pass ${passed}`);
console.log(`# fail ${failed}`);
process.exit(failed === 0 ? 0 : 1);
