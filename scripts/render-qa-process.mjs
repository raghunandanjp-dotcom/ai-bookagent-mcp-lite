import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_RENDER_TIMEOUT_MS = 120_000;

function commandText(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

function diagnostics(stdout, stderr) {
  const details = [];
  if (stdout.trim()) details.push(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) details.push(`stderr:\n${stderr.trim()}`);
  return details.length ? `\n${details.join("\n")}` : "";
}

function pathLookup(command, platform, probe) {
  const locator = platform === "win32" ? "where.exe" : "which";
  const result = probe(locator, [command], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) return undefined;
  return result.stdout?.split(/\r?\n/u).map((entry) => entry.trim()).find(Boolean);
}

function directWindowsExecutable(command, located, pathExists) {
  if (!/\.(?:bat|cmd)$/iu.test(located)) return located;
  const directory = path.dirname(located);
  const candidates = [
    path.resolve(directory, "..", "..", "native", "poppler", "Library", "bin", `${command}.exe`),
    path.resolve(directory, "..", "Library", "bin", `${command}.exe`)
  ];
  return candidates.find(pathExists) ?? located;
}

export function discoverExecutable(command, environmentVariable, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const probe = options.probe ?? spawnSync;
  const pathExists = options.pathExists ?? existsSync;
  const override = env[environmentVariable]?.trim();
  if (override) {
    const resolved = path.isAbsolute(override) ? override : pathLookup(override, platform, probe);
    if (resolved && pathExists(resolved)) {
      return platform === "win32" ? directWindowsExecutable(command, resolved, pathExists) : resolved;
    }
    throw new Error(`${environmentVariable} does not identify an executable file: ${override}`);
  }

  const fromPath = pathLookup(command, platform, probe);
  if (fromPath && pathExists(fromPath)) {
    return platform === "win32" ? directWindowsExecutable(command, fromPath, pathExists) : fromPath;
  }

  if (platform === "win32" && command === "soffice") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      for (const name of ["soffice.com", "soffice.exe"]) {
        const candidate = path.join(root, "LibreOffice", "program", name);
        if (pathExists(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

export function renderTimeoutMs(env = process.env) {
  const raw = env.AI_BOOKAGENT_RENDER_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_RENDER_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 600_000) {
    throw new Error("AI_BOOKAGENT_RENDER_TIMEOUT_MS must be an integer from 1000 through 600000.");
  }
  return value;
}

async function terminateProcessTree(child, platform, cleanupProbe = spawnSync) {
  if (!child.pid) return "no child PID was available";
  if (platform === "win32") {
    const result = cleanupProbe("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true
    });
    if (result.status === 0) return `terminated Windows process tree ${child.pid}`;
    child.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const detail = (result.stderr || result.stdout || result.error?.message || "no taskkill diagnostics").trim();
    return `taskkill exited ${result.status}; sent SIGKILL to process ${child.pid}; taskkill: ${detail}`;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
    return `terminated process group ${child.pid}`;
  } catch {
    child.kill("SIGKILL");
    return `sent SIGKILL to process ${child.pid}`;
  }
}

export async function runBounded(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const platform = options.platform ?? process.platform;
  const spawnProcess = options.spawnProcess ?? spawn;
  const startedAt = Date.now();

  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawnProcess(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: platform !== "win32",
      shell: platform === "win32" && /\.(?:bat|cmd)$/iu.test(command),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(async () => {
      if (settled) return;
      timedOut = true;
      const cleanup = options.terminateProcessTree
        ? await options.terminateProcessTree(child, platform)
        : await terminateProcessTree(child, platform, options.cleanupProbe);
      const elapsedMs = Date.now() - startedAt;
      finish(reject, Object.assign(new Error(
        `Render command timed out after ${elapsedMs} ms (limit ${timeoutMs} ms): ${commandText(command, args)}. Cleanup: ${cleanup}.${diagnostics(stdout, stderr)}`
      ), { code: "RENDER_TIMEOUT", stdout, stderr, elapsedMs, cleanup }));
    }, timeoutMs);

    child.once("error", (error) => {
      finish(reject, Object.assign(new Error(
        `Could not start render command ${commandText(command, args)}: ${error.message}`
      ), { code: "RENDER_START_FAILED", cause: error, stdout, stderr }));
    });
    child.once("close", (status, signal) => {
      if (timedOut) return;
      const elapsedMs = Date.now() - startedAt;
      if (status === 0) {
        finish(resolve, { status, signal, stdout, stderr, elapsedMs });
        return;
      }
      finish(reject, Object.assign(new Error(
        `Render command exited with ${status ?? signal}: ${commandText(command, args)}.${diagnostics(stdout, stderr)}`
      ), { code: "RENDER_COMMAND_FAILED", status, signal, stdout, stderr, elapsedMs }));
    });
  });
}

export function libreOfficeArguments(profileDirectory, outputDirectory, inputPath) {
  return [
    `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
    "--invisible",
    "--headless",
    "--nologo",
    "--nodefault",
    "--norestore",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDirectory,
    inputPath
  ];
}

export async function convertOfficeToPdf(inputPath, outputDirectory, soffice, timeoutMs) {
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-bookagent-soffice-"));
  const configDirectory = path.join(profileDirectory, "xdg-config");
  const cacheDirectory = path.join(profileDirectory, "xdg-cache");
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(configDirectory, { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  try {
    const result = await runBounded(
      soffice,
      libreOfficeArguments(profileDirectory, outputDirectory, inputPath),
      {
        cwd: outputDirectory,
        timeoutMs,
        env: {
          ...process.env,
          HOME: profileDirectory,
          XDG_CONFIG_HOME: configDirectory,
          XDG_CACHE_HOME: cacheDirectory
        }
      }
    );
    const pdfPath = path.join(outputDirectory, `${path.parse(inputPath).name}.pdf`);
    const pdf = await stat(pdfPath).catch(() => undefined);
    if (!pdf?.isFile() || pdf.size === 0) {
      throw Object.assign(new Error(
        `LibreOffice exited successfully but did not create a non-empty PDF at ${pdfPath}.${diagnostics(result.stdout, result.stderr)}`
      ), { code: "RENDER_OUTPUT_MISSING" });
    }
    return pdfPath;
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
}

export async function rasterizePdf(pdfPath, outputPrefix, pdftoppm, timeoutMs) {
  return await runBounded(pdftoppm, ["-png", "-r", "120", pdfPath, outputPrefix], {
    cwd: path.dirname(pdfPath),
    timeoutMs,
    env: process.env
  });
}
