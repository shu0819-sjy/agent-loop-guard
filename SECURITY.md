# Security policy — agent-loop-guard

## Supported versions

| Version | Supported |
|---|---|
| `0.1.x` | ✅ |

Only the latest minor line receives security fixes. Upgrades within a minor
are drop-in (defaults documented in the README and `docs/SPEC.md`).

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Preferred channels, in order:

1. **GitHub private vulnerability reporting** — repository → *Security* →
   *Report a vulnerability* (if enabled on the repo you are reading this in).
2. Otherwise, open a GitHub issue titled only
   `security: contact request` with **no technical details**, and the
   maintainers will follow up to arrange a private channel.

Please include:

- Affected version(s) and import path(s).
- A minimal reproduction (sanitized — never include secrets, tokens, or
  private data in any artifact you share).
- Impact assessment: what an attacker could cause.

You can expect an initial response within **7 days** and a coordinated fix
timeline agreed in the private thread. Credit is optional and anonymous by
default.

## Scope

In scope:

- The published npm package `agent-loop-guard` and the source in `src/`.
- Bypasses of the core guarantees: a repetition loop that should trip but
  does not under the documented contract, or a tool-loop deny that can be
  evaded (e.g. argument-canonicalization collisions).
- Prototype pollution / injection through tool arguments processed by
  `sortJsonValue` / `canonicalizeToolArgs`.
- Denial-of-service via pathological input driving detector cost
  super-linearly.

Out of scope:

- Misconfiguration by integrators (e.g. enabling `injectSamplingParams`
  against the wrong models, or shipping real API keys in their own config).
- The example files (`examples/`), which are illustrative and not meant for
  production use as-is.
- Host frameworks and adapters this library is wired into.

## Design posture

- **Zero runtime dependencies** — no transitive supply-chain surface.
- The core performs no I/O: no filesystem, network, process, or
  environment access. It cannot exfiltrate anything by itself.
- No telemetry, no phone-home, no data collection of any kind.
- Text and tool arguments are processed in-memory only; nothing is
  persisted or logged by the library.
- Notice and deny strings are static templates; model/user content is never
  embedded into executable contexts.

## Secrets hygiene

Never commit API keys, tokens, or cookies to this repository (or any
repository). The sanitization scan in `docs/SANITIZATION.md` also guards
against machine-specific fingerprints. If you believe a secret was ever
committed, rotate it immediately — history rewrites are secondary to
rotation.

## Policy for default-value changes

Default thresholds are security-relevant for deploying agents. Changes to
`DEFAULT_*` values require: a `CHANGELOG.md` entry, updated tables in the
READMEs and `docs/SPEC.md`, and tests pinning the new behavior. The
model-agnostic rule (`samplingModels: []`, `injectSamplingParams: false`,
no vendor ids) is treated as a hard invariant.
