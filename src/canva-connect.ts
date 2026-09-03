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
export const WINDOWS_CREDENTIAL_BLOB_BYTES = 5 * 512;
export const WINDOWS_VAULT_MAX_BYTES = 64 * 1024;
export const WINDOWS_VAULT_MAX_CHUNKS = 32;

export interface WindowsVaultManifest {
  version: 1;
  generation: string;
  chunkCount: number;
  totalBytes: number;
  sha256: string;
}

export function chunkWindowsVaultValue(value: string, generation = randomUUID().replace(/-/gu, "")): { manifest: WindowsVaultManifest; chunks: Buffer[] } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength === 0 || bytes.byteLength > WINDOWS_VAULT_MAX_BYTES) throw new Error("Windows Credential Manager value exceeds the supported secure-storage limit.");
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += WINDOWS_CREDENTIAL_BLOB_BYTES) chunks.push(bytes.subarray(offset, Math.min(offset + WINDOWS_CREDENTIAL_BLOB_BYTES, bytes.byteLength)));
  if (chunks.length > WINDOWS_VAULT_MAX_CHUNKS) throw new Error("Windows Credential Manager value requires too many secure-storage chunks.");
  return { manifest: { version: 1, generation, chunkCount: chunks.length, totalBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }, chunks };
}

export function reassembleWindowsVaultValue(manifest: WindowsVaultManifest, chunks: readonly Buffer[]): string {
  if (manifest.version !== 1 || !/^[a-f0-9]{32}$/u.test(manifest.generation) || !Number.isInteger(manifest.chunkCount) || manifest.chunkCount < 1 || manifest.chunkCount > WINDOWS_VAULT_MAX_CHUNKS || !Number.isInteger(manifest.totalBytes) || manifest.totalBytes < 1 || manifest.totalBytes > WINDOWS_VAULT_MAX_BYTES || !/^[a-f0-9]{64}$/u.test(manifest.sha256) || chunks.length !== manifest.chunkCount) throw new Error("Windows Credential Manager manifest is invalid.");
  if (chunks.some((chunk, index) => chunk.byteLength === 0 || chunk.byteLength > WINDOWS_CREDENTIAL_BLOB_BYTES || (index < chunks.length - 1 && chunk.byteLength !== WINDOWS_CREDENTIAL_BLOB_BYTES))) throw new Error("Windows Credential Manager chunks are incomplete.");
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== manifest.totalBytes || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) throw new Error("Windows Credential Manager chunk integrity check failed.");
  return bytes.toString("utf8");
}

export type CanvaConnectFailureCode =
  | "secure_storage_unavailable" | "not_configured" | "oauth_failed" | "authorization_expired"
  | "consent_required" | "canonical_source_mismatch" | "asset_integrity_mismatch"
  | "import_rejected" | "import_timeout" | "import_response_invalid" | "local_pptx_unavailable";

export class CanvaConnectError extends Error {
  constructor(readonly code: CanvaConnectFailureCode, readonly retryable: boolean, message: string, readonly diagnostic?: CanvaOAuthDiagnostic) {
    super(message);
    this.name = "CanvaConnectError";
  }
}

