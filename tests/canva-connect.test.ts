import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NativeCredentialVault,
  canvaAuthorizationUrl,
  classifyCanvaTokenFailure,
  exchangeAuthorizationCode,
  importApprovedCanvaPptx,
  parseBootstrapCredentials,
  promptWindowsCredentialManagerBootstrap,
  windowsCredentialManagerBootstrapScript,
  windowsCredentialManagerScript,
  type CredentialVault
} from "../src/canva-connect.ts";
import { buildBookDesign } from "../src/design.ts";
import { createProject, saveProject } from "../src/project.ts";
import { fixtureIllustrations } from "./fixtures/illustrations.ts";

class MemoryVault implements CredentialVault {
  value: string | undefined;
  async available() { return true; }
  async get() { return this.value; }
  async set(value: string) { this.value = value; }
  async remove() { this.value = undefined; }
}

const request = { title: "Ocean Friends", theme: "ocean", ageBand: "6-8" as const, language: "en" as const, creatureCount: 1, requestedFormats: ["docx" as const] };
const content = {
  schemaVersion: "1.1" as const, title: "Ocean Friends", language: "en" as const, selectedAgeBand: "6-8" as const, effectiveAgeBand: "6-8" as const, generationAttempt: 0,
  creatures: [{ creatureId: "octopus", displayName: "Octopus", poem: { title: "Waving Arms", text: "Eight arms wave beneath the sea\nDancing wild and swimming free", language: "en" as const, reviewStatus: "needs_review" as const, structureVersion: "1.0" as const, rhymeScheme: "AAB" as const }, funFact: { text: "An octopus has three hearts.", language: "en" as const, reviewStatus: "needs_review" as const }, activity: { text: "Draw and count eight octopus arms.", language: "en" as const, reviewStatus: "needs_review" as const }, illustrationBrief: "Friendly octopus.", altText: "A smiling octopus." }]
};

