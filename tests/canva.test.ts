import { describe, expect, it, vi } from "vitest";
import {
  checkCanvaReadiness,
  prepareCanvaHandoff,
  recordCanvaConsent,
  recordCanvaResult
} from "../src/canva.ts";
import type { BookContent, BookRequest } from "../src/domain.ts";
import type { CanvaState } from "../src/project.ts";

const request = {
  title: "Ocean Friends",
  theme: "ocean creatures",
  ageBand: "6-8",
  language: "en",
  creatureCount: 1,
  brief: "",
  outputFormats: ["docx"]
} satisfies BookRequest;

const section = (text: string) => ({ text, language: "en" as const, reviewStatus: "human_reviewed" as const });
const content = {
  schemaVersion: "1.0",
  title: "Ocean Friends",
  language: "en",
  effectiveAgeBand: "6-8",
  creatures: [{
    creatureId: "octopus",
    displayName: "Octopus",
    poem: { ...section("Wave to the sea."), title: "Sea Wave", stanzaCount: 2, linesPerStanza: 3, rhymeScheme: "AAB" },
    funFact: section("An octopus has three hearts."),
    activity: section("Draw eight arms."),
    illustrationBrief: "A friendly octopus underwater.",
    altText: "A smiling octopus with eight arms."
  }]
} satisfies BookContent;

const consented: CanvaState = {
  status: "consented",
  consentedAt: "2026-08-03T10:00:00.000Z",
  sourceRevision: 4,
  selection: {
    designId: "template-1",
    title: "Playful Ocean",
    selectedAt: "2026-08-03T09:59:00.000Z",
    sourceRevision: 4
  }
};

describe("Canva readiness and handoff contract", () => {
  it("distinguishes unavailable, authorization-required, and ready states", () => {
    expect(checkCanvaReadiness({ status: "unavailable" })).toMatchObject({ status: "setup_required", readiness: "unavailable" });
    expect(checkCanvaReadiness({ status: "authorization_required" })).toMatchObject({
      status: "setup_required",
      readiness: "authorization_required"
    });
    expect(checkCanvaReadiness({ status: "ready", connectorName: "Canva" })).toMatchObject({
      status: "design_selection_required",
      readiness: "ready",
      adapter: { connectorName: "Canva" }
    });
  });

  it("persists an explicit decline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T10:00:00.000Z"));
    expect(recordCanvaConsent(false)).toEqual({ status: "declined", declinedAt: "2026-08-03T10:00:00.000Z" });
    vi.useRealTimers();
  });

  it("returns an adapter-neutral, correlated payload and supports retry", () => {
    const payload = prepareCanvaHandoff("project-1", 9, request, content, consented);
    expect(payload).toMatchObject({
      handoffVersion: "1.0",
      operation: "create_editable_design",
      correlation: { projectId: "project-1", revision: 9 },
      selectedDesign: { designId: "template-1" }
    });
    const retryState: CanvaState = {
      ...consented,
      status: "failed",
      failure: { code: "timeout", message: "Timed out", retryable: true, failedAt: "2026-08-03T10:01:00.000Z" }
    };
    expect(() => prepareCanvaHandoff("project-1", 10, request, content, retryState)).not.toThrow();
  });

  it("rejects handoff without consent", () => {
    expect(() => prepareCanvaHandoff("project-1", 9, request, content, { ...consented, status: "declined" })).toThrow(/consent/i);
  });
});

describe("Canva connector result validation", () => {
  it("accepts a matching HTTPS Canva edit URL", () => {
    expect(recordCanvaResult({
      outcome: "success",
      designId: "DAGabc_123",
      editUrl: "https://www.canva.com/design/DAGabc_123/edit?utm_source=share"
    })).toEqual({
      status: "complete",
      designId: "DAGabc_123",
      editUrl: "https://www.canva.com/design/DAGabc_123/edit?utm_source=share"
    });
  });

  it.each([
    "http://www.canva.com/design/DAGabc/edit",
    "https://canva.example/design/DAGabc/edit",
    "https://user:secret@www.canva.com/design/DAGabc/edit",
    "https://www.canva.com/templates/DAGabc",
    "https://www.canva.com/design/other/edit"
  ])("rejects a non-genuine or mismatched URL: %s", (editUrl) => {
    expect(() => recordCanvaResult({ outcome: "success", designId: "DAGabc", editUrl })).toThrow();
  });

  it("records structured connector failure", () => {
    expect(recordCanvaResult({ outcome: "failed", code: "timeout", message: "Connector timed out", retryable: true })).toMatchObject({
      status: "failed",
      failure: { code: "timeout", retryable: true }
    });
  });
});
