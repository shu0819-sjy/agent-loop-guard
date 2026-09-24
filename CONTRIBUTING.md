# Contributing to agent-loop-guard

Thanks for considering a contribution! This project aims to stay small,
auditable, and dependency-free — the guidelines below exist to protect that.

## Development setup

Requirements: **Node >= 18** and npm. No other toolchain.

```bash
npm install
npm run typecheck   # strict tsc, zero errors required
npm run build       # compile to dist/
npm test            # build + node:test suite (vitest: npm run test:vitest)
node examples/openai-loop.mjs   # offline demo, no API key needed
```

## Ground rules

1. **Zero runtime dependencies.** `package.json` must keep
   `"dependencies": {}`. Algorithms are pure functions + closures. No
   filesystem, network, or process APIs in `src/`. Dev-only tooling (test
   runner, TypeScript) goes in `devDependencies`.
2. **Host-agnostic core.** No imports of any agent-framework SDK inside
   `src/`. Host wiring belongs in `examples/` or the integration docs, and
   must stay generic.
3. **Model-agnostic defaults.** `DEFAULT_REPETITION_CONFIG` /
   `DEFAULT_TOOL_LOOP_CONFIG` must not hard-code any vendor or model id.
   `samplingModels` stays `[]` and `injectSamplingParams` stays `false`
   unless a RFC-level decision changes it.
4. **Determinism.** Same input text + same config ⇒ same output, always.
   Detectors must not depend on time, randomness, or environment.
5. **English in code.** Comments, docstrings, and default user-facing
   notice text in English; localized notices are integrator configuration.
6. **TypeScript strict.** All compiler options in `tsconfig.json` are
   non-negotiable; new code must pass `npm run typecheck`.

## Workflow

1. Fork / branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Make your change with tests (see *Testing expectations*).
3. Run the full gate:

   ```bash
   npm run typecheck && npm test && npm run build
   ```

4. Run the sanitization scan (below) — it must report **zero hits**.
5. Open a pull request. Describe the behavior change and any default-value
   impact. Defaults changes require a `CHANGELOG.md` entry and a spec note
   in `docs/SPEC.md`.

Commit messages: conventional, imperative subject ≤ 72 chars
(`feat: add X`, `fix: clamp Y`, `docs: ...`). Keep PRs focused; stack them
if needed.

## Testing expectations

- Every detector change ships with a positive case (trips at threshold),
  a negative case (healthy text does **not** trip), and a boundary case
  (exactly at threshold).
- Tool-loop changes must cover: key-order-shuffled args, the exact deny
  index, `exclude`/`include` behavior, and `resetOnUserMessage()`.
- Streaming changes must cover: trip produces exactly one synthetic
  `end` chunk, upstream teardown runs, and `incomplete` is distinct from
  `aborted`.

## Sanitization (mandatory)

This repository must never contain personal identity, machine paths,
private endpoints, secrets, or vendor-private bindings. Before every PR:

The marker list covers the categories in
[`docs/SANITIZATION.md`](docs/SANITIZATION.md) §3 (personal names/handles,
places, machine paths, private endpoints/ports, private provider ids,
model-SKU default binds, upstream copy-paste tells, secrets). The literal
alternation pattern is maintained privately by the release engineers — it
is itself PII and must not be published. Substitute `<MARKERS>` with the
maintainer-provided pattern:

```bash
git grep -nI -E '<MARKERS>' \
  && echo "FOUND MARKERS — STOP" || echo "clean: 0 hits"
```

The full policy, categories, allowlist, and evidence protocol live in
[`docs/SANITIZATION.md`](docs/SANITIZATION.md). When in doubt, leave it out.

## Reporting issues

- Bug reports: include Node version, minimal repro, expected vs actual.
- False positives/negatives: include the minimal text sample
  (**sanitized** — no private data) plus the config used.
- Security issues: **do not** open a public issue — see
  [`SECURITY.md`](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE) of this repository.
