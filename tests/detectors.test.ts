import { describe, expect, it } from "vitest";
import { findRepetitionLoop } from "../src/detectors.js";
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
} from "./fixtures/text-samples.js";

describe("findRepetitionLoop — consecutive", () => {
  it("hits English trailing unit repeats", () => {
    const hit = findRepetitionLoop(EN_CONSECUTIVE_HIT);
    expect(hit?.kind).toBe("consecutive");
    expect(hit!.repeats).toBeGreaterThanOrEqual(3);
  });

  it("hits Chinese trailing unit repeats", () => {
    const hit = findRepetitionLoop(ZH_CONSECUTIVE_HIT);
    expect(hit?.kind).toBe("consecutive");
    expect(hit!.repeats).toBeGreaterThanOrEqual(3);
  });

  it("misses short text under length gate", () => {
    expect(findRepetitionLoop(EN_TOO_SHORT)).toBeNull();
  });
});

describe("findRepetitionLoop — line", () => {
  it("hits English identical lines", () => {
    const hit = findRepetitionLoop(EN_LINE_HIT);
    expect(hit?.kind).toBe("line");
    expect(hit!.repeats).toBeGreaterThanOrEqual(3);
  });

  it("hits Chinese identical lines", () => {
    const hit = findRepetitionLoop(ZH_LINE_HIT);
    expect(hit?.kind).toBe("line");
    expect(hit!.repeats).toBeGreaterThanOrEqual(3);
  });

  it("misses two-line spam below threshold", () => {
    expect(findRepetitionLoop(EN_LINE_BELOW_THRESHOLD)).toBeNull();
  });
});

describe("findRepetitionLoop — norm-stem", () => {
  it("hits English variation stems", () => {
    const hit = findRepetitionLoop(EN_NORM_STEM_HIT);
    expect(hit?.kind).toBe("norm-stem");
    expect(hit!.repeats).toBeGreaterThanOrEqual(12);
    expect(hit!.share!).toBeGreaterThanOrEqual(0.35);
  });

  it("hits Chinese variation stems", () => {
    const hit = findRepetitionLoop(ZH_NORM_STEM_HIT);
    expect(hit?.kind).toBe("norm-stem");
    expect(hit!.repeats).toBeGreaterThanOrEqual(12);
  });

  it("can be disabled", () => {
    expect(findRepetitionLoop(EN_NORM_STEM_HIT, { enableNormStem: false })).toBeNull();
  });
});

describe("findRepetitionLoop — char-split", () => {
  it("hits English one-char-per-line collapse", () => {
    const hit = findRepetitionLoop(EN_CHAR_SPLIT_HIT, { maxUnitLen: 4 });
    expect(hit?.kind).toBe("char-split");
    expect(hit!.repeats).toBeGreaterThanOrEqual(40);
  });

  it("hits Chinese one-char-per-line collapse", () => {
    const hit = findRepetitionLoop(ZH_CHAR_SPLIT_HIT, { maxUnitLen: 4 });
    expect(hit?.kind).toBe("char-split");
    expect(hit!.repeats).toBeGreaterThanOrEqual(40);
  });
});

describe("findRepetitionLoop — broken-shell", () => {
  it("hits shattered shell drafts", () => {
    const hit = findRepetitionLoop(EN_BROKEN_SHELL_HIT);
    expect(hit?.kind).toBe("broken-shell");
    expect(hit!.repeats).toBeGreaterThanOrEqual(8);
  });

  it("hits Chinese-prefixed shell shatter", () => {
    const hit = findRepetitionLoop(ZH_BROKEN_SHELL_HIT);
    expect(hit?.kind).toBe("broken-shell");
    expect(hit!.repeats).toBeGreaterThanOrEqual(8);
  });
});

describe("findRepetitionLoop — density (opt-in)", () => {
  it("hits when enabled", () => {
    const hit = findRepetitionLoop(EN_DENSITY_HIT, { enableDensity: true });
    expect(hit?.kind).toBe("density");
    expect(hit!.repeats).toBeGreaterThanOrEqual(8);
  });

  it("misses when default-off", () => {
    expect(findRepetitionLoop(EN_DENSITY_HIT)).toBeNull();
  });

  it("skipped in strict mode even when enabled", () => {
    expect(
      findRepetitionLoop(EN_DENSITY_HIT, { enableDensity: true, strict: true }),
    ).toBeNull();
  });
});

describe("findRepetitionLoop — unique-ratio (opt-in)", () => {
  it("hits low diversity when enabled", () => {
    const hit = findRepetitionLoop(EN_UNIQUE_RATIO_HIT, {
      enableUniqueRatio: true,
      maxUnitLen: 4,
    });
    expect(hit?.kind).toBe("unique-ratio");
  });

  it("misses when default-off", () => {
    expect(findRepetitionLoop(EN_UNIQUE_RATIO_HIT, { maxUnitLen: 4 })).toBeNull();
  });

  it("skipped in strict mode even when enabled", () => {
    expect(
      findRepetitionLoop(EN_UNIQUE_RATIO_HIT, {
        enableUniqueRatio: true,
        strict: true,
        maxUnitLen: 4,
      }),
    ).toBeNull();
  });
});

describe("findRepetitionLoop — false-positive guards", () => {
  it("does not trip on English technical prose", () => {
    expect(findRepetitionLoop(EN_NORMAL_TECH)).toBeNull();
  });

  it("does not trip on Chinese technical prose", () => {
    expect(findRepetitionLoop(ZH_NORMAL_TECH)).toBeNull();
  });
});
