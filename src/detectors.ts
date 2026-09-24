import { resolveRepetitionConfig } from "./config.js";
import type { RepetitionConfig, RepetitionHit, RepetitionOptions } from "./types.js";
import { countOccurrences } from "./utils.js";

type DetectorConfig = Pick<
  RepetitionConfig,
  | "minRepeats"
  | "minUnitLen"
  | "maxUnitLen"
  | "minLineRepeats"
  | "enableDensity"
  | "minDensityHits"
  | "densityMinLen"
  | "enableNormStem"
  | "minStemHits"
  | "minStemShare"
  | "minStemLen"
  | "maxStemLen"
  | "enableCollapseDetect"
  | "minSingleCharLines"
  | "minSingleCharShare"
  | "minBrokenShellHits"
  | "enableUniqueRatio"
  | "minUniqueRatio"
  | "uniqueMinChars"
  | "windowChars"
>;

/** Exact trailing unit repeats (abcabcabc). */
function findConsecutiveUnit(
  tail: string,
  { minRepeats, minUnitLen, maxUnitLen }: Pick<
    DetectorConfig,
    "minRepeats" | "minUnitLen" | "maxUnitLen"
  >,
): RepetitionHit | null {
  const maxLen = Math.min(maxUnitLen, Math.floor(tail.length / minRepeats));
  for (let unitLen = minUnitLen; unitLen <= maxLen; unitLen++) {
    const unit = tail.slice(-unitLen);
    if (!unit.trim()) continue;
    let repeats = 1;
    let pos = tail.length - unitLen;
    while (pos >= unitLen) {
      const prev = tail.slice(pos - unitLen, pos);
      if (prev !== unit) break;
      repeats += 1;
      pos -= unitLen;
    }
    if (repeats >= minRepeats) {
      return { kind: "consecutive", unit, repeats };
    }
  }
  return null;
}

/** Identical consecutive non-empty lines. */
function findLineLoop(tail: string, minLineRepeats: number): RepetitionHit | null {
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < minLineRepeats) return null;
  const last = lines[lines.length - 1]!;
  if (last.length < 4) return null;
  let repeats = 1;
  for (let i = lines.length - 2; i >= 0; i--) {
    if (lines[i] !== last) break;
    repeats += 1;
  }
  if (repeats >= minLineRepeats) {
    return { kind: "line", unit: last, repeats };
  }
  return null;
}

/**
 * Strip parenthetical asides / dashes / punctuation so variation spam
 * (Emit — GO / Emit (Write it!)) collapses onto the same stem.
 */
