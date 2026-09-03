import { describe, expect, it } from "vitest";
import { loadCanvaProofConfig } from "../src/canva-connect-proof.ts";

describe("Canva Connect proof configuration", () => {
  const credentials = { CANVA_CLIENT_ID: "client", CANVA_CLIENT_SECRET: "secret" };

  it("uses the exact local callback default", () => {
    expect(loadCanvaProofConfig(credentials)).toMatchObject({ redirectUri: "http://127.0.0.1:3001/oauth/callback", port: 3001 });
  });

  it("rejects a redirect URI Canva will not send to this harness", () => {
    expect(() => loadCanvaProofConfig({ ...credentials, CANVA_REDIRECT_URI: "http://localhost:3001/oauth/callback" })).toThrow(/CANVA_REDIRECT_URI/);
  });

  it("requires local credentials without exposing their values", () => {
    expect(() => loadCanvaProofConfig({ CANVA_CLIENT_ID: "client" })).toThrow(/CANVA_CLIENT_ID and CANVA_CLIENT_SECRET/);
  });
});
