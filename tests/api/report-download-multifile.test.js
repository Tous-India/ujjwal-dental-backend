import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";

// No real Cloudinary credentials in this test environment -- stub the
// signed-URL generator so the endpoint's own file-selection/fallback logic
// (the thing actually being tested) can run without needing live cloud
// config, matching how other external-service calls are handled in this
// suite (e.g. Resend email failures are expected/tolerated, not mocked
// away entirely -- here we mock only the one call that would otherwise
// require real credentials neither available nor relevant to this fix).
vi.mock("../../src/middlewares/upload.middleware.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getSignedUrl: (publicId) => `https://signed.example/${publicId}` };
});

const app = (await import("../../app.js")).default;
const { getAdminToken, authHeader } = await import("../helpers/auth.js");
const { testData } = await import("../helpers/seed.js");
const Report = (await import("../../src/modules/reports/report.model.js")).default;

describe("GET /api/reports/:id/download -- fixed to handle multi-file reports (was: crashed reading report.file.publicId, undefined for multi-file reports)", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): a multi-file report (no legacy `file`) downloads its first file successfully, not a crash", async () => {
    const report = await Report.create({
      patient: testData.patient._id,
      title: "Multi-file test",
      category: "xray",
      uploadedBy: testData.admin._id,
      files: [
        { url: "https://res.cloudinary.com/demo/image/upload/a.pdf", publicId: "a", fileName: "a.pdf", fileType: "application/pdf" },
        { url: "https://res.cloudinary.com/demo/image/upload/b.jpg", publicId: "b", fileName: "b.jpg", fileType: "image/jpeg" },
      ],
    });

    const res = await request(app)
      .get(`/api/reports/${report._id}/download`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.downloadUrl).toBeTruthy();
    expect(res.body.data.fileName).toBe("a.pdf");
    expect(res.body.data.totalFiles).toBe(2);

    await Report.deleteOne({ _id: report._id });
  });

  it("T2: fileIndex selects a specific file from a multi-file report", async () => {
    const report = await Report.create({
      patient: testData.patient._id,
      title: "Multi-file test 2",
      category: "lab_report",
      uploadedBy: testData.admin._id,
      files: [
        { url: "https://res.cloudinary.com/demo/image/upload/a.pdf", publicId: "a", fileName: "a.pdf", fileType: "application/pdf" },
        { url: "https://res.cloudinary.com/demo/image/upload/b.jpg", publicId: "b", fileName: "b.jpg", fileType: "image/jpeg" },
      ],
    });

    const res = await request(app)
      .get(`/api/reports/${report._id}/download`)
      .set(authHeader(token))
      .query({ fileIndex: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.fileName).toBe("b.jpg");

    await Report.deleteOne({ _id: report._id });
  });

  it("T3: an OLD single-file report (legacy `file`, no `files`) still downloads correctly", async () => {
    const report = await Report.create({
      patient: testData.patient._id,
      title: "Legacy single-file",
      category: "xray",
      uploadedBy: testData.admin._id,
      file: { url: "https://res.cloudinary.com/demo/image/upload/legacy.pdf", publicId: "legacy", fileName: "legacy.pdf", fileType: "application/pdf" },
    });

    const res = await request(app)
      .get(`/api/reports/${report._id}/download`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.fileName).toBe("legacy.pdf");
    expect(res.body.data.totalFiles).toBe(1);

    await Report.deleteOne({ _id: report._id });
  });
});
