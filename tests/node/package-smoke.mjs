import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-loop-guard-pack-"));
const installRoot = join(temporaryRoot, "install");
mkdirSync(installRoot);
const configuredNode = process.env.npm_node_execpath;
const npmScript = process.env.npm_execpath;
const npmScriptIsAvailable = npmScript && existsSync(npmScript);
const nodeCommand = configuredNode && existsSync(configuredNode)
  ? configuredNode
  : npmScriptIsAvailable
    ? "node"
    : process.execPath;
const localNpmCli = join(dirname(nodeCommand), "node_modules", "npm", "bin", "npm-cli.js");
const npmCli = npmScriptIsAvailable ? npmScript : existsSync(localNpmCli) ? localNpmCli : null;
const npmCommand = npmCli ? nodeCommand : "npm";
const npmPrefix = npmCli ? [npmCli] : [];

function run(command, args, cwd) {
  /** 执行本地进程并保留失败状态，让 CI 正确报错。 */
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
  });
}

try {
  const packJson = execFileSync(
    npmCommand,
    [...npmPrefix, "pack", "--json", "--pack-destination", temporaryRoot],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
  const packResult = JSON.parse(packJson);
  const packageName = packResult[0]?.filename;
  if (typeof packageName !== "string" || packageName.length === 0) {
    throw new Error("npm pack did not report a package filename");
  }
  const packagePath = join(temporaryRoot, packageName);
  if (readFileSync(packagePath).length === 0) {
    throw new Error("npm pack produced an empty archive");
  }

  run(
    npmCommand,
    [...npmPrefix, "install", "--ignore-scripts", "--no-save", "--prefix", installRoot, packagePath],
    repositoryRoot,
  );
  run(
    nodeCommand,
    [
      "--input-type=module",
      "-e",
      "import('agent-loop-guard').then((pkg) => { if (typeof pkg.createRepetitionGuard !== 'function') process.exit(1); console.log('package import ok'); })",
    ],
    installRoot,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
