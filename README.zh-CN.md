# agent-loop-guard

**针对 LLM Agent 复读循环与工具死循环的硬熔断防护库。**

`agent-loop-guard` 是一个零运行时依赖的 TypeScript 库，用于拦截所有长时运行
Agent 迟早会遇到的两类失效模式：

1. **正文复读 / 崩溃式坍缩** — 模型输出 `abcabcabc…`、刷屏同一行，或在明显
   死循环形成之前就坍缩成碎片草稿（一字一行、破碎的 shell 片段）。
2. **工具调用刷循环** — Agent 反复用相同参数重试同一工具，而不是换思路。

与「只提醒不拦截」类插件（追加一条警告后继续生成）不同，`agent-loop-guard`
执行**硬熔断**：在流式输出中直接中止生成，并在工具调用**执行前**拒绝，
同时给出结构化的拒绝原因，可回喂给模型。

> 检测策略提炼自一个生产环境 Agent 部署，并以宿主无关的通用库形式重写。
> 默认配置不包含任何模型家族、宿主或环境绑定。

```text
零运行时依赖 · Node >= 18 · ESM · TypeScript strict · MIT
```

---

## 为什么需要

| 失效模式 | 层级 | 症状 | 防护行为 |
|---|---|---|---|
| 正文复读 / 坍缩 | 模型输出流 | 短语、行、词干反复；一字一行坍缩；破碎 shell 草稿 | 流式检测器触发熔断，中止输出，可选追加可见提示 |
| 工具刷循环 | 工具调度 | 同一工具 + 相同参数反复重试（键序打乱以躲避朴素比对） | 执行前拒绝并给出可执行建议；可选同名滑窗熔断 |

