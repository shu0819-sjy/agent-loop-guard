/**
 * Shared utilities: wildcard matching and JSON canonicalization.
 */

/** Convert a simple glob (`*` only) into a case-sensitive RegExp. */
export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`);
}

/** Case-insensitive model / name matching against a list of wildcards. */
export function wildcardMatch(value: string, patterns: string[]): boolean {
  if (!patterns.length) return true;
  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    const re = new RegExp(`^${escaped.replaceAll("*", ".*")}$`, "i");
    return re.test(value);
  });
}

/** Recursively sort object keys so argument identity ignores key order. */
export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key]);
    }
    return sorted;
  }
  return value;
}

/** Stable string form of tool arguments (key-order independent). */
export function canonicalizeToolArgs(args: unknown): string {
  try {
    return JSON.stringify(sortJsonValue(args));
  } catch {
    return String(args);
  }
}

/** Count non-overlapping occurrences of `needle` inside `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}
