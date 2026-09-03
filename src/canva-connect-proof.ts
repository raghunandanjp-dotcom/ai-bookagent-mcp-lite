import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs") as typeof import("pptxgenjs").default;

const IMPORT_SCOPE = "design:content:write design:meta:read";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:3001/oauth/callback";
const DEFAULT_PORT = 3001;
const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const CANVA_IMPORT_URL = "https://api.canva.com/rest/v1/imports";

export interface CanvaProofConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  port: number;
}

export function loadCanvaProofConfig(environment: NodeJS.ProcessEnv = process.env): CanvaProofConfig {
  const clientId = environment.CANVA_CLIENT_ID?.trim();
  const clientSecret = environment.CANVA_CLIENT_SECRET?.trim();
  const redirectUri = environment.CANVA_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
  const port = Number(environment.CANVA_HARNESS_PORT ?? DEFAULT_PORT);
  if (!clientId || !clientSecret) throw new Error("Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in your local environment before starting the proof harness.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("CANVA_HARNESS_PORT must be a valid TCP port.");
  const url = new URL(redirectUri);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== String(port) || url.pathname !== "/oauth/callback" || url.search || url.hash) {
    throw new Error(`CANVA_REDIRECT_URI must be exactly http://127.0.0.1:${port}/oauth/callback for this local proof harness.`);
  }
  return { clientId, clientSecret, redirectUri, port };
}

function proofHtml(message: string, editUrl?: string, authorizeUrl?: string): string {
  const link = editUrl ? `<p><a href="${escapeHtml(editUrl)}">Open the editable Canva proof design</a></p>` : "";
  const authorize = authorizeUrl ? `<p><a href="${escapeHtml(authorizeUrl)}">Authorize Canva and run the synthetic PPTX proof</a></p>` : "";
  return `<!doctype html><meta charset="utf-8"><title>Canva PPTX proof</title><main><h1>Canva PPTX proof</h1><p>${escapeHtml(message)}</p>${authorize}${link}</main>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

function respond(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

function authorizationUrl(config: CanvaProofConfig, state: string, verifier: string): string {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(CANVA_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", IMPORT_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function createSyntheticPptx(): Promise<{ filePath: string; bytes: Buffer }> {
  const filePath = path.join(os.tmpdir(), `canva-pptx-proof-${randomUUID()}.pptx`);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AI Book Agent MCP Lite feasibility harness";
  pptx.title = "Canva PPTX Editability Proof";
  pptx.theme = { headFontFace: "Aptos", bodyFontFace: "Aptos" };
  const imageSvg = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"180\"><rect width=\"320\" height=\"180\" rx=\"24\" fill=\"#147D92\"/><circle cx=\"160\" cy=\"90\" r=\"50\" fill=\"#F4A261\"/></svg>").toString("base64");

  const first = pptx.addSlide();
  first.background = { color: "FFF9ED" };
  first.addText("Editable Canva Proof", { x: 0.8, y: 0.6, w: 7.6, h: 0.7, fontSize: 34, bold: true, color: "17324D", margin: 0 });
  first.addText("This text should remain selectable and editable after import.", { x: 0.85, y: 1.65, w: 6.9, h: 0.75, fontSize: 21, color: "263238", margin: 0.04 });
  first.addShape(pptx.ShapeType.roundRect, { x: 0.85, y: 3.05, w: 4.3, h: 1.15, rectRadius: 0.12, fill: { color: "F4A261" }, line: { color: "E76F51" } });
  first.addText("Editable shape and label", { x: 1.1, y: 3.42, w: 3.8, h: 0.35, fontSize: 19, bold: true, align: "center", color: "17324D", margin: 0 });
  first.addImage({ data: `data:image/svg+xml;base64,${imageSvg}`, x: 8.3, y: 1.55, w: 3.3, h: 1.86 });

  const second = pptx.addSlide();
  second.background = { color: "FFFFFF" };
  second.addText("Second editable page", { x: 0.8, y: 0.6, w: 8, h: 0.7, fontSize: 34, bold: true, color: "17324D", margin: 0 });
  second.addText("Pass criteria: separate pages, editable text, movable image, and editable shape.", { x: 0.85, y: 1.65, w: 10.8, h: 0.7, fontSize: 21, color: "263238", margin: 0.04 });
  second.addImage({ data: `data:image/svg+xml;base64,${imageSvg}`, x: 4.9, y: 3.1, w: 3.3, h: 1.86 });
  await pptx.writeFile({ fileName: filePath });
  return { filePath, bytes: await readFile(filePath) };
}

async function requestJson(url: string, options: RequestInit): Promise<unknown> {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) throw new Error(`Canva request failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

async function exchangeCode(config: CanvaProofConfig, code: string, verifier: string): Promise<string> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const payload = await requestJson(CANVA_TOKEN_URL, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: verifier }).toString()
  }) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) throw new Error("Canva returned no access token.");
  return payload.access_token;
}

