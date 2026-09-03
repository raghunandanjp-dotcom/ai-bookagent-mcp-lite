import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { exportPptx } from "./exporters.ts";
import { resolveApprovedIllustrations } from "./illustrations.ts";
import { fileDigest, loadProject, resolveInside, safeOutputName, saveProject, type BookProject } from "./project.ts";
import { recordCanvaResult } from "./canva.ts";

/** This integration is deliberately local-only.  Nothing in this module is an MCP tool. */
export const CANVA_CONNECT_SCOPES = ["design:content:write", "design:meta:read"] as const;
export const CANVA_CONNECT_REDIRECT_URI = "http://127.0.0.1:3001/oauth/callback";
const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const IMPORT_URL = "https://api.canva.com/rest/v1/imports";
const VAULT_SERVICE = "AI Book Agent MCP Lite Canva Connect";
const VAULT_ACCOUNT = "default";

export type CanvaConnectFailureCode =
  | "secure_storage_unavailable" | "not_configured" | "oauth_failed" | "authorization_expired"
  | "consent_required" | "canonical_source_mismatch" | "asset_integrity_mismatch"
  | "import_rejected" | "import_timeout" | "import_response_invalid" | "local_pptx_unavailable";

export class CanvaConnectError extends Error {
  constructor(readonly code: CanvaConnectFailureCode, readonly retryable: boolean, message: string) {
    super(message);
    this.name = "CanvaConnectError";
  }
}

export interface CanvaCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
}

export interface CredentialVault {
  available(): Promise<boolean>;
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

interface CommandResult { exitCode: number; stdout: string; stderr: string; }
type CommandRunner = (command: string, args: string[], stdin?: string) => Promise<CommandResult>;

function runCommand(command: string, args: string[], stdin?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (data: string) => { stdout += data; });
    child.stderr.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

/**
 * OS vault bridge. Secrets travel through stdin, never a CLI argument, project file,
 * environment variable, log, MCP argument, or returned command result.
 * Linux requires libsecret's `secret-tool`; macOS/Windows use the native keychain APIs
 * through short fixed scripts. A missing vault is a hard failure.
 */
export class NativeCredentialVault implements CredentialVault {
  constructor(private readonly platform = process.platform, private readonly runner: CommandRunner = runCommand) {}

  async available(): Promise<boolean> {
    try {
      const result = await this.run("probe");
      return result.exitCode === 0;
    } catch { return false; }
  }

  async get(): Promise<string | undefined> {
    const result = await this.run("get");
    if (result.exitCode === 44) return undefined;
    if (result.exitCode !== 0) throw new CanvaConnectError("secure_storage_unavailable", false, "Secure OS credential storage is unavailable.");
    return result.stdout.trim() || undefined;
  }

  async set(value: string): Promise<void> {
    const result = await this.run("set", value);
    if (result.exitCode !== 0) throw new CanvaConnectError("secure_storage_unavailable", false, "Secure OS credential storage is unavailable.");
  }

  async remove(): Promise<void> {
    const result = await this.run("remove");
    if (result.exitCode !== 0 && result.exitCode !== 44) throw new CanvaConnectError("secure_storage_unavailable", false, "Secure OS credential storage is unavailable.");
  }

