import { describe, expect, it } from "vitest";
import type { BookContent, Creature } from "../src/domain.ts";
import { createProject, type BookProject } from "../src/project.ts";
import { deliverySummary } from "../src/workflow.ts";

const approved: Creature[] = [{
  id: "octopus",
  name: "Octopus",
  aliases: [],
  status: "living",
  groups: ["mollusc"],
  habitats: ["ocean"],
  pinned: false
}];

function content(
  language: "en" | "kn",
  funFactReviewStatus: "needs_review" | "human_reviewed" | "source_supported"
): BookContent {
  const text = language === "kn" ? "ಆಕ್ಟೋಪಸ್ ಸಮುದ್ರದಲ್ಲಿ ಈಜುತ್ತದೆ." : "An octopus swims in the sea.";
  return {
    schemaVersion: "1.1",
    title: language === "kn" ? "ಸಾಗರ ಸ್ನೇಹಿತರು" : "Ocean Friends",
    language,
    selectedAgeBand: "6-8",
    effectiveAgeBand: "6-8",
    generationAttempt: 0,
    creatures: [{
      creatureId: "octopus",
      displayName: language === "kn" ? "ಆಕ್ಟೋಪಸ್" : "Octopus",
      poem: { text: `${text}\n${text}\n${text}\n\n${text}\n${text}\n${text}`, language, reviewStatus: "human_reviewed", title: language === "kn" ? "ಸಮುದ್ರ ಗೀತೆ" : "Ocean Song", structureVersion: "1.0", rhymeScheme: "AAB" },
      funFact: { text, language, reviewStatus: funFactReviewStatus },
      activity: { text, language, reviewStatus: "human_reviewed" },
      illustrationBrief: "A friendly octopus underwater.",
      altText: "A smiling octopus with eight visible arms."
    }]
  };
}

function projectWithContent(
  language: "en" | "kn",
  funFactReviewStatus: "needs_review" | "human_reviewed" | "source_supported"
): BookProject {
  const project = createProject({
    title: "Ocean Friends",
    theme: "ocean creatures",
    language
  });
  return {
    ...project,
    selection: {
      ...project.selection,
      approved: true,
      current: approved
    },
    content: content(language, funFactReviewStatus)
  };
}

describe("delivery summary review status", () => {
  it("reports factual review independently from English language review", () => {
    const summary = deliverySummary(projectWithContent("en", "needs_review"));

    expect(summary.languageReviewRequired).toBe(false);
    expect(summary.review.language.status).toBe("not_required");
    expect(summary.review.content.status).toBe("required");
    expect(summary.review.content.outstandingCount).toBe(1);
    expect(summary.review.content.issues).toEqual([{
      code: "fact_review_required",
      path: "creatures.0.funFact",
      message: "Octopus's fun fact requires review."
    }]);
  });

  it("reports content review complete when facts are source-supported", () => {
    const summary = deliverySummary(projectWithContent("en", "source_supported"));

    expect(summary.review.language.status).toBe("not_required");
    expect(summary.review.content.status).toBe("complete");
    expect(summary.review.content.outstandingCount).toBe(0);
    expect(summary.review.content.issues).toEqual([]);
    expect(summary.review.illustrations).toEqual({ required: 2, imported: 0, approved: 0, status: "required" });
  });

  it("reports Kannada language review separately from factual review", () => {
    const summary = deliverySummary(projectWithContent("kn", "needs_review"));

    expect(summary.languageReviewRequired).toBe(true);
    expect(summary.review.language.status).toBe("required");
    expect(summary.review.content.status).toBe("required");
    expect(summary.review.content.outstandingCount).toBe(1);
  });

  it("reports content review unavailable before content generation", () => {
    const summary = deliverySummary(createProject({
      title: "Ocean Friends",
      theme: "ocean creatures"
    }));

    expect(summary.review.content.status).toBe("not_available");
    expect(summary.review.content.outstandingCount).toBe(0);
    expect(summary.review.content.issues).toEqual([]);
  });

  it("reports the valid choices after a DOCX is ready for review", () => {
    const project = {
      ...projectWithContent("en", "source_supported"),
      stage: "primary_output_ready" as const,
      primaryOutput: { status: "ready_for_review" as const, sourceRevision: 1, sha256: "a".repeat(64) }
    };
    const summary = deliverySummary(project);
    expect(summary.nextActions).toEqual(["rework_primary_output", "accept_primary_output"]);
  });

  it("preserves factual warnings after documents are ready", () => {
    const project = {
      ...projectWithContent("en", "needs_review"),
      stage: "documents_ready" as const
    };
    const summary = deliverySummary(project);

    expect(summary.stage).toBe("documents_ready");
    expect(summary.review.content.status).toBe("required");
    expect(summary.review.content.outstandingCount).toBe(1);
  });

  it("includes the optional closing page in delivery totals", () => {
    const project = projectWithContent("en", "source_supported");
    project.content = { ...project.content!, closingNote: "Keep exploring!" };
    expect(deliverySummary(project).pageCount).toBe(5);
  });

  it("reports declined Canva as completed local-first delivery", () => {
    const project = projectWithContent("en", "source_supported");
    project.primaryOutput = { status: "accepted", sourceRevision: project.sourceRevision, sha256: "a".repeat(64) };
    project.canva = { status: "declined", declinedAt: "2026-08-03T10:00:00.000Z" };
    const summary = deliverySummary(project);
    expect(summary.localDeliveryComplete).toBe(true);
    expect(summary.deliveryComplete).toBe(true);
    expect(summary.nextActions).toContain("start_canva");
  });

  it("offers retry and readiness recovery after a retryable Canva failure", () => {
    const project = projectWithContent("en", "source_supported");
    project.primaryOutput = { status: "accepted", sourceRevision: project.sourceRevision, sha256: "a".repeat(64) };
    project.canva = {
      status: "failed",
      consentedAt: "2026-08-03T10:00:00.000Z",
      failure: { code: "timeout", message: "Timed out", retryable: true, failedAt: "2026-08-03T10:01:00.000Z" }
    };
    expect(deliverySummary(project).nextActions).toEqual(expect.arrayContaining(["prepare_canva_handoff", "start_canva"]));
  });
});
