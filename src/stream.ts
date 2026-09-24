import { createRepetitionGuard } from "./repetition-guard.js";
import type {
  GuardChunk,
  RepetitionConfig,
  RepetitionGuard,
  RepetitionHit,
} from "./types.js";

export type GuardAsyncIterableOptions = {
  onTrip?: (hit: RepetitionHit) => void;
  /** When true, also scan reasoning deltas with a strict detector. Default true. */
  watchReasoning?: boolean;
  /**
   * Optional host mapper: transform raw upstream values into GuardChunk.
   * Returning null skips the item.
   */
  mapChunk?: (raw: unknown) => GuardChunk | null;
  /**
   * Shared config used to build the internal strict reasoning guard when
   * `watchReasoning` is enabled and only a text guard was supplied.
   */
  config?: Partial<RepetitionConfig>;
};

/**
 * Wrap an async-iterable of neutral GuardChunk values with repetition
 * detection. On trip: invoke onTrip, stop reading upstream, emit a synthetic
 * `{ type: "end", reason: "aborted", detail: hit }` terminal chunk.
 *
 * Does not assume any host block protocol.
 */
export async function* guardAsyncIterable<T extends GuardChunk>(
  source: AsyncIterable<T | unknown>,
  guard: RepetitionGuard,
  options?: GuardAsyncIterableOptions,
): AsyncGenerator<T> {
  const watchReasoning = options?.watchReasoning !== false;
  const reasoningGuard: RepetitionGuard | null = watchReasoning
    ? createRepetitionGuard({ ...options?.config, strict: true })
    : null;
  const mapChunk = options?.mapChunk;
  const iter = source[Symbol.asyncIterator]();

  try {
    while (true) {
      const next = await iter.next();
      if (next.done) break;

      let chunk: GuardChunk | null;
      if (mapChunk) {
        chunk = mapChunk(next.value);
        if (chunk === null) continue;
      } else {
        chunk = next.value as GuardChunk;
      }

      if (chunk.type === "end") {
        yield chunk as T;
        return;
      }

      if (chunk.type === "delta") {
        const channel = chunk.channel;
        const text = chunk.text ?? "";
        let hit: RepetitionHit | null = null;

        if (channel === "text") {
          hit = guard.push(text);
        } else if (channel === "reasoning" && reasoningGuard) {
          hit = reasoningGuard.push(text);
        }

        if (hit) {
          options?.onTrip?.(hit);
          yield {
            type: "end",
            reason: "aborted",
            detail: hit,
          } as T;
          return;
        }

        yield chunk as T;
      }
    }
  } finally {
    if (typeof iter.return === "function") {
      try {
        await iter.return(undefined);
      } catch {
        // Upstream cleanup failures must not mask the trip.
      }
    }
  }

  // Upstream ended without an explicit end chunk and without a trip
  // (a trip returns above immediately after emitting its terminal chunk).
  yield { type: "end", reason: "incomplete" } as T;
}