「只提醒」的方案并不能停止执行——模型继续烧 token，用户继续盯着转圈。
`agent-loop-guard` 把两层都当作熔断器：检测、停止、说明原因，由宿主决定
「恢复」意味着什么（见[可选：恢复策略](#可选恢复策略)）。

## 安装

```bash
npm install agent-loop-guard
```

要求 **Node >= 18**。本包仅发布 ESM（`"type": "module"`），附带 TypeScript
声明、source map，且没有任何运行时依赖。

```js
import {
  findRepetitionLoop,
  createRepetitionGuard,
  createToolLoopGuard,
  guardAsyncIterable,
} from "agent-loop-guard";
```

## 5 分钟接入

### 1. 对完整字符串做循环检测

```js
import { findRepetitionLoop } from "agent-loop-guard";

const hit = findRepetitionLoop("Error: retry Error: retry Error: retry");
if (hit) {
  console.log(hit);
  // { kind: "consecutive", unit: "Error: retry", repeats: 3 }
}
```

### 2. 保护流式输出

```js
import { createRepetitionGuard } from "agent-loop-guard";

const guard = createRepetitionGuard(); // 默认值：模型无关、提示开启

for await (const delta of tokenStream) {
  const hit = guard.push(delta);
  if (hit) {
    // 内部节流检查触发：停止消费，展示提示
    console.warn(`检测到循环：${hit.kind} × ${hit.repeats}`);
    break;
  }
  process.stdout.write(delta);
}
```

`push()` 会累积文本，并每积累 `checkEveryChars` 个字符（默认 `12`）才运行
一次检测器，单 token 开销可忽略不计。同一个防护器也可以监视
推理/思考流——对该流传入 `{ strict: true }`，或直接使用 `guardAsyncIterable`
（它自动维护两条通道）。

### 3. 硬熔断工具循环（OpenAI 兼容 Agent）

```js
import { createToolLoopGuard } from "agent-loop-guard";

const toolGuard = createToolLoopGuard({ killIdenticalAt: 4 });

async function runTool(name, args) {
  const verdict = toolGuard.check(name, args);
  if (!verdict.allowed) {
    // 把拒绝原因作为工具结果回喂；模型被明确告知：
    // 换参数、换思路或结束任务——不要重复。
    return { role: "tool", name, content: verdict.reason };
  }
  return executeTool(name, args); // 你的分发器
}

// 每当出现新的用户消息时：
toolGuard.resetOnUserMessage();
```

`check()` 会先对参数做规范化，因此 `{"city":"Paris","unit":"c"}` 与
`{"unit":"c","city":"Paris"}` 视为**同一次**调用——打乱键序无法绕过防护。

完整可运行的 Agent 循环（流式 + 工具）见
[`examples/openai-loop.mjs`](examples/openai-loop.mjs)；脱敏后的插件宿主
接线示意见 [`examples/plugin-host.ts`](examples/plugin-host.ts)。

## 公共 API

| 导出 | 类型 | 用途 |
|---|---|---|
| `findRepetitionLoop(text, options?)` | 纯函数 | 对完整字符串做离线检测 |
| `createRepetitionGuard(options?)` | 工厂 | 流式防护：`push(delta)` / `snapshot()` / `reset()` |
| `createToolLoopGuard(config?)` | 工厂 | 执行前防护：`check(name, args)` / `resetOnUserMessage()` / `reset()` |
| `guardAsyncIterable(source, guard, options?)` | 异步生成器 | 包装中性 chunk 的异步可迭代对象；熔断时产出 `{ type: "end", reason: "aborted", detail: hit }` |
| `DEFAULT_REPETITION_CONFIG` / `DEFAULT_TOOL_LOOP_CONFIG` / `DEFAULT_CONFIG` / `DEFAULT_NOTICE_TEXT` | 常量 | 冻结的模型无关默认值 |
| `resolveRepetitionConfig(partial?)` / `resolveToolLoopConfig(partial?)` | 函数 | 将部分覆盖合并到默认值上，并应用校验下限 |
| `normalizeStems(text)` | 纯函数 | `norm-stem` 检测器使用的 Unicode 感知词干规范化 |
| `wildcardMatch(value, patterns)` / `wildcardToRegExp(pattern)` | 工具函数 | 简单 `*` 通配匹配（不区分/区分大小写） |
| `canonicalizeToolArgs(args)` / `sortJsonValue(value)` | 工具函数 | 稳定、键序无关的 JSON 规范化 |

流式宿主使用的中性 chunk 形状：

```ts
type GuardChunk =
  | { type: "delta"; channel: "text" | "reasoning"; text: string }
  | { type: "end"; reason?: "stop" | "aborted" | "incomplete"; detail?: unknown };
```

由适配器把宿主特有事件映射到该形状；核心库不假设任何块协议。三种接线
模式见 [`docs/INTEGRATION.md`](docs/INTEGRATION.md)。

## 文本层检测器

所有检测器在累积文本的**尾部窗口**（`windowChars`，默认 `1600`）上按固定
顺序求值，首个命中即返回。命中形如 `{ kind, unit, repeats, share? }`。

| # | `kind` | 捕获目标 | 默认 | 关键阈值 |
|---|---|---|---|---|
| 1 | `consecutive` | 精确尾部单元重复（`abcabcabc`） | 开 | `minRepeats: 3`、`minUnitLen: 5`、`maxUnitLen: 96` |
| 2 | `line` | 连续相同的非空行 | 开 | `minLineRepeats: 3` |
| 3 | `norm-stem` | 变体刷屏——标点/插入语变化但词干不变（`Emit — GO`、`Emit (Write it!)`） | 开 | `minStemHits: 12`、`minStemShare: 0.35` |
| 4 | `char-split` | 早期坍缩：一字一行 / 单字符 token 碎片 | 开 | `minSingleCharLines: 40`、`minSingleCharShare: 0.3` |
| 5 | `broken-shell` | 破碎 shell 草稿：孤行 `$`、`$`+换行+标识符、孤立 cmdlet 动词 | 开 | `minBrokenShellHits: 8`（加权计分） |
| 6 | `density` | 同一多词短语在窗口内非相邻高频出现 | **关** | `minDensityHits: 8`、`densityMinLen: 20` |
| 7 | `unique-ratio` | 唯一 4-gram 比例过低（多样性崩塌） | **关** | `minUniqueRatio: 0.12`、`uniqueMinChars: 200` |

**严格模式**（用于推理/思考流）只运行 1–5 号检测器。density 与
unique-ratio 被跳过，因为长篇技术推理本来就大量复用 API 名称和标识符。

**长度门槛：** 文本短于 `minUnitLen * min(minRepeats, 3)` 个字符时完全不做
检测，短的正经输出零开销。

## 工具循环防护行为

- **参数规范化** — 参数以递归排序键的方式序列化；身份键为
  `JSON.stringify([toolName, canonicalArgs])`。
- **相同调用链** — 同一次调用（工具 + 规范化参数）重复 `killIdenticalAt`
  次（默认 `4`，允许最小 `2`）后，在**执行前**拒绝，原因中写明工具名、
  计数、阈值，以及「换参数、换思路或结束任务」的指令。
- **同名滑窗（可选）** — `killSameToolAt > 0` 时启用对被跟踪工具名的滑动
  窗口（`sameToolWindow`，默认 `10`）；达到阈值以 `kind: "same-tool"` 拒绝。
  建议运维区间：`6–8` 配窗口 `10`。默认 `0` = 关闭。
- **include / exclude 通配** — `include: []` 表示跟踪全部工具；`exclude`
  （默认 `["todo_write"]`）中的工具被完全忽略：既不计数，也不会打断相同
  调用链。
- **重置策略** — `resetOnUserMessage()` 清空相同调用链与名称窗口，允许
  跨轮次的合法重复。模型说话或工具返回**不会**重置状态。

## 配置默认值

两个配置对象均为冻结对象；向工厂传入部分覆盖即可，`resolve*Config` 会
应用校验下限（如 `minRepeats >= 2`、`killIdenticalAt >= 2`、
`checkEveryChars >= 4`、`windowChars >= 64`）。

### 复读防护（`DEFAULT_REPETITION_CONFIG`）

| 键 | 默认值 | 说明 |
|---|---|---|
| `models` | `["*"]` | 本防护适用的模型 id 通配；空数组同样表示全部 |
| `samplingModels` | `[]` | 可选采样参数注入的模型通配；**空 = 不注入** |
| `minRepeats` | `3` | `consecutive` 的重复次数（含当前单元） |
| `minUnitLen` | `5` | 参与匹配的最小单元长度 |
| `maxUnitLen` | `96` | 搜索成本上限 |
| `checkEveryChars` | `12` | 流式节流：每 N 字符运行一次检测 |
| `windowChars` | `1600` | 尾部窗口大小 |
| `minLineRepeats` | `3` | `line` 检测器阈值 |
| `enableNormStem` | `true` | `norm-stem` 检测器开关 |
| `minStemHits` | `12` | 词干命中绝对下限 |
| `minStemShare` | `0.35` | 相对占比下限（0–1） |
| `minStemLen` / `maxStemLen` | `3` / `24` | token 长度区间 |
| `enableCollapseDetect` | `true` | 同时门控 `char-split` 与 `broken-shell` |
| `minSingleCharLines` | `40` | `char-split` 绝对下限 |
| `minSingleCharShare` | `0.3` | `char-split` 占比下限 |
| `minBrokenShellHits` | `8` | 加权计分阈值 |
| `enableDensity` | `false` | 默认关闭（技术长文易误报） |
| `minDensityHits` | `8` | |
| `densityMinLen` | `20` | 偏好多词短语 |
| `enableUniqueRatio` | `false` | 默认关闭（连贯思考可能"多样性偏低"） |
| `minUniqueRatio` | `0.12` | |
| `uniqueMinChars` | `200` | |
| `appendNotice` | `true` | 熔断时追加可见提示（适配 `guardAsyncIterable` 类集成） |
| `noticeText` | 见下 | 可配置；可注入 `kind=<kind>×<repeats>` 供运维查看 |
| `watchReasoning` | `true` | `guardAsyncIterable` 同时扫描推理增量（严格模式） |
| `injectSamplingParams` | `false` | 核心从不 patch `fetch`；宿主显式选择加入 |
| `frequencyPenalty` | `0.55` | 仅当宿主实现注入时使用 |
| `presencePenalty` | `0.4` | 仅当宿主实现注入时使用 |

默认提示文案：

```text
\n\n[agent-loop-guard: repetition loop detected; generation stopped. Reply "continue" to resume.]
```

### 工具循环（`DEFAULT_TOOL_LOOP_CONFIG`）

| 键 | 默认值 | 说明 |
|---|---|---|
| `killIdenticalAt` | `4` | 相同调用次数阈值（含），最小 `2` |
| `killSameToolAt` | `0` | `0` = 关闭同名滑窗 |
| `sameToolWindow` | `10` | 滑动窗口长度 |
| `include` | `[]` | 空 = 跟踪全部工具 |
| `exclude` | `["todo_write"]` | 完全忽略 |

## 误报治理与调参

每个阈值都是召回与误报的权衡。默认值偏保守；请基于证据调参，不要凭感觉：

| 症状 | 首选旋钮 |
|---|---|
| 粘贴的正常重复日志行触发 `line` | 把 `minLineRepeats` 提到 `4–5` |
| 词汇表/教程合法复用同一关键词 | 提高 `minStemHits` / `minStemShare`，或 `enableNormStem: false` |
| 大量独立 `$` 提示符的 shell 教程 | 提高 `minBrokenShellHits` 或 `enableCollapseDetect: false` |
| 流式检查触发过早 | 提高 `checkEveryChars` |
| 工具防护误杀合法的幂等重试 | 提高 `killIdenticalAt`，或把工具加入 `exclude` |
| 「参数微调后继续刷」仍能通过 | 启用 `killSameToolAt: 6–8` 配 `sameToolWindow: 10` |

确定性保证：相同文本 + 相同配置必然得到相同结果，因此可以在离线场景用
`findRepetitionLoop` 复盘事故，先写测试钉住阈值再上生产。

## 与「只提醒」方案的对比

| | 只提醒类插件 | `agent-loop-guard` |
|---|---|---|
| 循环时停止输出 | ✗（追加警告，生成继续） | ✓ 硬熔断，返回结构化 `RepetitionHit` |
| 拒绝工具调用 | ✗ | ✓ 执行前拒绝，副作用不会发生 |
| 参数键序打乱 | 不适用/朴素字符串比对可被绕过 | 规范化直接击败 |
| 推理流感知 | 少见 | ✓ 严格模式检测器子集 |
| 宿主耦合 | 通常绑定特定宿主 | 核心宿主无关，适配器很薄 |
| 依赖 | 不等 | **零运行时依赖** |

## 可选：采样参数注入

某些模型家族在设置 `frequency_penalty` / `presence_penalty` 后循环概率更
低。`agent-loop-guard` 把它作为**可选的宿主关注点**：默认
`samplingModels: []`、`injectSamplingParams: false`，核心库从不 patch
`fetch` 或任何网络 API。如果你的宿主实现了注入，请通过 `wildcardMatch`
按 `samplingModels` 通配做门控，并把模型清单放在**你自己的**配置里——本库
不会硬编码任何厂商或模型 id。见
[`docs/INTEGRATION.md §5`](docs/INTEGRATION.md)。

## 可选：恢复策略

核心库只保证：熔断检测、结构化命中、干净的流终止。熔断后是否自动发送
「继续」消息是宿主的决定。一种常见部署策略（不属于本库）：复读熔断后最多
软恢复 2 次，退避 `[5, 15, 30]` 秒，子代理默认跳过，人工用户消息到达时
清空计数器。

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
npm test            # 构建 + node:test 套件（vitest：npm run test:vitest）
node examples/openai-loop.mjs   # 无任何 API key 的离线演示
```

CI 在 Node 18 / 20 / 22 上运行类型检查、测试与构建（见
`.github/workflows/`）。贡献指南见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 文档

- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — 三种宿主接线模式 + 可选采样注入
- [`docs/SPEC.md`](docs/SPEC.md) — 完整算法规格（检测器伪代码、默认值、契约）
- [`docs/SANITIZATION.md`](docs/SANITIZATION.md) — 本仓库强制的隐私/脱敏清单
- [`docs/PUSH_GUIDE.md`](docs/PUSH_GUIDE.md) — 发布到 GitHub 与 npm
- [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md) · [`CHANGELOG.md`](CHANGELOG.md)

## 许可证

[MIT](LICENSE) © agent-loop-guard contributors

---

*致谢：检测策略提炼自一个生产环境 Agent 部署并做了通用化。本仓库不包含
任何个人身份、私有端点或厂商特定绑定。*
