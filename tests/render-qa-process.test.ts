import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RENDER_TIMEOUT_MS,
  discoverExecutable,
  libreOfficeArguments,
  renderTimeoutMs,
  runBounded
} from "../scripts/render-qa-process.mjs";

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}

describe("DOCX render QA process controls", () => {
  it("discovers a standard Windows LibreOffice install when soffice is absent from PATH", () => {
    const programFiles = "C:\\Program Files";
    const expected = path.win32.join(programFiles, "LibreOffice", "program", "soffice.com");
    const result = discoverExecutable("soffice", "AI_BOOKAGENT_SOFFICE", {
      env: { ProgramFiles: programFiles },
      platform: "win32",
      probe: () => ({ status: 1, stdout: "" }),
      pathExists: (candidate: string) => candidate === expected
    });

    expect(result).toBe(expected);
  });

  it("honors an explicit executable override and rejects a missing one", () => {
    const executable = path.resolve("tools", "soffice");
    expect(discoverExecutable("soffice", "AI_BOOKAGENT_SOFFICE", {
      env: { AI_BOOKAGENT_SOFFICE: executable },
      pathExists: (candidate: string) => candidate === executable
    })).toBe(executable);
    expect(() => discoverExecutable("soffice", "AI_BOOKAGENT_SOFFICE", {
      env: { AI_BOOKAGENT_SOFFICE: path.resolve("missing", "soffice") },
      pathExists: () => false
    })).toThrow(/AI_BOOKAGENT_SOFFICE does not identify an executable file/u);
  });

  it("prefers the direct bundled Poppler executable over a Windows command shim", () => {
    const shim = "C:\\runtime\\dependencies\\bin\\override\\pdftoppm.cmd";
    const direct = "C:\\runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
    expect(discoverExecutable("pdftoppm", "AI_BOOKAGENT_PDFTOPPM", {
      env: {},
      platform: "win32",
      probe: () => ({ status: 0, stdout: `${shim}\r\n` }),
      pathExists: (candidate: string) => candidate === shim || candidate === direct
    })).toBe(direct);
  });

  it("uses a bounded configurable timeout", () => {
    expect(renderTimeoutMs({})).toBe(DEFAULT_RENDER_TIMEOUT_MS);
    expect(renderTimeoutMs({ AI_BOOKAGENT_RENDER_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(() => renderTimeoutMs({ AI_BOOKAGENT_RENDER_TIMEOUT_MS: "forever" })).toThrow(/must be an integer/u);
    expect(() => renderTimeoutMs({ AI_BOOKAGENT_RENDER_TIMEOUT_MS: "999" })).toThrow(/must be an integer/u);
  });

  it("uses a unique profile URI in the LibreOffice command", () => {
    const args = libreOfficeArguments("C:\\Temp\\profile with spaces", "C:\\Temp\\out", "C:\\Temp\\book.docx");
    const expectedUri = ["file:", "", "", "C:", "Temp", "profile%20with%20spaces"].join("/");
    expect(args[0]).toBe(`-env:UserInstallation=${expectedUri}`);
    expect(args).toEqual(expect.arrayContaining(["--headless", "--norestore", "--convert-to", "pdf"]));
  });

  it("times out, reports captured diagnostics, and cleans the process tree", async () => {
    const child = new FakeChild();
    const terminate = vi.fn(async () => "terminated test process tree");
    const promise = runBounded("soffice", ["--headless"], {
      timeoutMs: 10,
      platform: "win32",
      spawnProcess: () => child,
      terminateProcessTree: terminate
    });
    child.stdout.write("conversion started");
    child.stderr.write("renderer stalled");

    await expect(promise).rejects.toMatchObject({
      code: "RENDER_TIMEOUT",
      cleanup: "terminated test process tree",
      stdout: "conversion started",
      stderr: "renderer stalled"
    });
    expect(terminate).toHaveBeenCalledWith(child, "win32");
  });

  it("returns successful command output and rejects nonzero exits", async () => {
    const success = new FakeChild();
    const successfulRun = runBounded("renderer", [], { timeoutMs: 1_000, spawnProcess: () => success });
    success.stdout.end("done");
    success.emit("close", 0, null);
    await expect(successfulRun).resolves.toMatchObject({ status: 0, stdout: "done" });

    const failure = new FakeChild();
    const failedRun = runBounded("renderer", [], { timeoutMs: 1_000, spawnProcess: () => failure });
    failure.stderr.end("bad input");
    failure.emit("close", 7, null);
    await expect(failedRun).rejects.toMatchObject({ code: "RENDER_COMMAND_FAILED", status: 7, stderr: "bad input" });
  });
});
