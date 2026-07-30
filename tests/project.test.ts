import { describe, expect, it } from "vitest";
import path from "node:path";
import { createProject, resolveInside } from "../src/project.ts";

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
});
