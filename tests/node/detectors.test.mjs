import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findRepetitionLoop } from "../../dist/detectors.js";
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

describe("findRepetitionLoop — consecutive", () => {
  it("hits English trailing unit repeats", () => {
    const hit = findRepetitionLoop(EN_CONSECUTIVE_HIT);
    assert.equal(hit?.kind, "consecutive");
    assert.ok(hit.repeats >= 3);
  });

  it("hits Chinese trailing unit repeats", () => {
    const hit = findRepetitionLoop(ZH_CONSECUTIVE_HIT);
    assert.equal(hit?.kind, "consecutive");
    assert.ok(hit.repeats >= 3);
  });

  it("misses short text under length gate", () => {
    assert.equal(findRepetitionLoop(EN_TOO_SHORT), null);
  });
});

describe("findRepetitionLoop — line", () => {
  it("hits English identical lines", () => {
    const hit = findRepetitionLoop(EN_LINE_HIT);
    assert.equal(hit?.kind, "line");
    assert.ok(hit.repeats >= 3);
  });

  it("hits Chinese identical lines", () => {
    const hit = findRepetitionLoop(ZH_LINE_HIT);
    assert.equal(hit?.kind, "line");
    assert.ok(hit.repeats >= 3);
  });

  it("misses two-line spam below threshold", () => {
    assert.equal(findRepetitionLoop(EN_LINE_BELOW_THRESHOLD), null);
  });
});

describe("findRepetitionLoop — norm-stem", () => {
  it("hits English variation stems", () => {
    const hit = findRepetitionLoop(EN_NORM_STEM_HIT);
    assert.equal(hit?.kind, "norm-stem");
    assert.ok(hit.repeats >= 12);
    assert.ok(hit.share >= 0.35);
  });

  it("hits Chinese variation stems", () => {
    const hit = findRepetitionLoop(ZH_NORM_STEM_HIT);
    assert.equal(hit?.kind, "norm-stem");
    assert.ok(hit.repeats >= 12);
  });

  it("can be disabled", () => {
    assert.equal(
      findRepetitionLoop(EN_NORM_STEM_HIT, { enableNormStem: false }),
      null,
    );
  });
});

describe("findRepetitionLoop — char-split", () => {
  it("hits English one-char-per-line collapse", () => {
    const hit = findRepetitionLoop(EN_CHAR_SPLIT_HIT);
    assert.equal(hit?.kind, "char-split");
    assert.ok(hit.repeats >= 40);
  });

  it("hits Chinese one-char-per-line collapse", () => {
    const hit = findRepetitionLoop(ZH_CHAR_SPLIT_HIT);
    assert.equal(hit?.kind, "char-split");
    assert.ok(hit.repeats >= 40);
  });
});

describe("findRepetitionLoop — broken-shell", () => {
  it("hits shattered shell drafts", () => {
    const hit = findRepetitionLoop(EN_BROKEN_SHELL_HIT);
    assert.equal(hit?.kind, "broken-shell");
    assert.ok(hit.repeats >= 8);
  });

  it("hits Chinese-prefixed shell shatter", () => {
    const hit = findRepetitionLoop(ZH_BROKEN_SHELL_HIT);
    assert.equal(hit?.kind, "broken-shell");
    assert.ok(hit.repeats >= 8);
  });
});

describe("findRepetitionLoop — density (opt-in)", () => {
  it("hits when enabled", () => {
    const hit = findRepetitionLoop(EN_DENSITY_HIT, { enableDensity: true });
    assert.equal(hit?.kind, "density");
    assert.ok(hit.repeats >= 8);
  });

  it("misses when default-off", () => {
    assert.equal(findRepetitionLoop(EN_DENSITY_HIT), null);
  });

  it("skipped in strict mode even when enabled", () => {
    assert.equal(
      findRepetitionLoop(EN_DENSITY_HIT, { enableDensity: true, strict: true }),
      null,
    );
  });
});

describe("findRepetitionLoop — unique-ratio (opt-in)", () => {
  it("hits low diversity when enabled", () => {
    const hit = findRepetitionLoop(EN_UNIQUE_RATIO_HIT, {
      enableUniqueRatio: true,
    });
    assert.equal(hit?.kind, "unique-ratio");
  });

  it("misses when default-off", () => {
    assert.equal(findRepetitionLoop(EN_UNIQUE_RATIO_HIT), null);
  });

  it("skipped in strict mode even when enabled", () => {
    assert.equal(
      findRepetitionLoop(EN_UNIQUE_RATIO_HIT, {
        enableUniqueRatio: true,
        strict: true,
      }),
      null,
    );
  });
});

describe("findRepetitionLoop — false-positive guards", () => {
  it("does not trip on English technical prose", () => {
    assert.equal(findRepetitionLoop(EN_NORMAL_TECH), null);
  });

  it("does not trip on Chinese technical prose", () => {
    assert.equal(findRepetitionLoop(ZH_NORMAL_TECH), null);
  });
});
