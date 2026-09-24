import { describe, expect, it } from "vitest";
import { createToolLoopGuard } from "../src/tool-loop-guard.js";
import { canonicalizeToolArgs } from "../src/utils.js";

describe("createToolLoopGuard — identical threshold", () => {
  it("allows calls below killIdenticalAt and blocks at threshold", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 4 });
    const args = { path: "a.ts", mode: "r" };

    expect(guard.check("read", args).allowed).toBe(true);
    expect(guard.check("read", args).allowed).toBe(true);
    expect(guard.check("read", args).allowed).toBe(true);
    const blocked = guard.check("read", args);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.kind).toBe("identical");
      expect(blocked.count).toBe(4);
      expect(blocked.reason).toContain("read");
    }
  });

  it("treats different key order as the same call", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 3 });
    expect(guard.check("write", { a: 1, b: 2 }).allowed).toBe(true);
    expect(guard.check("write", { b: 2, a: 1 }).allowed).toBe(true);
    const blocked = guard.check("write", { a: 1, b: 2 });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.kind).toBe("identical");
  });

  it("resets identical chain when args change", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 3 });
    expect(guard.check("read", { path: "a" }).allowed).toBe(true);
    expect(guard.check("read", { path: "a" }).allowed).toBe(true);
    expect(guard.check("read", { path: "b" }).allowed).toBe(true);
    expect(guard.check("read", { path: "b" }).allowed).toBe(true);
    const blocked = guard.check("read", { path: "b" });
    expect(blocked.allowed).toBe(false);
  });
});

describe("createToolLoopGuard — user-message reset", () => {
  it("clears state on resetOnUserMessage", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 3 });
    const args = { q: "x" };
    guard.check("search", args);
    guard.check("search", args);
    guard.resetOnUserMessage();
    expect(guard.check("search", args).allowed).toBe(true);
    expect(guard.check("search", args).allowed).toBe(true);
    const blocked = guard.check("search", args);
    expect(blocked.allowed).toBe(false);
  });

  it("reset() also clears state", () => {
    const guard = createToolLoopGuard({ killIdenticalAt: 2 });
    guard.check("read", { n: 1 });
    guard.reset();
    expect(guard.check("read", { n: 1 }).allowed).toBe(true);
  });
});

describe("createToolLoopGuard — include/exclude wildcards", () => {
  it("ignores excluded tools entirely", () => {
    const guard = createToolLoopGuard({
      killIdenticalAt: 2,
      exclude: ["todo_write", "status_*"],
    });
    for (let i = 0; i < 5; i++) {
      expect(guard.check("todo_write", { items: [] }).allowed).toBe(true);
      expect(guard.check("status_ping", {}).allowed).toBe(true);
    }
  });

  it("only tracks include patterns when include is non-empty", () => {
    const guard = createToolLoopGuard({
      killIdenticalAt: 2,
      include: ["read", "write_*"],
      exclude: [],
    });
    for (let i = 0; i < 4; i++) {
      expect(guard.check("search", { q: 1 }).allowed).toBe(true);
    }
    expect(guard.check("read", { path: "a" }).allowed).toBe(true);
    const blocked = guard.check("read", { path: "a" });
    expect(blocked.allowed).toBe(false);

    expect(guard.check("write_file", { path: "b" }).allowed).toBe(true);
    const blockedWrite = guard.check("write_file", { path: "b" });
    expect(blockedWrite.allowed).toBe(false);
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
      expect(guard.check("read", { i }).allowed).toBe(true);
    }
  });

  it("blocks when same name density exceeds threshold in window", () => {
    const guard = createToolLoopGuard({
      killIdenticalAt: 100,
      killSameToolAt: 4,
      sameToolWindow: 6,
    });
    expect(guard.check("read", { i: 1 }).allowed).toBe(true);
    expect(guard.check("write", { i: 2 }).allowed).toBe(true);
    expect(guard.check("read", { i: 3 }).allowed).toBe(true);
    expect(guard.check("read", { i: 4 }).allowed).toBe(true);
    const blocked = guard.check("read", { i: 5 });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.kind).toBe("same-tool");
      expect(blocked.count).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("canonicalizeToolArgs", () => {
  it("ignores object key order", () => {
    expect(canonicalizeToolArgs({ z: 1, a: { c: 3, b: 2 } })).toBe(
      canonicalizeToolArgs({ a: { b: 2, c: 3 }, z: 1 }),
    );
  });
});