export interface CanvaOAuthDiagnostic {
  phase: "token_exchange";
  classification: "client_auth_rejected" | "request_or_grant_rejected" | "integration_access_denied" | "rate_limited" | "canva_service_error" | "transport_error" | "response_shape_invalid";
  httpStatus?: number;
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
type InteractiveCommandRunner = (command: string, args: string[]) => Promise<Pick<CommandResult, "exitCode" | "stderr">>;

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

function runInteractiveCommand(command: string, args: string[]): Promise<Pick<CommandResult, "exitCode" | "stderr">> {
  return new Promise((resolve, reject) => {
    // Inherit the normal VS Code PowerShell console: Read-Host owns the paste-aware
    // line editor. Only diagnostics are piped back, never a credential value.
    const child = spawn(command, args, { stdio: ["inherit", "inherit", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stderr }));
  });
}

/**
 * OS vault bridge. Linux secrets travel through a stdin pipe; Windows setup uses
 * PowerShell's secure inherited-console prompt. Neither path uses a CLI argument,
 * project file, environment variable, log, MCP argument, or visible command result.
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
    if (this.platform === "win32") chunkWindowsVaultValue(value);
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
    const script = this.platform === "win32" ? windowsChunkedCredentialManagerScript(operation) : this.platform === "darwin" ? macosVaultScript(operation) : undefined;
    if (!script) return { exitCode: 2, stdout: "", stderr: "unsupported platform" };
    const shell = this.platform === "win32" ? "powershell.exe" : "/usr/bin/osascript";
    const args = this.platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-Command", script]
      : ["-l", "JavaScript", "-e", script];
    return this.runner(shell, args, value === undefined ? undefined : JSON.stringify({ value }));
  }
}

/** Fixed helper source; values move only through stdin/stdout pipes. */
export function windowsChunkedCredentialManagerScript(operation: "probe" | "get" | "set" | "remove"): string {
  return `$ErrorActionPreference='Stop'; Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BookAgentChunkedCredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredEnumerate(string filter, UInt32 flags, out UInt32 count, out IntPtr credentials);
  [DllImport("Advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr credential);
}
'@;
$target='AI Book Agent MCP Lite Canva Connect/default'; $chunkBytes=2560; $maxBytes=65536; $maxChunks=32; $op='${operation}';
function Get-Record([string]$name) { $ptr=[IntPtr]::Zero; if(-not [BookAgentChunkedCredMan]::CredRead($name,1,0,[ref]$ptr)){if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168){$script:recordMissing=$true};return $null}; try{$c=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][BookAgentChunkedCredMan+CREDENTIAL]); $b=New-Object byte[] ([int]$c.CredentialBlobSize); if($b.Length){[Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$b.Length)}; [pscustomobject]@{UserName=$c.UserName;Bytes=$b}}finally{[BookAgentChunkedCredMan]::CredFree($ptr)} }
function Put-Record([string]$name,[byte[]]$value,[string]$marker) { if($value.Length -lt 1 -or $value.Length -gt $chunkBytes){throw 'invalid blob'}; $p=[Runtime.InteropServices.Marshal]::AllocCoTaskMem($value.Length); try{[Runtime.InteropServices.Marshal]::Copy($value,0,$p,$value.Length); $c=New-Object BookAgentChunkedCredMan+CREDENTIAL; $c.Type=1;$c.TargetName=$name;$c.CredentialBlobSize=[uint32]$value.Length;$c.CredentialBlob=$p;$c.Persist=2;$c.UserName=$marker;if(-not [BookAgentChunkedCredMan]::CredWrite([ref]$c,0)){throw 'write failed'}}finally{if($p -ne [IntPtr]::Zero){$z=New-Object byte[] $value.Length;[Runtime.InteropServices.Marshal]::Copy($z,0,$p,$value.Length);[Runtime.InteropServices.Marshal]::FreeCoTaskMem($p)}} }
function Clear-Generations([string]$keep) { $count=[uint32]0;$ptr=[IntPtr]::Zero;if(-not [BookAgentChunkedCredMan]::CredEnumerate($target+'/v1/*',0,[ref]$count,[ref]$ptr)){return};try{for($i=0;$i -lt $count;$i++){$item=[Runtime.InteropServices.Marshal]::ReadIntPtr($ptr,[IntPtr]::Size*$i);$c=[Runtime.InteropServices.Marshal]::PtrToStructure($item,[type][BookAgentChunkedCredMan+CREDENTIAL]);if(-not $keep -or $c.TargetName -notlike ($target+'/v1/'+$keep+'/*')){[void][BookAgentChunkedCredMan]::CredDelete($c.TargetName,1,0)}}}finally{[BookAgentChunkedCredMan]::CredFree($ptr)} }
if($op -eq 'probe'){ $p=[IntPtr]::Zero;[void][BookAgentChunkedCredMan]::CredRead($target,1,0,[ref]$p);if($p -ne [IntPtr]::Zero){[BookAgentChunkedCredMan]::CredFree($p)};exit 0 }
if($op -eq 'set'){ $raw=[Console]::In.ReadToEnd();$payload=$raw|ConvertFrom-Json;$bytes=[Text.Encoding]::UTF8.GetBytes([string]$payload.value);try{if($bytes.Length -lt 1 -or $bytes.Length -gt $maxBytes){exit 2};$count=[int][Math]::Ceiling($bytes.Length/[double]$chunkBytes);if($count -lt 1 -or $count -gt $maxChunks){exit 2};$generation=[Guid]::NewGuid().ToString('N');for($i=0;$i -lt $count;$i++){$offset=$i*$chunkBytes;$size=[Math]::Min($chunkBytes,$bytes.Length-$offset);$piece=New-Object byte[] $size;try{[Array]::Copy($bytes,$offset,$piece,0,$size);Put-Record ($target+'/v1/'+$generation+'/chunk/'+$i) $piece ('__bookagent_canva_chunk_v1__:'+$generation+':'+$i)}finally{[Array]::Clear($piece,0,$piece.Length)}};$sha=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};$manifest=[pscustomobject]@{version=1;generation=$generation;chunkCount=$count;totalBytes=$bytes.Length;sha256=$digest}|ConvertTo-Json -Compress;$manifestBytes=[Text.Encoding]::UTF8.GetBytes($manifest);try{Put-Record $target $manifestBytes '__bookagent_canva_manifest_v1__'}finally{[Array]::Clear($manifestBytes,0,$manifestBytes.Length)};Clear-Generations $generation}finally{[Array]::Clear($bytes,0,$bytes.Length)};exit 0 }
if($op -eq 'get'){ $record=Get-Record $target;if($null -eq $record){if($script:recordMissing){exit 44};exit 2};try{$bootstrap='__bookagent_canva_bootstrap__:';if($record.UserName -and $record.UserName.StartsWith($bootstrap)){$out=[pscustomobject]@{clientId=$record.UserName.Substring($bootstrap.Length);clientSecret=[Text.Encoding]::Unicode.GetString($record.Bytes)}|ConvertTo-Json -Compress;[Console]::Out.Write($out);exit 0};if($record.UserName -ne '__bookagent_canva_manifest_v1__'){[Console]::Out.Write([Text.Encoding]::UTF8.GetString($record.Bytes));exit 0};$m=[Text.Encoding]::UTF8.GetString($record.Bytes)|ConvertFrom-Json;if($m.version -ne 1 -or $m.generation -notmatch '^[a-f0-9]{32}$' -or $m.chunkCount -lt 1 -or $m.chunkCount -gt $maxChunks -or $m.totalBytes -lt 1 -or $m.totalBytes -gt $maxBytes -or $m.sha256 -notmatch '^[a-f0-9]{64}$'){exit 2};$all=New-Object System.Collections.Generic.List[byte];for($i=0;$i -lt [int]$m.chunkCount;$i++){$part=Get-Record ($target+'/v1/'+$m.generation+'/chunk/'+$i);if($null -eq $part -or $part.UserName -ne ('__bookagent_canva_chunk_v1__:'+$m.generation+':'+$i) -or $part.Bytes.Length -lt 1 -or $part.Bytes.Length -gt $chunkBytes -or ($i -lt [int]$m.chunkCount-1 -and $part.Bytes.Length -ne $chunkBytes)){exit 2};$all.AddRange([byte[]]$part.Bytes);[Array]::Clear($part.Bytes,0,$part.Bytes.Length)};$joined=$all.ToArray();try{if($joined.Length -ne [int]$m.totalBytes){exit 2};$sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash($joined))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()};if($actual -ne $m.sha256){exit 2};[Console]::Out.Write([Text.Encoding]::UTF8.GetString($joined))}finally{[Array]::Clear($joined,0,$joined.Length)}}finally{[Array]::Clear($record.Bytes,0,$record.Bytes.Length)};exit 0 }
if(-not [BookAgentChunkedCredMan]::CredDelete($target,1,0)){Clear-Generations '';if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168){exit 44};exit 2};Clear-Generations '';`;
}

/** Compatibility export for callers that used the original helper. */
export function windowsCredentialManagerScript(operation: "probe" | "get" | "set" | "remove"): string {
  return windowsChunkedCredentialManagerScript(operation);
}

/**
 * A fixed Windows-only prompt. `Read-Host -AsSecureString` uses the normal
 * PowerShell line editor, without Node raw-mode interception. It writes only
 * UTF-16 secret bytes to CredMan. Windows CLI setup uses the browser flow below.
 */
export function windowsCredentialManagerBootstrapScript(): string {
  return `$ErrorActionPreference='Stop'; Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BookAgentBootstrapCredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("OleAut32.dll")] public static extern UInt32 SysStringByteLen(IntPtr bstr);
}
'@;
$target='AI Book Agent MCP Lite Canva Connect/default';
$clientId=(Read-Host -Prompt 'Canva client ID (visible; Enter to continue)').Trim();
if([string]::IsNullOrWhiteSpace($clientId)){exit 2};
$secret=Read-Host -Prompt 'Canva client secret (masked; Enter to continue; Ctrl+C cancels)' -AsSecureString;
$bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret); $length=[int][BookAgentBootstrapCredMan]::SysStringByteLen($bstr); if($length -eq 0){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $secret.Dispose(); exit 2};
$source=New-Object byte[] $length; $blob=[IntPtr]::Zero;
try { [Runtime.InteropServices.Marshal]::Copy($bstr,$source,0,$length); $blob=[Runtime.InteropServices.Marshal]::AllocCoTaskMem($length); [Runtime.InteropServices.Marshal]::Copy($source,0,$blob,$length); $credential=New-Object BookAgentBootstrapCredMan+CREDENTIAL; $credential.Type=1; $credential.TargetName=$target; $credential.CredentialBlobSize=[uint32]$length; $credential.CredentialBlob=$blob; $credential.Persist=2; $credential.UserName='__bookagent_canva_bootstrap__:'+$clientId; if(-not [BookAgentBootstrapCredMan]::CredWrite([ref]$credential,0)){exit 2} } finally { [Array]::Clear($source,0,$source.Length); if($blob -ne [IntPtr]::Zero){$zero=New-Object byte[] $length; [Runtime.InteropServices.Marshal]::Copy($zero,0,$blob,$length); [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob)}; [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $secret.Dispose() }`;
}

export async function promptWindowsCredentialManagerBootstrap(runner: InteractiveCommandRunner = runInteractiveCommand): Promise<void> {
  const result = await runner("powershell.exe", ["-NoProfile", "-Command", windowsCredentialManagerBootstrapScript()]);
  if (result.exitCode !== 0) throw new CanvaConnectError("secure_storage_unavailable", false, "Canva credentials were not stored in Windows Credential Manager.");
}

export interface WindowsCanvaBrowserSetupOptions {
  timeoutMs?: number;
  announce?: (url: string) => void;
}

/**
 * Collects integration credentials through a normal local browser password field.
 * The listener is loopback-only, short-lived, and never logs or returns the secret.
 */
export async function collectWindowsCanvaCredentialsInBrowser(vault: CredentialVault, options: WindowsCanvaBrowserSetupOptions = {}): Promise<void> {
  if (!await vault.available()) throw new CanvaConnectError("secure_storage_unavailable", false, "Windows Credential Manager is unavailable; Canva Connect was not configured.");
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new CanvaConnectError("oauth_failed", false, "The local Canva setup timeout is invalid.");
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      server.close(() => error ? reject(error) : resolve());
    };
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && requestUrl.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'" });
        response.end("<!doctype html><title>Canva Connect setup</title><form method=post action=/configure><label>Canva client ID <input name=clientId autocomplete=off required></label><label>Canva client secret <input type=password name=clientSecret autocomplete=off required></label><button>Store securely and continue</button></form>");
        return;
      }
      if (request.method !== "POST" || requestUrl.pathname !== "/configure" || !String(request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end("Not found."); return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; if (Buffer.byteLength(body, "utf8") > 16 * 1024) request.destroy(); });
      request.once("error", () => { if (!finished) finish(new CanvaConnectError("oauth_failed", false, "The local Canva setup request could not be read.")); });
      request.once("end", async () => {
        try {
          const fields = new URLSearchParams(body);
          const clientId = (fields.get("clientId") ?? "").trim();
          const clientSecret = fields.get("clientSecret") ?? "";
          if (!clientId || !clientSecret || clientId.length > 512 || clientSecret.length > 8_192) {
            response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end("Both fields are required."); return;
          }
          await vault.set(JSON.stringify({ clientId, clientSecret }));
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'" }); response.end("<!doctype html><title>Canva Connect setup</title>Credentials stored securely. Return to the terminal to continue authorization.<script>window.close()</script>");
          finish();
        } catch {
          response.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end("Credentials could not be stored securely. Return to the terminal.");
          finish(new CanvaConnectError("secure_storage_unavailable", false, "Canva credentials could not be stored in Windows Credential Manager."));
        }
      });
    });
    const timeout = setTimeout(() => finish(new CanvaConnectError("oauth_failed", false, "Local Canva setup timed out; no credentials were stored.")), timeoutMs);
    server.once("error", () => finish(new CanvaConnectError("oauth_failed", true, "The local Canva setup listener could not start.")));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { finish(new CanvaConnectError("oauth_failed", true, "The local Canva setup listener did not provide a loopback URL.")); return; }
      (options.announce ?? ((url) => process.stdout.write(`Open this local Canva setup URL in your browser:\n${url}\n`)))(`http://127.0.0.1:${address.port}/`);
    });
  });
}

