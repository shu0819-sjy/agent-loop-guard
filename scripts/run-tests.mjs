/**
 * Sandbox-friendly runner: node:test against built dist/.
 * Used when vitest cannot spawn workers (restricted Windows sandboxes);
 * `npm test` runs this, while `npm run test:vitest` runs the vitest suite.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
  cwd: root,
  shell: true,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const nodeTestDir = join(root, "tests", "node");
const files = readdirSync(nodeTestDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => join(nodeTestDir, f));

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
