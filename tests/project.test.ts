import { describe, expect, it } from "vitest";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProject, parseProject, resolveInside } from "../src/project.ts";
import { initializeProject } from "../src/workflow.ts";

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

  it("rejects a relative project directory before mutation from a foreign host working directory", async () => {
    const originalWorkingDirectory = process.cwd();
    const foreignHostDirectory = await mkdtemp(path.join(os.tmpdir(), "bookagent-host-"));
    const relativeProjectDirectory = "relative-book-project";

    try {
      process.chdir(foreignHostDirectory);
      await expect(initializeProject(relativeProjectDirectory, {
        title: "Ocean Friends",
        theme: "ocean creatures"
      })).rejects.toThrow(/absolute path/i);
      await expect(access(path.join(foreignHostDirectory, relativeProjectDirectory))).rejects.toThrow();
    } finally {
      process.chdir(originalWorkingDirectory);
      await rm(foreignHostDirectory, { recursive: true, force: true });
    }
  });

  it("normalizes legacy manifests with output workflow defaults", () => {
    const legacy = createProject({ title: "Desert Friends", theme: "desert animals" }) as Record<string, unknown>;
    delete legacy.sourceRevision;
    delete legacy.reworksUsed;
    delete legacy.primaryOutput;
    delete legacy.contentGeneration;
    delete legacy.rhymeOverrides;
    delete legacy.illustrations;
    legacy.schemaVersion = "1.0";
    const parsed = parseProject(legacy);
    expect(parsed).toMatchObject({
      sourceRevision: 1,
      reworksUsed: 0,
      primaryOutput: { status: "not_ready" },
      contentGeneration: { iterationsUsed: 0, currentAttempt: 0 },
      rhymeOverrides: {},
      illustrations: []
    });
  });

  it("rejects malformed persisted Canva state", () => {
    const project = createProject({ title: "Desert Friends", theme: "desert animals" });
    const malformed = { ...project, canva: { status: "failed", failure: { code: "timeout" } } };
    expect(() => parseProject(malformed)).toThrow();
  });
});
