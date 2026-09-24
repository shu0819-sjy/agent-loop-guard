/**
 * Example: OpenAI-compatible chat.completions streaming + tool-call loop
 * wired with createRepetitionGuard and createToolLoopGuard.
 *
 * This file is illustrative — replace `fetchChatCompletion` with your client.
 * Run after `npm run build` so `../dist/index.js` exists:
 *
 *   node examples/openai-loop.mjs
 *
 * Environment (optional):
 *   OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
 */

import {
  createRepetitionGuard,
  createToolLoopGuard,
  guardAsyncIterable,
} from "../dist/index.js";

const API_KEY = process.env.OPENAI_API_KEY ?? "sk-replace-me";
const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** Minimal tool registry used by the demo loop. */
const tools = {
  async get_weather({ city }) {
    return { city, tempC: 22, condition: "clear" };
  },
  async search_docs({ query }) {
    return { query, hits: [{ title: "Getting started", url: "https://example.com/docs" }] };
  },
};

/**
 * Convert an OpenAI SSE stream into neutral GuardChunk values.
 * @param {ReadableStream<Uint8Array>} body
 */
async function* openaiToGuardChunks(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          yield { type: "end", reason: "stop" };
          return;
        }
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = json?.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content) {
          yield { type: "delta", channel: "text", text: delta.content };
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          yield { type: "delta", channel: "reasoning", text: delta.reasoning_content };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "end", reason: "incomplete" };
}

/**
 * One streaming completion pass with repetition guarding.
 * Returns accumulated assistant text (and any tool_calls if present).
 */
async function streamOnce(messages) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages,
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Look up weather for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search_docs",
            description: "Search product documentation",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`chat.completions failed: ${response.status} ${await response.text()}`);
  }

  const textGuard = createRepetitionGuard();
  let assistantText = "";
  let aborted = null;

  for await (const chunk of guardAsyncIterable(openaiToGuardChunks(response.body), textGuard, {
    watchReasoning: true,
    onTrip(hit) {
      aborted = hit;
      console.warn("[agent-loop-guard] repetition trip:", hit.kind, "×", hit.repeats);
    },
  })) {
    if (chunk.type === "delta" && chunk.channel === "text") {
      assistantText += chunk.text;
      process.stdout.write(chunk.text);
    }
    if (chunk.type === "end" && chunk.reason === "aborted") {
      aborted = chunk.detail;
      break;
    }
  }

  return { assistantText, aborted };
}

/**
 * Demo agent loop: stream → (optional) tool calls with hard kill → repeat.
 * Tool-call parsing is stubbed; plug in your preferred SDK event parser.
 */
async function runAgentLoop(userPrompt) {
  const messages = [{ role: "user", content: userPrompt }];
  const toolGuard = createToolLoopGuard({
    killIdenticalAt: 4,
    // Optional same-name density kill (off by default):
    // killSameToolAt: 6,
    // sameToolWindow: 10,
    exclude: ["todo_write"],
  });

  // New user turn clears tool counters.
  toolGuard.resetOnUserMessage();

  const { assistantText, aborted } = await streamOnce(messages);
  if (aborted) {
    console.log("\n[stopped by repetition guard]");
    return;
  }

  // Illustrative tool dispatch — replace with real tool_calls from the stream.
  const demoCalls = [
    { name: "get_weather", args: { city: "Paris" } },
    { name: "get_weather", args: { city: "Paris" } },
    { name: "get_weather", args: { city: "Paris" } },
    { name: "get_weather", args: { city: "Paris" } },
  ];

  for (const call of demoCalls) {
    const verdict = toolGuard.check(call.name, call.args);
    if (!verdict.allowed) {
      console.warn("\n[tool-loop deny]", verdict.reason);
      messages.push({
        role: "tool",
        name: call.name,
        content: verdict.reason,
      });
      break;
    }
    const fn = tools[call.name];
    const result = fn ? await fn(call.args) : { error: "unknown tool" };
    console.log("\n[tool ok]", call.name, result, `(count=${verdict.count})`);
  }

  console.log("\n[assistant text length]", assistantText.length);
}

// Dry-run path when no API key is configured: exercise guards offline.
if (API_KEY === "sk-replace-me") {
  console.log("No OPENAI_API_KEY set — running offline guard demo.\n");

  const rep = createRepetitionGuard({ checkEveryChars: 4, minRepeats: 3, minUnitLen: 5 });
  const spam = "hello".repeat(20);
  const hit = rep.push(spam);
  console.log("repetition hit:", hit);

  const toolsGuard = createToolLoopGuard({ killIdenticalAt: 4 });
  for (let i = 1; i <= 5; i++) {
    const v = toolsGuard.check("get_weather", { city: "Paris" });
    console.log(`call #${i}:`, v.allowed ? `allowed count=${v.count}` : v.reason);
  }
} else {
  await runAgentLoop("What is the weather in Paris?");
}
