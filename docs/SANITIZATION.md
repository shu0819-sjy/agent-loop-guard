# Sanitization policy — agent-loop-guard

This project was extracted from a private production agent setup. The
published tree, git history, examples, and docs must contain **no personal
identity, machine path, private endpoint, employer, school, device
hostname, or vendor-private binding**.

> **Why this file does not list the literal markers:** the literal marker
> values (a real name, a handle, a city, a hostname, a channel id, …) are
> themselves the private information this policy protects. The concrete
> alternation pattern is maintained by the release engineers *outside* the
> repository; this document publishes the policy, the categories, and the
> procedure so any contributor can comply without the private list.

Upstream reference material is **read-only**. Nothing may be copied verbatim
from it into this package — algorithms are implemented from
[`SPEC.md`](SPEC.md).

---

## 1. Rules

1. Library defaults must be **model-agnostic**. No upstream model-family
   glob may ship as a package default (`samplingModels: []`,
   `injectSamplingParams: false`, `models: ["*"]`).
2. Copyright / author fields: only `agent-loop-guard contributors` (or
   equivalent anonymous project identity). No real names, no personal
   emails, no `@handles`.
3. Git identity for commits: a neutral, repo-scoped identity or the
   contributor's chosen public identity. Never a private address or an
   employer identity.
4. Examples may mention generic host concepts ("llm stream hook",
   "tools pre-execute") but must not require a private checkout path, port,
   or profile layout.
5. Notice strings: English default; optional localized templates must stay
   generic — no personal nicknames, no internal product codenames.
6. If a forbidden string appears in a comment or doc inherited from
   upstream, **rewrite the surrounding text** — do not merely delete one
   token and leave context that re-identifies (this applies to file names
   too: a filename fragment of a private system is a fingerprint).
7. If in doubt whether something identifies the source setup, leave it out.

## 2. Required default changes vs upstream

The upstream production deployment pinned a specific flash-class model
family, injected sampling parameters by default, and used personal/host-
specific notice copy. The open-source package deliberately changes all of
this:

| Upstream production behavior | OSS required default | Why |
|---|---|---|
| `samplingModels` pinned to a flash-class model-family glob | `samplingModels: []` | Model-family binding is environment-specific; empty = do not inject |
| Sampling-param injection enabled (fetch monkey-patch) | `injectSamplingParams: false` | Core must not patch networking by default |
| Stream guard bound to one model SKU | `models: ["*"]` (or empty = all) | Guard is useful beyond one SKU |
| Personal / host-specific notice copy (non-English) | English generic `noticeText` | Portable; localized notices are integrator config |
| Absolute machine paths / profile plugin paths in samples | Relative `./examples/...` only | No machine paths |
| Named private channels / local ports in patch samples | Omit or use placeholders (`PORT`, `HOST`) | No fingerprinting |

Algorithm thresholds may keep upstream **numeric** defaults where safe
(`minRepeats: 3`, `killIdenticalAt: 4`, etc.). Patch-file overrides (e.g.
raising `minRepeats`, enabling `enableDensity`) are **deployment choices**,
not library defaults — document them in
[`INTEGRATION.md`](INTEGRATION.md), do not bake them into `DEFAULT_*`.

## 3. Forbidden marker categories (zero hits required)

The release-engineer scan pattern matches literals in these categories.
Every category must have **zero matches** in tracked files:

| # | Category | Examples of what is matched (generic) | Forbidden in |
|---|---|---|---|
| 1 | Real names & handles | any person's name in Latin or CJK script; login-style ids | authors, emails, paths, comments, strings |
| 2 | Cities / schools / employers | place or institution names tied to the source setup | everywhere |
| 3 | Device hostnames | gaming-hardware brand strings used as machine names | everywhere |
| 4 | Machine & path fingerprints | Windows user-profile roots, private checkout roots, private workspace folder names, host data-dir layouts | comments, samples, error text |
| 5 | Private endpoints & local services | loopback addresses with nonstandard ports; editor/service ports | everywhere |
| 6 | Secrets | API keys, tokens, cookies (real or plausible) | everywhere — also see [`SECURITY.md`](../SECURITY.md) |
| 7 | Private provider / channel ids | internal provider abbreviations, channel ids, internal product/team nicknames | defaults, examples, docs |
| 8 | Model-SKU default binds | concrete model ids / family globs as package defaults | `DEFAULT_*`, factory defaults |
| 9 | Upstream copy-paste tells | the exact upstream operator-facing notice strings; unrelated plugin codenames; unrelated tooling names from the private profile | comments, strings, filenames |
| 10 | Private repo / org names | internal repository, team, or project names | everywhere |

## 4. Scan procedure

The literal alternation pattern (`<MARKERS>`) is provided to release
engineers privately. Run from the repository root:

```bash
# Scan everything git actually tracks (this is what GitHub/npm see):
git grep -nI -E '<MARKERS>' \
  && echo "FOUND MARKERS — STOP" || echo "clean: 0 hits"

# Broader working-tree scan (before the first commit exists):
rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' \
  --glob '!_upstream/**' '<MARKERS>'
```

Expected result for a releasable tree: **no matches**.

Notes:

- Exclude `node_modules/`, `.git/`, local caches, and any local `_upstream/`
  mirror from the *scan paths* — but understand that anything tracked by git
  or inside the npm `files` whitelist (including `dist/`) **is** scanned.
- If a hit is a false positive (a common word colliding with a marker),
  **tighten the pattern** — never add exceptions that re-allow real PII.
- Re-run before every push and before every `npm publish`.

## 5. What may remain (allowlist)

| Content | OK? |
|---|---|
| Algorithm names (`norm-stem`, `broken-shell`, …) | Yes |
| Generic tool name `todo_write` as default exclude | Yes (common agent pattern; not personal) |
| Words `PowerShell`, `cmdlet`, `frequency_penalty` | Yes |
| Example model string like a public vendor's mini model in **examples only** | Yes, as a public vendor illustration |
| Phrase "extracted from a production agent setup" in README | Yes — do not name the setup |
| Dual-language README | Yes |
| MIT license text | Yes |

## 6. Evidence protocol (release engineers / reviewers)

Before release, attach to the release notes / task output:

1. Command(s) run (§4 or equivalent).
2. Match count = 0 (paste the summary line).
3. Confirmation `package.json` has `"dependencies": {}` and no private
   registry URLs.
4. Confirmation the LICENSE copyright line is anonymous.
5. Confirmation `samplingModels` is `[]` and `injectSamplingParams` is
   `false` in `DEFAULT_REPETITION_CONFIG`.
6. Confirmation no filename in the tree contains a fragment of a private
   system's name.

## 7. Upstream file handling

| Source material | Action |
|---|---|
| Upstream reference implementation (workspace-external, read-only) | Reference only; never copy verbatim into the package |
| Optional resume-policy inspiration from the private setup | Ideas only; not vendored |
| Live host plugin files | Out of scope; never opened into the package |

Implementers rewrite algorithms from [`SPEC.md`](SPEC.md), never by pasting
upstream file headers or operator-facing strings.

---

End of sanitization policy.