async function importProof(accessToken: string): Promise<{ designId: string; editUrl: string }> {
  const proof = await createSyntheticPptx();
  try {
    const title = "Canva PPTX Editability Proof";
    const started = await requestJson(CANVA_IMPORT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/octet-stream",
        "import-metadata": JSON.stringify({ title_base64: Buffer.from(title).toString("base64"), mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })
      },
      body: Uint8Array.from(proof.bytes)
    }) as { job?: { id?: unknown } };
    const jobId = started.job?.id;
    if (typeof jobId !== "string" || !jobId) throw new Error("Canva did not return an import job ID.");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const status = await requestJson(`${CANVA_IMPORT_URL}/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${accessToken}` } }) as {
        job?: { status?: unknown; error?: { message?: unknown }; result?: { designs?: Array<{ id?: unknown; urls?: { edit_url?: unknown } }> } };
      };
      if (status.job?.status === "failed") throw new Error(`Canva import failed: ${typeof status.job.error?.message === "string" ? status.job.error.message : "unknown error"}`);
      if (status.job?.status !== "success") continue;
      const design = status.job.result?.designs?.[0];
      if (typeof design?.id !== "string" || typeof design.urls?.edit_url !== "string") throw new Error("Canva import succeeded without a design ID and editable URL.");
      return { designId: design.id, editUrl: design.urls.edit_url };
    }
    throw new Error("Canva import did not complete within 40 seconds.");
  } finally {
    await rm(proof.filePath, { force: true });
  }
}

export async function startCanvaConnectProof(config = loadCanvaProofConfig()): Promise<void> {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const authorize = authorizationUrl(config, state, verifier);
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${config.port}`);
    if (requestUrl.pathname === "/") return respond(response, 200, proofHtml("Ready. This proof imports only a synthetic PPTX.", undefined, authorize));
    if (requestUrl.pathname !== "/oauth/callback") return respond(response, 404, proofHtml("Not found."));
    if (requestUrl.searchParams.get("error")) return respond(response, 400, proofHtml(`Canva authorization failed: ${requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error")}`));
    if (requestUrl.searchParams.get("state") !== state || !requestUrl.searchParams.get("code")) return respond(response, 400, proofHtml("Invalid or incomplete OAuth callback."));
    try {
      const token = await exchangeCode(config, requestUrl.searchParams.get("code")!, verifier);
      const imported = await importProof(token);
      console.log(`Canva proof imported: designId=${imported.designId}`);
      return respond(response, 200, proofHtml("Proof import completed. Verify editable text, image, shape, and two separate pages in Canva.", imported.editUrl));
    } catch (error) {
      console.error(`Canva proof failed: ${error instanceof Error ? error.message : String(error)}`);
      return respond(response, 500, proofHtml("The proof import failed. See the terminal for non-secret diagnostic details."));
    }
  });
  await new Promise<void>((resolve) => server.listen(config.port, "127.0.0.1", resolve));
  console.log(`Canva proof harness listening at http://127.0.0.1:${config.port}/`);
  console.log("It generates and imports only a synthetic two-slide PPTX; no book files are read.");
}

const launchedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (launchedDirectly) startCanvaConnectProof().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
