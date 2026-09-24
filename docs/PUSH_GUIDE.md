# Push & publish guide — agent-loop-guard

This repository is prepared so that **anyone** can publish it to GitHub (and
optionally npm) under their own account. The working copy already contains a
local git repository initialized with a **neutral, repo-scoped identity**; no
personal name, email, machine path, or key appears anywhere in the tree or the
initial commit.

- [1. Current git state](#1-current-git-state)
- [2. Set your own author identity](#2-set-your-own-author-identity)
- [3. Create the GitHub repository and push](#3-create-the-github-repository-and-push)
- [4. Post-push checklist](#4-post-push-checklist)
- [5. Optional: publish to npm](#5-optional-publish-to-npm)
- [6. Pre-flight: sanitization re-check](#6-pre-flight-sanitization-re-check)

---

## 1. Current git state

The package directory ships with:

- A local `main` branch with a single initial commit
  (`chore: initial release of agent-loop-guard v0.1.0`).
- A **repo-local** git identity (not your global one):

  ```bash
  git config user.name  agent-loop-guard
  git config user.email agent-loop-guard@users.noreply.github.com
  ```

- `.gitignore` already excludes `node_modules/`, `dist/`, `.npm-cache/`,
  `_upstream/`, logs, coverage, and editor dirs — nothing machine-specific is
  tracked.

Verify at any time:

```bash
git log --format="%h %an <%ae> %s"      # confirm commit author
git config --local --list                # repo-local settings
git ls-files                             # exactly what is tracked
```

If you received this project as a folder *without* `.git/` (e.g. a zip
archive), initialize it yourself:

```bash
git init -b main
git config user.name  "Your Name"
git config user.email "you@example.com"
git add -A
git commit -m "chore: initial release of agent-loop-guard v0.1.0"
```

## 2. Set your own author identity

The initial commit is authored by the neutral identity above. To publish
under your own identity, either:

**Option A — amend before pushing (rewrites the single commit):**

```bash
git config user.name  "Your Name"
git config user.email "you@example.com"
git commit --amend --no-edit --reset-author
```

**Option B — keep the neutral author** and simply set your identity for
future commits:

```bash
git config user.name  "Your Name"
git config user.email "you@example.com"
```

> Reminder: whatever identity you choose becomes **public** on GitHub.
> Use `YOURNAME@users.noreply.github.com` (GitHub → Settings → Emails →
> "Keep my email addresses private") if you prefer not to expose a personal
> address. Do not commit any real name you do not want published.

## 3. Create the GitHub repository and push

### Option A — GitHub CLI (`gh`)

```bash
# Authenticate once:
gh auth login

# Create the repo and push in one step (choose public or private):
gh repo create agent-loop-guard --public --source=. --remote=origin --push
# or: gh repo create agent-loop-guard --private --source=. --remote=origin --push
```

### Option B — web UI + plain git

1. Create an empty repository named `agent-loop-guard` at
   `https://github.com/new` (no README/license initialization — the tree
   already has them).
2. Add the remote and push:

   ```bash
   git remote add origin https://github.com/<your-account>/agent-loop-guard.git
   git push -u origin main
   ```

3. Tag the release (optional but recommended):

   ```bash
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```

## 4. Post-push checklist

- [ ] CI (GitHub Actions) ran green on Node 18 / 20 / 22 — see
      `.github/workflows/`.
- [ ] Replace the `github.com/example/...` placeholder URLs in
      `package.json` (`repository`, `bugs`, `homepage`) with your real repo
      URL, then commit and push the change.
- [ ] Update the CI badge in `README.md` / `README.zh-CN.md` with your
      `<account>` / repo path.
- [ ] Enable GitHub **Security Advisories** for private vulnerability reports
      (repo → Security → Advisories) — matches `SECURITY.md`.
- [ ] Optionally enable branch protection / require CI on `main`.

## 5. Optional: publish to npm

### 5.1 Check the name is free

```bash
npm view agent-loop-guard version        # "404 Not Found" means the name is free
npm search agent-loop-guard              # see near-name collisions
```

If the exact name is taken, publish under a scope instead
(`@<your-scope>/agent-loop-guard`) and update `package.json` `name`
accordingly.

### 5.2 Prepare

```bash
npm login                 # browser-based login; 2FA supported
npm whoami                # confirm
```

The package manifest is already publish-ready:

- `"files"` whitelist ships only `dist`, `LICENSE`, `README.md`,
  `README.zh-CN.md`, and `examples` — `node_modules`, tests scratch space,
  and caches never enter the tarball.
- `"prepack"` runs `npm run build`, so `dist/` is rebuilt fresh at publish
  time.
- Zero runtime dependencies; `engines.node >= 18`; ESM-only with
  declarations.

Dry-run and inspect the tarball first:

```bash
npm pack --dry-run        # lists every file that would ship
npm publish --dry-run     # full rehearsal without publishing
```

### 5.3 Publish

```bash
npm publish               # add --access public only for scoped packages
```

npm will ask for a one-time password if 2FA is enabled on your account.

### 5.4 After publishing

```bash
npm view agent-loop-guard           # verify metadata
npm i agent-loop-guard              # smoke-test in a scratch dir
```

Then replace the `github.com/example/...` placeholders in `package.json`
(see §4) — npm resolves the repository link from that field. Do not bump the
version manually; use `npm version patch|minor|major` and push tags.

## 6. Pre-flight: sanitization re-check

Before **every** push or publish, re-run the marker scan from
[`docs/SANITIZATION.md`](SANITIZATION.md) and confirm **zero hits** on
tracked files. The literal alternation pattern (`<MARKERS>`) is maintained
privately by the release engineers — it is itself PII and must never be
published in the repo:

```bash
# Scan everything git actually tracks (this is what GitHub/npm see):
git grep -nI -E '<MARKERS>' \
  && echo "FOUND MARKERS — STOP" || echo "clean: 0 hits"
```

If any hit appears, fix it **before** pushing — git history is effectively
permanent once public. See `SANITIZATION.md` §6 for the evidence protocol.
