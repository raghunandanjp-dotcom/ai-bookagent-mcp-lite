import { describe, expect, it } from "vitest";
import path from "node:path";
import { createProject, parseProject, resolveInside } from "../src/project.ts";

describe("portable project state", () => {
  it("always includes DOCX", () => {
    const project = createProject({
      title: "Desert Friends",
      theme: "desert animals",
      outputFormats: ["pdf"]
    });
    expect(project.request.outputFormats).toEqual(["docx", "pdf"]);
  });

  it("rejects paths outside the project directory", () => {
    const base = path.resolve("book");
    expect(() => resolveInside(base, "../other")).toThrow(/inside the project directory/i);
  });

  it("normalizes legacy manifests with output workflow defaults", () => {
    const legacy = createProject({ title: "Desert Friends", theme: "desert animals" }) as Record<string, unknown>;
    delete legacy.sourceRevision;
    delete legacy.reworksUsed;
    delete legacy.primaryOutput;
    delete legacy.contentGeneration;
    const parsed = parseProject(legacy);
    expect(parsed).toMatchObject({
      sourceRevision: 1,
      reworksUsed: 0,
      primaryOutput: { status: "not_ready" },
      contentGeneration: { iterationsUsed: 0, currentAttempt: 0 }
    });
  });
});