export async function configureWindowsCanvaConnect(vault: CredentialVault, fetcher: FetchLike = fetch, reportDiagnostic?: (diagnostic: CanvaOAuthDiagnostic) => void, options?: WindowsCanvaBrowserSetupOptions): Promise<void> {
  await collectWindowsCanvaCredentialsInBrowser(vault, options);
  const bootstrap = await vault.get();
  if (!bootstrap) throw new CanvaConnectError("secure_storage_unavailable", false, "Canva credentials are not available in Windows Credential Manager.");
  const { clientId, clientSecret } = parseBootstrapCredentials(bootstrap);
  await configureCanvaConnect(vault, clientId, clientSecret, fetcher, reportDiagnostic);
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

export function parseBootstrapCredentials(value: string): Pick<CanvaCredentials, "clientId" | "clientSecret"> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.clientId !== "string" || typeof parsed.clientSecret !== "string" || !parsed.clientId || !parsed.clientSecret) throw new Error();
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  } catch { throw new CanvaConnectError("not_configured", false, "Canva client credentials are not available in Windows Credential Manager."); }
}

export async function canvaConnectStatus(vault: CredentialVault): Promise<{ configured: boolean; secureStorage: boolean }> {
  const secureStorage = await vault.available();
  if (!secureStorage) return { configured: false, secureStorage: false };
  const stored = await vault.get();
  if (!stored) return { configured: false, secureStorage: true };
  try { parseStoredCredentials(stored); return { configured: true, secureStorage: true }; }
  catch { return { configured: false, secureStorage: true }; }
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

export function classifyCanvaTokenFailure(status: number): CanvaOAuthDiagnostic {
  if (status === 401) return { phase: "token_exchange", classification: "client_auth_rejected", httpStatus: status };
  if (status === 400) return { phase: "token_exchange", classification: "request_or_grant_rejected", httpStatus: status };
  if (status === 403) return { phase: "token_exchange", classification: "integration_access_denied", httpStatus: status };
  if (status === 429) return { phase: "token_exchange", classification: "rate_limited", httpStatus: status };
  return { phase: "token_exchange", classification: "canva_service_error", httpStatus: status };
}

function tokenDiagnosticMessage(diagnostic: CanvaOAuthDiagnostic): string {
  if (diagnostic.classification === "client_auth_rejected") return "Canva rejected the integration's client authentication (HTTP 401). Check the client ID and secret in the Canva Developer Portal without sharing them in chat.";
  if (diagnostic.classification === "request_or_grant_rejected") return "Canva rejected the token request or authorization grant (HTTP 400). Check the configured redirect URI and integration settings; authorization codes are single-use.";
  if (diagnostic.classification === "integration_access_denied") return "Canva denied this integration's token request (HTTP 403). Check the integration's status, scopes, and account access in the Canva Developer Portal.";
  if (diagnostic.classification === "rate_limited") return "Canva rate-limited the token request (HTTP 429). Wait before making another authorization attempt.";
  if (diagnostic.classification === "transport_error") return "The local tool could not reach Canva's token endpoint. Check network connectivity and retry later.";
  if (diagnostic.classification === "response_shape_invalid") return "Canva returned a successful token response without the expected token fields. Do not expose or paste the response; contact Canva support with the request time.";
  return `Canva's token endpoint failed (HTTP ${diagnostic.httpStatus ?? "unknown"}). Retry later or check Canva service status.`;
}

async function tokenRequest(fetcher: FetchLike, credentials: Pick<CanvaCredentials, "clientId" | "clientSecret">, form: URLSearchParams): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  let response: Response;
  try {
    response = await fetcher(TOKEN_URL, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  } catch {
    const diagnostic: CanvaOAuthDiagnostic = { phase: "token_exchange", classification: "transport_error" };
    throw new CanvaConnectError("oauth_failed", true, tokenDiagnosticMessage(diagnostic), diagnostic);
  }
  // Never parse an error response: its payload can contain provider diagnostics that
  // are not safe to place in terminal output, MCP data, or a project manifest.
  if (!response.ok) {
    const diagnostic = classifyCanvaTokenFailure(response.status);
    throw new CanvaConnectError("oauth_failed", response.status === 429 || response.status >= 500, tokenDiagnosticMessage(diagnostic), diagnostic);
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
    const diagnostic: CanvaOAuthDiagnostic = { phase: "token_exchange", classification: "response_shape_invalid", httpStatus: response.status };
    throw new CanvaConnectError("oauth_failed", false, tokenDiagnosticMessage(diagnostic), diagnostic);
  }
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

export function trustedEditUrl(value: unknown, designId: string): value is string {
  if (typeof value !== "string" || typeof designId !== "string" || !designId) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || (host !== "www.canva.com" && host !== "canva.com")) return false;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "design" && segments.length === 3 && segments[2] === "edit") return decodeURIComponent(segments[1]!) === designId;
    return segments[0] === "api" && segments[1] === "design" && segments.length === 4 && Boolean(segments[2]) && segments[3] === "edit";
  } catch { return false; }
}