  private async run(operation: "probe" | "get" | "set" | "remove", value?: string): Promise<CommandResult> {
    if (this.platform === "linux") {
      if (operation === "probe") return this.runner("secret-tool", ["--version"]);
      if (operation === "get") {
        const result = await this.runner("secret-tool", ["lookup", "service", VAULT_SERVICE, "account", VAULT_ACCOUNT]);
        return result.exitCode === 1 ? { ...result, exitCode: 44 } : result;
      }
      if (operation === "set") return this.runner("secret-tool", ["store", "--label", VAULT_SERVICE, "service", VAULT_SERVICE, "account", VAULT_ACCOUNT], value);
      const result = await this.runner("secret-tool", ["clear", "service", VAULT_SERVICE, "account", VAULT_ACCOUNT]);
      return result.exitCode === 1 ? { ...result, exitCode: 44 } : result;
    }
    // The PowerShell program is fixed source; credential JSON travels through the
    // child's stdin pipe, never an argv value. macOS still deliberately fails
    // closed until its equivalent native Keychain bridge is shipped and exercised.
    const script = this.platform === "win32" ? windowsCredentialManagerScript(operation) : this.platform === "darwin" ? macosVaultScript(operation) : undefined;
    if (!script) return { exitCode: 2, stdout: "", stderr: "unsupported platform" };
    const shell = this.platform === "win32" ? "powershell.exe" : "/usr/bin/osascript";
    const args = this.platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-Command", script]
      : ["-l", "JavaScript", "-e", script];
    return this.runner(shell, args, value === undefined ? undefined : JSON.stringify({ value }));
  }
}

// Windows Credential Manager via CredRead/CredWrite. No credential value appears in args.
/** Fixed helper source; it contains no credential values. */
export function windowsCredentialManagerScript(operation: "probe" | "get" | "set" | "remove"): string {
  const common = `$ErrorActionPreference='Stop'; Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BookAgentCredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("Advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr credential);
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
}
'@;
$target='AI Book Agent MCP Lite Canva Connect/default';
`;
  if (operation === "probe") return `${common}$ptr=[IntPtr]::Zero; [void][BookAgentCredMan]::CredRead($target,1,0,[ref]$ptr); if($ptr -ne [IntPtr]::Zero){[BookAgentCredMan]::CredFree($ptr)}; exit 0`;
  if (operation === "get") return `${common}$ptr=[IntPtr]::Zero; if(-not [BookAgentCredMan]::CredRead($target,1,0,[ref]$ptr)){ if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168){exit 44}; exit 2 }; try { $credential=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][BookAgentCredMan+CREDENTIAL]); $bytes=New-Object byte[] ([int]$credential.CredentialBlobSize); if($bytes.Length -gt 0){[Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob,$bytes,0,$bytes.Length)}; [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes)); [Array]::Clear($bytes,0,$bytes.Length) } finally { [BookAgentCredMan]::CredFree($ptr) }`;
  if (operation === "set") return `${common}$raw=[Console]::In.ReadToEnd(); $payload=$raw | ConvertFrom-Json; $bytes=[Text.Encoding]::UTF8.GetBytes([string]$payload.value); $length=$bytes.Length; if($length -eq 0){exit 2}; $blob=[Runtime.InteropServices.Marshal]::AllocCoTaskMem($length); try { [Runtime.InteropServices.Marshal]::Copy($bytes,0,$blob,$length); $credential=New-Object BookAgentCredMan+CREDENTIAL; $credential.Type=1; $credential.TargetName=$target; $credential.CredentialBlobSize=[uint32]$length; $credential.CredentialBlob=$blob; $credential.Persist=2; $credential.UserName='AI Book Agent MCP Lite'; if(-not [BookAgentCredMan]::CredWrite([ref]$credential,0)){exit 2} } finally { [Array]::Clear($bytes,0,$length); if($blob -ne [IntPtr]::Zero){ $zero=New-Object byte[] $length; [Runtime.InteropServices.Marshal]::Copy($zero,0,$blob,$length); [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob) } }`;
  return `${common}if(-not [BookAgentCredMan]::CredDelete($target,1,0)){ if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168){exit 44}; exit 2 }`;
}

// JXA can use the Security framework, but this repository does not ship a native bridge.
function macosVaultScript(operation: string): string {
  void operation;
  return "$.exit(2)";
}

export function parseStoredCredentials(value: string): CanvaCredentials {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.clientId !== "string" || typeof parsed.clientSecret !== "string" || typeof parsed.refreshToken !== "string" || !parsed.clientId || !parsed.clientSecret || !parsed.refreshToken) throw new Error();
    return {
      clientId: parsed.clientId, clientSecret: parsed.clientSecret, refreshToken: parsed.refreshToken,
      ...(typeof parsed.accessToken === "string" ? { accessToken: parsed.accessToken } : {}),
      ...(typeof parsed.accessTokenExpiresAt === "string" ? { accessTokenExpiresAt: parsed.accessTokenExpiresAt } : {})
    };
  } catch { throw new CanvaConnectError("not_configured", false, "Canva Connect is not configured in this OS account."); }
}

