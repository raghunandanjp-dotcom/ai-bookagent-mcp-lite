import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const npmExecPath = process.env.npm_execpath ?? (process.platform === "win32" ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js") : undefined);
const npmCommand = npmExecPath ? process.execPath : "npm";
const npmArgs = npmExecPath ? [npmExecPath] : [];
const npmCache = process.env.AI_BOOKAGENT_NPM_CACHE ?? path.join(os.tmpdir(), "ai-bookagent-npm-cache");
const temporary = await mkdtemp(path.join(os.tmpdir(), "ai-bookagent-package-"));

function run(command, args, cwd, expectedStatuses = [0], timeout = 30_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, npm_config_cache: npmCache, npm_config_update_notifier: "false" }
  });
  if (result.error || !expectedStatuses.includes(result.status)) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw result.error ?? new Error(`${command} ${args.join(" ")} exited with ${result.status}.`);
  }
  return result;
}

async function assertServerStarts(entrypoint, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let stopping = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (stopping || code === 0) resolve();
      else reject(new Error(`Installed MCP server exited during startup with ${code ?? signal}: ${stderr}`));
    });
    child.stdin.end();
    setTimeout(() => {
      stopping = true;
      child.kill();
    }, 1_000);
  });
}

try {
  const packed = run(npmCommand, [...npmArgs, "pack", "--json", "--ignore-scripts", "--pack-destination", temporary], process.cwd());
  const [report] = JSON.parse(packed.stdout);
  const tarball = path.join(temporary, report.filename);
  await access(tarball);

  const installDir = path.join(temporary, "install");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(installDir));
  run(npmCommand, [...npmArgs, "init", "--yes"], installDir);
  run(npmCommand, [...npmArgs, "install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], installDir, [0], 120_000);

  const packageDir = path.join(installDir, "node_modules", "ai-bookagent-mcp-lite");
  const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  for (const entrypoint of Object.values(manifest.bin)) await access(path.join(packageDir, entrypoint));
  for (const asset of ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "OFL.txt"]) {
    await access(path.join(packageDir, "assets", "fonts", asset));
  }

  const cli = run(process.execPath, [path.join(packageDir, manifest.bin["ai-bookagent"])], installDir, [2]);
  if (!cli.stderr.includes("Usage:")) throw new Error("Installed CLI did not print its usage message.");

  await assertServerStarts(path.join(packageDir, manifest.bin["ai-bookagent-mcp"]), installDir);

  console.log(`Packed-package smoke passed for ${report.filename}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
