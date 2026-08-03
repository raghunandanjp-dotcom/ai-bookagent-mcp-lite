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
    schemaVersion: "1.0",
    title: language === "kn" ? "ಸಾಗರ ಸ್ನೇಹಿತರು" : "Ocean Friends",
    language,
    creatures: [{
      creatureId: "octopus",
      displayName: language === "kn" ? "ಆಕ್ಟೋಪಸ್" : "Octopus",
      poem: { text, language, reviewStatus: "human_reviewed" },
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
});