export async function canvaConnectStatus(vault: CredentialVault): Promise<{ configured: boolean; secureStorage: boolean }> {
  const secureStorage = await vault.available();
  if (!secureStorage) return { configured: false, secureStorage: false };
  return { configured: Boolean(await vault.get()), secureStorage: true };
}

export function canvaAuthorizationUrl(clientId: string, state: string, verifier: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", CANVA_CONNECT_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CANVA_CONNECT_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type FetchLike = typeof fetch;
async function tokenRequest(fetcher: FetchLike, credentials: Pick<CanvaCredentials, "clientId" | "clientSecret">, form: URLSearchParams): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const response = await fetcher(TOKEN_URL, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") throw new CanvaConnectError("oauth_failed", true, "Canva authorization could not be completed. Reauthorize or try again.");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : 300 };
}

export async function exchangeAuthorizationCode(fetcher: FetchLike, clientId: string, clientSecret: string, code: string, verifier: string): Promise<CanvaCredentials> {
  const token = await tokenRequest(fetcher, { clientId, clientSecret }, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CANVA_CONNECT_REDIRECT_URI, code_verifier: verifier }));
  return { clientId, clientSecret, refreshToken: token.refreshToken, accessToken: token.accessToken, accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString() };
}

async function accessToken(vault: CredentialVault, fetcher: FetchLike): Promise<string> {
  const stored = await vault.get();
  if (!stored) throw new CanvaConnectError("not_configured", false, "Canva Connect is not configured. Run `ai-bookagent canva configure` in a terminal.");
  const credentials = parseStoredCredentials(stored);
  if (credentials.accessToken && credentials.accessTokenExpiresAt && Date.parse(credentials.accessTokenExpiresAt) > Date.now() + 30_000) return credentials.accessToken;
  const token = await tokenRequest(fetcher, credentials, new URLSearchParams({ grant_type: "refresh_token", refresh_token: credentials.refreshToken }));
  const refreshed = { ...credentials, refreshToken: token.refreshToken, accessToken: token.accessToken, accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString() };
  await vault.set(JSON.stringify(refreshed));
  return token.accessToken;
}

function currentProjectPptxIsAllowed(project: BookProject): void {
  const design = project.design;
  const docx = project.exports.find((record) => record.format === "docx" && record.sourceRevision === project.sourceRevision);
  if (!project.content || !design || design.status !== "approved" || design.sourceRevision !== project.sourceRevision || project.primaryOutput.status !== "accepted" || !docx || project.primaryOutput.sha256 !== docx.sha256 || project.primaryOutput.designRevision !== design.designRevision || project.primaryOutput.illustrationSetDigest !== design.illustrationSetDigest) {
    throw new CanvaConnectError("canonical_source_mismatch", false, "The current approved BookDesign and accepted DOCX are required before Canva import.");
  }
  if (project.canva.status !== "consented" || project.canva.sourceRevision !== project.sourceRevision || project.canva.designRevision !== design.designRevision || project.canva.illustrationSetDigest !== design.illustrationSetDigest) {
    throw new CanvaConnectError("consent_required", false, "A fresh explicit Canva consent for this approved design is required.");
  }
}