export function normalizeStems(text: string): string {
  return String(text)
    .replace(/\([^)]{0,80}\)/g, " ")
    .replace(/\[[^\]]{0,80}\]/g, " ")
    .replace(/[—–―_|/\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized short-stem dominance. */
function findNormalizedStemLoop(
  tail: string,
  {
    minStemHits,
    minStemShare,
    minStemLen,
    maxStemLen,
  }: Pick<DetectorConfig, "minStemHits" | "minStemShare" | "minStemLen" | "maxStemLen">,
): RepetitionHit | null {
  const tokens = normalizeStems(tail)
    .split(" ")
    .filter((t) => t.length >= minStemLen && t.length <= maxStemLen);
  if (tokens.length < minStemHits) return null;

  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  let best: RepetitionHit | null = null;
  for (const [stem, hits] of freq) {
    if (hits < minStemHits) continue;
    const share = hits / tokens.length;
    if (share < minStemShare) continue;
    if (!best || hits > best.repeats) {
      best = { kind: "norm-stem", unit: stem, repeats: hits, share };
    }
  }
  return best;
}

/**
 * One-char-per-line or whitespace-split single-char tokens —
 * early collapse before a readable loop forms.
 */
function findCharSplitCollapse(
  tail: string,
  {
    minSingleCharLines,
    minSingleCharShare,
  }: Pick<DetectorConfig, "minSingleCharLines" | "minSingleCharShare">,
): RepetitionHit | null {
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length >= minSingleCharLines) {
    const singleLines = lines.filter((line) => Array.from(line).length === 1);
    const share = singleLines.length / lines.length;
    if (singleLines.length >= minSingleCharLines && share >= minSingleCharShare) {
      return {
        kind: "char-split",
        unit: `singleCharLines=${singleLines.length}`,
        repeats: singleLines.length,
        share,
      };
    }
  }

  const spaceTokens = tail
    .replace(/\r?\n/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (spaceTokens.length >= minSingleCharLines) {
    const singleTok = spaceTokens.filter((t) => Array.from(t).length === 1);
    const share = singleTok.length / spaceTokens.length;
    if (singleTok.length >= minSingleCharLines && share >= minSingleCharShare) {
      return {
        kind: "char-split",
        unit: `singleCharTokens=${singleTok.length}`,
        repeats: singleTok.length,
        share,
      };
    }
  }
  return null;
}

/**
 * Shattered shell / PowerShell drafts: lone `$`, `$` then break then
 * identifier, cmdlet verb left alone, assignment shatter.
 */
function findBrokenShellDraft(
  tail: string,
  { minBrokenShellHits }: Pick<DetectorConfig, "minBrokenShellHits">,
): RepetitionHit | null {
  const dollarAlone = (tail.match(/^\s*\$\s*$/gm) ?? []).length;
  const dollarBreak = (tail.match(/\$\s*\r?\n\s*[A-Za-z_]/g) ?? []).length;
  const splitCmdlet = (
    tail.match(/^\s*(Get|Set|New|Write|Select|Test|Move|Copy|Out|Add|Remove)-\s*$/gim) ?? []
  ).length;
  const assignShatter = (tail.match(/^\s*[A-Za-z_]\s*$\r?\n\s*=/gm) ?? []).length;

  const hits = dollarAlone + dollarBreak * 2 + splitCmdlet + assignShatter;
  if (hits < minBrokenShellHits) return null;
  return {
    kind: "broken-shell",
    unit: `dollarAlone=${dollarAlone};dollarBreak=${dollarBreak};cmdlet=${splitCmdlet};assign=${assignShatter}`,
    repeats: hits,
  };
}

/**
 * Short multi-word phrase density in the window (optional; default off).
 * Candidates must start at a word/sentence boundary and contain whitespace.
 */
function findDensityLoop(
  tail: string,
  {
    minUnitLen,
    maxUnitLen,
    minDensityHits,
    densityMinLen,
  }: Pick<
    DetectorConfig,
    "minUnitLen" | "maxUnitLen" | "minDensityHits" | "densityMinLen"
  >,
): RepetitionHit | null {
  const minLen = Math.max(minUnitLen, densityMinLen);
  const candidates = new Set<string>();
  const maxLen = Math.min(maxUnitLen, Math.floor(tail.length / minDensityHits));
  for (let unitLen = minLen; unitLen <= maxLen; unitLen++) {
    const start = tail.length - unitLen;
    if (start > 0 && !/[\s\n"'`([{，。！？、；：]/.test(tail[start - 1]!)) continue;
    const unit = tail.slice(start).trim();
    if (unit.length < minLen) continue;
    if (!/\s/.test(unit)) continue;
    if (/^[\s.。…·\-_=]+$/.test(unit)) continue;
    candidates.add(unit);
  }
  for (const unit of candidates) {
    const hits = countOccurrences(tail, unit);
    if (hits >= minDensityHits) {
      return { kind: "density", unit, repeats: hits };
    }
  }
  return null;
}

/** Low unique 4-gram ratio (optional; default off). */
function findLowUniqueRatio(
  tail: string,
  {
    uniqueMinChars,
    minUniqueRatio,
  }: Pick<DetectorConfig, "uniqueMinChars" | "minUniqueRatio">,
): RepetitionHit | null {
  if (tail.length < uniqueMinChars) return null;
  const n = 4;
  const grams = new Set<string>();
  for (let i = 0; i <= tail.length - n; i++) {
    grams.add(tail.slice(i, i + n));
  }
  const ratio = grams.size / Math.max(1, tail.length - n + 1);
  if (ratio < minUniqueRatio) {
    return {
      kind: "unique-ratio",
      unit: `unique4gram=${ratio.toFixed(3)}`,
      repeats: Math.round((1 - ratio) * 100),
    };
  }
  return null;
}

/**
 * Offline / pure multi-strategy repetition detector.
 * Evaluation order: consecutive → line → norm-stem → char-split →
 * broken-shell → (non-strict) density → (non-strict) unique-ratio.
 */
export function findRepetitionLoop(
  text: string,
  options?: RepetitionOptions,
): RepetitionHit | null {
  const { strict = false, ...partial } = options ?? {};
  const config = resolveRepetitionConfig(partial);
  const {
    minRepeats,
    minUnitLen,
    maxUnitLen,
    windowChars,
    minLineRepeats,
    enableDensity,
    minDensityHits,
    densityMinLen,
    enableNormStem,
    minStemHits,
    minStemShare,
    minStemLen,
    maxStemLen,
    enableCollapseDetect,
    minSingleCharLines,
    minSingleCharShare,
    minBrokenShellHits,
    enableUniqueRatio,
    minUniqueRatio,
    uniqueMinChars,
  } = config;

  if (typeof text !== "string") return null;
  if (text.length < minUnitLen * Math.min(minRepeats, 3)) return null;
  const tail = text.length > windowChars ? text.slice(-windowChars) : text;

  const hit =
    findConsecutiveUnit(tail, { minRepeats, minUnitLen, maxUnitLen }) ||
    findLineLoop(tail, minLineRepeats) ||
    (enableNormStem
      ? findNormalizedStemLoop(tail, {
          minStemHits,
          minStemShare,
          minStemLen,
          maxStemLen,
        })
      : null) ||
    (enableCollapseDetect
      ? findCharSplitCollapse(tail, { minSingleCharLines, minSingleCharShare }) ||
        findBrokenShellDraft(tail, { minBrokenShellHits })
      : null);

  if (hit) return hit;
  // Strict (reasoning) path stops before density / unique-ratio.
  if (strict) return null;

  if (enableDensity) {
    const density = findDensityLoop(tail, {
      minUnitLen,
      maxUnitLen,
      minDensityHits,
      densityMinLen,
    });
    if (density) return density;
  }
  if (enableUniqueRatio) {
    return findLowUniqueRatio(tail, { uniqueMinChars, minUniqueRatio });
  }
  return null;
}