function pendingImportMatches(project: BookProject, design: NonNullable<BookProject["design"]>, digest: { sha256: string }, pageCount: number): boolean {
  const pending = project.canva.pendingImport;
  return Boolean(pending && pending.sourceRevision === project.sourceRevision && pending.designRevision === design.designRevision &&
    pending.illustrationSetDigest === design.illustrationSetDigest && pending.pageCount === pageCount && pending.pptxSha256 === digest.sha256);
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
    const pageCount = design.pages.length;
    if (digest.sha256 !== record.sha256 || digest.bytes !== record.bytes || pageCount !== 1 + project.content!.creatures.length * 3 + (project.content!.closingNote ? 1 : 0)) throw new CanvaConnectError("canonical_source_mismatch", false, "The generated PPTX no longer matches the approved canonical page plan.");

    let jobId: string;
    if (project.canva.pendingImport) {
      if (!pendingImportMatches(project, design, digest, pageCount)) throw new CanvaConnectError("canonical_source_mismatch", false, "The pending Canva import is bound to a different approved project state and cannot be resumed.");
      jobId = project.canva.pendingImport.jobId;
    } else {
      const token = await accessToken(vault, fetcher);
      const started = await fetcher(IMPORT_URL, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "import-metadata": JSON.stringify({ title_base64: Buffer.from(project.content!.title).toString("base64"), mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }) }, body: await (await import("node:fs/promises")).readFile(pptxPath) });
      const startPayload = await started.json().catch(() => ({})) as { job?: { id?: unknown } };
      if (!started.ok || typeof startPayload.job?.id !== "string" || !startPayload.job.id) throw new CanvaConnectError("import_rejected", true, "Canva did not accept the approved PPTX import.");
      jobId = startPayload.job.id;
      await saveProject(projectDir, { ...project, revision: project.revision + 1, canva: { ...project.canva, pendingImport: { jobId, sourceRevision: project.sourceRevision, designRevision: design.designRevision, illustrationSetDigest: design.illustrationSetDigest, pageCount, pptxSha256: digest.sha256, startedAt: new Date().toISOString() } } });
    }

    const token = await accessToken(vault, fetcher);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await pause(2000);
      const response = await fetcher(`${IMPORT_URL}/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${token}` } });
      const status = await response.json().catch(() => ({})) as { job?: { status?: unknown; result?: { designs?: Array<{ id?: unknown; urls?: { edit_url?: unknown } }> } } };
      if (!response.ok) throw new CanvaConnectError("import_rejected", true, "Canva import status could not be read.");
      if (status.job?.status === "failed") {
        await saveProject(projectDir, { ...project, revision: project.revision + 2, canva: { ...project.canva, pendingImport: undefined } });
        throw new CanvaConnectError("import_rejected", false, "Canva could not import the approved PPTX.");
      }
      if (status.job?.status !== "success") continue;
      const imported = status.job.result?.designs?.[0];
      if (typeof imported?.id !== "string" || !trustedEditUrl(imported.urls?.edit_url, imported.id)) throw new CanvaConnectError("import_response_invalid", false, "Canva completed the import without a valid editable design URL.");
      const result: CanvaImportSuccess = { outcome: "success", designId: imported.id, editUrl: imported.urls.edit_url, sourceRevision: project.sourceRevision, designRevision: design.designRevision, illustrationSetDigest: design.illustrationSetDigest, pageCount, pptxSha256: digest.sha256 };
      const state = recordCanvaResult(result, design);
      await saveProject(projectDir, { ...project, revision: project.revision + 2, stage: "canva_complete", canva: { ...project.canva, ...state, pendingImport: undefined, sourceRevision: project.sourceRevision, designRevision: design.designRevision, illustrationSetDigest: design.illustrationSetDigest } });
      return result;
    }
    throw new CanvaConnectError("import_timeout", true, "Canva import did not finish in the local wait window.");
  } catch (error) {
    if (error instanceof CanvaConnectError) return { outcome: "failed", code: error.code, message: error.message, retryable: error.retryable };
    return { outcome: "failed", code: "local_pptx_unavailable", message: "The approved local PPTX could not be generated or read.", retryable: true };
  } finally {
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

export async function configureCanvaConnect(vault: CredentialVault, clientId: string, clientSecret: string, fetcher: FetchLike = fetch, reportDiagnostic?: (diagnostic: CanvaOAuthDiagnostic) => void): Promise<void> {
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
      } catch (error) {
        const failure = error instanceof CanvaConnectError ? error : new CanvaConnectError("oauth_failed", true, "Canva authorization could not be completed. Return to the terminal for a safe diagnostic.");
        if (failure.diagnostic) reportDiagnostic?.(failure.diagnostic);
        response.writeHead(500, { "content-type": "text/plain" }); response.end("Authorization failed. Return to the terminal for a safe diagnostic."); server.close(); reject(failure);
      }
    });
    server.once("error", () => reject(new CanvaConnectError("oauth_failed", true, "The local OAuth callback port is unavailable.")));
    server.listen(3001, "127.0.0.1", () => process.stdout.write(`Open this local authorization URL in your browser:\n${authorize}\n`));
  });
}