export async function consentToLocalCanvaImport(projectDir: string): Promise<BookProject> {
  const project = await loadProject(projectDir);
  const design = project.design;
  if (!project.content || !design || design.status !== "approved" || project.primaryOutput.status !== "accepted") throw new CanvaConnectError("canonical_source_mismatch", false, "Approve the current design and accept its DOCX before Canva consent.");
  return saveProject(projectDir, { ...project, revision: project.revision + 1, stage: "canva_consent_required", canva: { status: "consented", readiness: "ready", checkedAt: new Date().toISOString(), consentedAt: new Date().toISOString(), adapter: { connectorName: "Canva Connect API", toolName: "local_binary_import" }, sourceRevision: project.sourceRevision, designRevision: design.designRevision, illustrationSetDigest: design.illustrationSetDigest } });
}

function trustedEditUrl(value: unknown, designId: string): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com")) && decodeURIComponent(url.pathname) === `/design/${designId}/edit`; } catch { return false; }
}

export interface CanvaImportSuccess { outcome: "success"; designId: string; editUrl: string; sourceRevision: number; designRevision: number; illustrationSetDigest: string; pageCount: number; pptxSha256: string; }
export interface CanvaImportFailure { outcome: "failed"; code: CanvaConnectFailureCode; message: string; retryable: boolean; }

export async function importApprovedCanvaPptx(projectDir: string, vault: CredentialVault = new NativeCredentialVault(), fetcher: FetchLike = fetch, pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<CanvaImportSuccess | CanvaImportFailure> {
  let pptxPath: string | undefined;
  try {
    const project = await loadProject(projectDir);
    currentProjectPptxIsAllowed(project);
    const design = project.design!;
    const illustrations = await resolveApprovedIllustrations(projectDir, project.content!, project.illustrations);
    const outputDir = resolveInside(projectDir, path.join("canva", `import-${randomUUID()}`));
    await mkdir(outputDir, { recursive: true });
    const record = await exportPptx(project.content!, outputDir, illustrations, { ageBand: project.content!.effectiveAgeBand, language: project.request.language });
    pptxPath = path.join(outputDir, record.relativePath);
    const digest = await fileDigest(pptxPath);
    if (digest.sha256 !== record.sha256 || digest.bytes !== record.bytes || design.pages.length !== 1 + project.content!.creatures.length * 3 + (project.content!.closingNote ? 1 : 0)) throw new CanvaConnectError("canonical_source_mismatch", false, "The generated PPTX no longer matches the approved canonical page plan.");
    const token = await accessToken(vault, fetcher);
    const started = await fetcher(IMPORT_URL, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "import-metadata": JSON.stringify({ title_base64: Buffer.from(project.content!.title).toString("base64"), mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }) }, body: await (await import("node:fs/promises")).readFile(pptxPath) });
    const startPayload = await started.json().catch(() => ({})) as { job?: { id?: unknown } };
    const jobId = startPayload.job?.id;
    if (!started.ok || typeof jobId !== "string" || !jobId) throw new CanvaConnectError("import_rejected", true, "Canva did not accept the approved PPTX import.");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await pause(2000);
      const response = await fetcher(`${IMPORT_URL}/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${token}` } });
      const status = await response.json().catch(() => ({})) as { job?: { status?: unknown; result?: { designs?: Array<{ id?: unknown; urls?: { edit_url?: unknown } }> } } };
      if (!response.ok) throw new CanvaConnectError("import_rejected", true, "Canva import status could not be read.");
      if (status.job?.status === "failed") throw new CanvaConnectError("import_rejected", false, "Canva could not import the approved PPTX.");
      if (status.job?.status !== "success") continue;
      const imported = status.job.result?.designs?.[0];
      if (typeof imported?.id !== "string" || !trustedEditUrl(imported.urls?.edit_url, imported.id)) throw new CanvaConnectError("import_response_invalid", false, "Canva completed the import without a valid editable design URL.");
      const result: CanvaImportSuccess = { outcome: "success", designId: imported.id, editUrl: imported.urls.edit_url, sourceRevision: project.sourceRevision, designRevision: design.designRevision, illustrationSetDigest: design.illustrationSetDigest, pageCount: design.pages.length, pptxSha256: digest.sha256 };
      const state = recordCanvaResult(result, design);
      await saveProject(projectDir, { ...project, revision: project.revision + 1, stage: "canva_complete", canva: { ...project.canva, ...state, sourceRevision: project.sourceRevision, designRevision: design.designRevision, illustrationSetDigest: design.illustrationSetDigest } });
      return result;
    }
    throw new CanvaConnectError("import_timeout", true, "Canva import did not finish in the local wait window.");
  } catch (error) {
    if (error instanceof CanvaConnectError) return { outcome: "failed", code: error.code, message: error.message, retryable: error.retryable };
    return { outcome: "failed", code: "local_pptx_unavailable", message: "The approved local PPTX could not be generated or read.", retryable: true };
  } finally {
    // Source remains local; the temporary canonical PPTX is removed after the direct binary transfer.
    if (pptxPath) await rm(path.dirname(pptxPath), { recursive: true, force: true });
  }
}

