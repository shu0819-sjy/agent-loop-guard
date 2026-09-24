import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createToolLoopGuard } from "../../dist/tool-loop-guard.js";
import { canonicalizeToolArgs } from "../../dist/utils.js";

describe("createToolLoopGuard — identical threshold", () => {
  it("allows calls below killIdenticalAt and blocks at threshold", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 4 });
    const args = { path: "a.ts", mode: "r" };
    assert.equal(guard.check("read", args).allowed, true);
    assert.equal(guard.check("read", args).allowed, true);
    assert.equal(guard.check("read", args).allowed, true);
    const blocked = guard.check("read", args);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.kind, "identical");
    assert.equal(blocked.count, 4);
    assert.match(blocked.reason, /read/);
  });

  it("treats different key order as the same call", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 3 });
    assert.equal(guard.check("write", { a: 1, b: 2 }).allowed, true);
    assert.equal(guard.check("write", { b: 2, a: 1 }).allowed, true);
    const blocked = guard.check("write", { a: 1, b: 2 });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.kind, "identical");
  });

  it("resets identical chain when args change", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 3 });
    assert.equal(guard.check("read", { path: "a" }).allowed, true);
    assert.equal(guard.check("read", { path: "a" }).allowed, true);
    assert.equal(guard.check("read", { path: "b" }).allowed, true);
    assert.equal(guard.check("read", { path: "b" }).allowed, true);
    assert.equal(guard.check("read", { path: "b" }).allowed, false);
  });
});

describe("createToolLoopGuard — user-message reset", () => {
  it("clears state on resetOnUserMessage", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 3 });
    const args = { q: "x" };
    guard.check("search", args);
    guard.check("search", args);
    guard.resetOnUserMessage();
    assert.equal(guard.check("search", args).allowed, true);
    assert.equal(guard.check("search", args).allowed, true);
    assert.equal(guard.check("search", args).allowed, false);
  });

  it("reset() also clears state", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 2 });
    guard.check("read", { n: 1 });
    guard.reset();
    assert.equal(guard.check("read", { n: 1 }).allowed, true);
  });
});

describe("createToolLoopGuard — include/exclude wildcards", () => {
  it("ignores excluded tools entirely", () => {
    const guard = createToolLoopGuard({
      killIdenticalAt: 2,
      exclude: ["todo_write", "status_*"],
    });
    for (let i = 0; i < 5; i++) {
      assert.equal(guard.check("todo_write", { items: [] }).allowed, true);
      assert.equal(guard.check("status_ping", {}).allowed, true);
    }
  });

  it("only tracks include patterns when include is non-empty", () => {
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
});

describe("createToolLoopGuard — sameTool sliding window", () => {
  it("is disabled when killSameToolAt is 0", () => {
    const guard = createToolLoopGuard({
      killIdenticalAt: 100,
      killSameToolAt: 0,
      sameToolWindow: 10,
    });
    for (let i = 0; i < 12; i++) {
      assert.equal(guard.check("read", { i }).allowed, true);
    }
  });

  it("blocks when same name density exceeds threshold in window", () => {
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
});

describe("canonicalizeToolArgs", () => {
  it("ignores object key order", () => {
    assert.equal(
      canonicalizeToolArgs({ z: 1, a: { c: 3, b: 2 } }),
      canonicalizeToolArgs({ a: { b: 2, c: 3 }, z: 1 }),
    );
  });
});
