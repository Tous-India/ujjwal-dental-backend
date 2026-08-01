import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Report from "../../src/modules/reports/report.model.js";

describe("Reports", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("GET /api/reports - lists reports (admin auth)", async () => {
    const res = await request(app)
      .get("/api/reports")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /api/reports - rejects unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/reports");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/reports/patient/:patientId - gets patient reports", async () => {
    const res = await request(app)
      .get(`/api/reports/patient/${testData.patient._id.toString()}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // Exercises the real reportNumber pre-save hook against the real
  // mongodb-memory-server DB. Goes through Report.create() directly rather
  // than the HTTP /api/reports upload endpoint, since that endpoint requires
  // real Cloudinary credentials (local .env has placeholders only) -- the
  // race-condition fix lives entirely in the model's number-generation
  // logic, which this exercises exactly the same way the controller does.
  const makeReportInput = (overrides = {}) => ({
    patient: testData.patient._id,
    uploadedBy: testData.admin._id,
    title: "Test Report",
    category: "xray",
    files: [
      { url: "https://example.com/a.pdf", publicId: "a", fileName: "a.pdf" },
    ],
    ...overrides,
  });

  it("multi-file upload creates exactly ONE Report document with a files[] array, no duplicate-key error", async () => {
    const report = await Report.createSafe(
      makeReportInput({
        files: [
          { url: "https://example.com/1.pdf", publicId: "multi-1", fileName: "1.pdf" },
          { url: "https://example.com/2.pdf", publicId: "multi-2", fileName: "2.pdf" },
          { url: "https://example.com/3.pdf", publicId: "multi-3", fileName: "3.pdf" },
        ],
      }),
    );

    expect(report.files.length).toBe(3);
    expect(report.reportNumber).toMatch(/^XRY-\d{4}-\d{4}$/);

    const matching = await Report.countDocuments({ title: "Test Report" });
    expect(matching).toBe(1);
  });

  it("two reports created back-to-back get distinct reportNumbers, no E11000 collision", async () => {
    const [first, second] = await Promise.all([
      Report.createSafe(makeReportInput({ title: "Concurrent A" })),
      Report.createSafe(makeReportInput({ title: "Concurrent B" })),
    ]);

    expect(first.reportNumber).toBeTruthy();
    expect(second.reportNumber).toBeTruthy();
    expect(first.reportNumber).not.toBe(second.reportNumber);
  });
});