describe("local Canva Connect", () => {
  let projectDir: string;
  afterEach(async () => { if (projectDir) await rm(projectDir, { recursive: true, force: true }); });

  it("uses PKCE and only the direct-import scopes", () => {
    const url = new URL(canvaAuthorizationUrl("client-id", "state", "verifier"));
    expect(url.origin + url.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3001/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("design:content:write design:meta:read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("uses PowerShell's normal masked console input for Windows credential paste", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    await promptWindowsCredentialManagerBootstrap(async (command, args) => {
      calls.push({ command, args });
      return { exitCode: 0, stderr: "" };
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("powershell.exe");
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["-NoProfile", "-Command"]));
    const script = windowsCredentialManagerBootstrapScript();
    expect(script).toContain("Read-Host");
    expect(script).toContain("-AsSecureString");
    expect(script).toContain("CredWrite");
    expect(script).toContain("Ctrl+V paste supported");
    expect(script).toContain("SysStringByteLen");
    expect(windowsCredentialManagerScript("get")).toContain("Unicode.GetString");
    expect(script).toContain("__bookagent_canva_bootstrap__:");
    expect(script).not.toContain("actual-secret");
    expect(parseBootstrapCredentials(JSON.stringify({ clientId: "client", clientSecret: "secret" }))).toEqual({ clientId: "client", clientSecret: "secret" });
  });

  it("exchanges OAuth only through a mocked HTTPS request and never puts the secret in the result", async () => {
    const headers: string[] = [];
    const credentials = await exchangeAuthorizationCode(async (_url, init) => {
      headers.push(String((init?.headers as Record<string, string>).authorization));
      return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 60 }), { status: 200 });
    }, "client", "not-in-output", "code", "verifier");
    expect(headers[0]).toMatch(/^Basic /u);
    expect(credentials).toMatchObject({ clientId: "client", refreshToken: "refresh", accessToken: "access" });
  });

  it("classifies a token failure by HTTP status without parsing or exposing its error payload", async () => {
    expect(classifyCanvaTokenFailure(401)).toEqual({ phase: "token_exchange", classification: "client_auth_rejected", httpStatus: 401 });
    try {
      await exchangeAuthorizationCode(async () => new Response(JSON.stringify({ message: "provider-body-must-not-appear" }), { status: 401 }), "client", "secret", "code", "verifier");
      throw new Error("expected token exchange to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "oauth_failed",
        retryable: false,
        diagnostic: { phase: "token_exchange", classification: "client_auth_rejected", httpStatus: 401 }
      });
      expect(String(error)).not.toContain("provider-body-must-not-appear");
    }
  });

  it("imports only a freshly generated approved PPTX and records a genuine editable Canva URL", async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), "bookagent-canva-connect-"));
    const { assets } = await fixtureIllustrations(projectDir, ["octopus"]);
    const design = { ...buildBookDesign(content, assets, 4, 2), status: "approved" as const, approvedAt: "2026-09-02T10:00:00.000Z", approvedBy: "Reviewer" };
    const created = createProject(request);
    await saveProject(projectDir, {
      ...created, revision: 9, sourceRevision: 4, content, illustrations: assets, design,
      exports: [{ format: "docx", relativePath: "exports/ocean-friends.docx", sha256: "d".repeat(64), bytes: 1, createdAt: "2026-09-02T10:00:00.000Z", sourceRevision: 4, designRevision: 2, illustrationSetDigest: design.illustrationSetDigest }],
      primaryOutput: { status: "accepted", sourceRevision: 4, designRevision: 2, illustrationSetDigest: design.illustrationSetDigest, sha256: "d".repeat(64), relativePath: "exports/ocean-friends.docx", acceptedAt: "2026-09-02T10:00:00.000Z" },
      canva: { status: "consented", readiness: "ready", checkedAt: "2026-09-02T10:00:00.000Z", consentedAt: "2026-09-02T10:01:00.000Z", sourceRevision: 4, designRevision: 2, illustrationSetDigest: design.illustrationSetDigest }
    });
    const vault = new MemoryVault();
    vault.value = JSON.stringify({ clientId: "client", clientSecret: "secret", refreshToken: "refresh" });
    const calls: Array<{ url: string; contentType?: string }> = [];
    const result = await importApprovedCanvaPptx(projectDir, vault, async (url, init) => {
      calls.push({ url: String(url), contentType: (init?.headers as Record<string, string> | undefined)?.["content-type"] });
      if (String(url).endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "access", refresh_token: "new-refresh", expires_in: 300 }), { status: 200 });
      if (String(url).endsWith("/imports")) return new Response(JSON.stringify({ job: { id: "job-1" } }), { status: 200 });
      return new Response(JSON.stringify({ job: { status: "success", result: { designs: [{ id: "DAGabc", urls: { edit_url: "https://www.canva.com/design/DAGabc/edit" } }] } } }), { status: 200 });
    }, async () => undefined);
    expect(result).toMatchObject({ outcome: "success", designId: "DAGabc", pageCount: design.pages.length, pptxSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ url: expect.stringMatching(/\/imports$/u), contentType: "application/octet-stream" })]));
    expect(vault.value).toContain("new-refresh");
  }, 20_000);

  it("sends a Linux vault secret on stdin rather than in a command argument", async () => {
    const calls: Array<{ args: string[]; stdin?: string }> = [];
    const vault = new NativeCredentialVault("linux", async (_command, args, stdin) => { calls.push({ args, stdin }); return { exitCode: args[0] === "--version" ? 0 : 0, stdout: "", stderr: "" }; });
    await vault.set("do-not-leak");
    expect(calls[0]!.args).not.toContain("do-not-leak");
    expect(calls[0]!.stdin).toBe("do-not-leak");
  });

  it("uses a fixed Windows Credential Manager helper and sends credential JSON only on stdin", async () => {
    const calls: Array<{ command: string; args: string[]; stdin?: string }> = [];
    const vault = new NativeCredentialVault("win32", async (command, args, stdin) => {
      calls.push({ command, args, stdin });
      if (args.at(-1)?.includes("CredRead")) return { exitCode: 0, stdout: "", stderr: "" };
      return { exitCode: 0, stdout: "stored", stderr: "" };
    });
    expect(await vault.available()).toBe(true);
    await vault.set("secret that must not reach argv");
    expect(calls[0]!.command).toMatch(/powershell/u);
    expect(calls[1]!.args.join(" ")).not.toContain("secret that must not reach argv");
    expect(calls[1]!.stdin).toBe(JSON.stringify({ value: "secret that must not reach argv" }));
    expect(windowsCredentialManagerScript("set")).toContain("CredWrite");
    expect(windowsCredentialManagerScript("set")).not.toContain("secret that must not reach argv");
  });
});
