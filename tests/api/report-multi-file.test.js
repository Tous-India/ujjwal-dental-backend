import { describe, it, expect } from "vitest";
import Report from "../../src/modules/reports/report.model.js";
import { testData } from "../helpers/seed.js";

describe("Report model -- multi-file support (files[] array, backward-compat file field)", () => {
  it("T1 (HARD GATE, data-layer): saves 3 files each with its own description, all intact on read-back", async () => {
    const report = await Report.create({
      patient: testData.patient._id,
      title: "Multi-file test report",
      category: "lab_report",
      uploadedBy: testData.admin._id,
      files: [
        { url: "https://x/a.pdf", publicId: "a", description: "Front view" },
        { url: "https://x/b.pdf", publicId: "b", description: "Side view" },
        { url: "https://x/c.pdf", publicId: "c", description: "" },
      ],
    });

    const saved = await Report.findById(report._id).lean();
    expect(saved.files).toHaveLength(3);
    expect(saved.files[0].description).toBe("Front view");
    expect(saved.files[1].description).toBe("Side view");
    expect(saved.files[2].description).toBe("");
    expect(saved.files[0].url).toBe("https://x/a.pdf");

    await Report.deleteOne({ _id: report._id });
  });

  it("T4: an OLD single-file report (pre-multi-file schema, only `file` set, `files` absent) still saves and reads correctly", async () => {
    const oldReport = await Report.create({
      patient: testData.patient._id,
      title: "Legacy single-file report",
      category: "xray",
      uploadedBy: testData.admin._id,
      file: { url: "https://x/legacy.pdf", publicId: "legacy-id" },
    });

    const saved = await Report.findById(oldReport._id).lean();
    expect(saved.file.url).toBe("https://x/legacy.pdf");
    expect(saved.file.publicId).toBe("legacy-id");
    expect(saved.files).toEqual([]);

    await Report.deleteOne({ _id: oldReport._id });
  });
});