export function secretReceivedAcknowledgement(length: number): string {
  const safeLength = Math.max(0, Math.floor(length));
  return `Secret received (${safeLength} characters).`;
}

async function promptTerminal(question: string, sensitive: boolean): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new CanvaConnectError("secure_storage_unavailable", false, "Canva setup requires an interactive terminal for credential input.");
  }
  process.stdout.write(question);
  return new Promise((resolve, reject) => {
    let answer = "";
    const wasRaw = process.stdin.isRaw;
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else {
        if (sensitive) process.stdout.write(`${secretReceivedAcknowledgement(answer.length)}\n`);
        resolve(answer.trim());
      }
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u0003") { finish(new CanvaConnectError("oauth_failed", false, "Canva setup was cancelled.")); return; }
        if (character === "\u0008" || character === "\u007f") {
          answer = answer.slice(0, -1);
          if (!sensitive) process.stdout.write("\b \b");
          continue;
        }
        answer += character;
        if (!sensitive) process.stdout.write(character);
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

/** Client IDs are public integration identifiers; show them so setup has normal terminal feedback. */
export async function promptVisible(question: string): Promise<string> {
  return promptTerminal(question, false);
}

/** Secrets never echo or redraw while typed; acknowledgement is printed only after Enter. */
export async function promptHidden(question: string): Promise<string> {
  return promptTerminal(question, true);
}

export async function configureCanvaConnect(vault: CredentialVault, clientId: string, clientSecret: string, fetcher: FetchLike = fetch): Promise<void> {
  if (!clientId || !clientSecret) throw new CanvaConnectError("oauth_failed", false, "A Canva client ID and client secret are required.");
  if (!await vault.available()) throw new CanvaConnectError("secure_storage_unavailable", false, "Secure OS credential storage is unavailable; Canva Connect was not configured.");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const authorize = canvaAuthorizationUrl(clientId, state, verifier);
  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const callback = new URL(request.url ?? "/", CANVA_CONNECT_REDIRECT_URI);
      if (callback.pathname !== "/oauth/callback" || callback.searchParams.get("state") !== state || !callback.searchParams.get("code")) { response.writeHead(400, { "content-type": "text/plain" }); response.end("Authorization was not completed."); return; }
      try {
        const credentials = await exchangeAuthorizationCode(fetcher, clientId, clientSecret, callback.searchParams.get("code")!, verifier);
        await vault.set(JSON.stringify(credentials));
        response.writeHead(200, { "content-type": "text/plain" }); response.end("Canva Connect configured. Return to the terminal.");
        server.close(); resolve();
      } catch { response.writeHead(500, { "content-type": "text/plain" }); response.end("Authorization failed. Return to the terminal."); server.close(); reject(new CanvaConnectError("oauth_failed", true, "Canva authorization could not be completed. Reauthorize or try again.")); }
    });
    server.once("error", () => reject(new CanvaConnectError("oauth_failed", true, "The local OAuth callback port is unavailable.")));
    server.listen(3001, "127.0.0.1", () => process.stdout.write(`Open this local authorization URL in your browser:\n${authorize}\n`));
  });
}
