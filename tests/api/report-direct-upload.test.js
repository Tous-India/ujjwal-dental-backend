/**
 * Direct browser -> Cloudinary report upload.
 *
 * The API runs as a Vercel serverless function with a HARD ~4.5MB request body
 * limit that cannot be raised from application code. Report uploads used to
 * stream files THROUGH the API, so phone camera photos (routinely 3-12MB) were
 * rejected by the platform before our code ran, while sub-2MB desktop files
 * passed -- the "works on desktop, fails on every phone" bug. The limit also
 * applied CUMULATIVELY across the endpoint's 10 files.
 *
 * Files now upload straight to Cloudinary from the browser and only metadata
 * reaches us. Because the client reports that metadata, it is NOT trusted:
 * every URL is re-validated against our own cloud AND folder, so an
 * authenticated caller cannot attach an arbitrary third-party URL to a
 * patient's medical record. That check is T4, the security hard gate.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Report from "../../src/modules/reports/report.model.js";

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
const OK_URL = (name = "xray") =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/ujjwal-dental/${name}.jpg`;

describe("Report direct upload (browser -> Cloudinary)", () => {
  let token;

  beforeAll(async () => {
    // The signature endpoint refuses to mint anything when Cloudinary is
    // unconfigured (correct -- it fails closed). The test env has no real
    // credentials, so provide placeholders: we assert the SHAPE and the
    // folder pinning, never that Cloudinary would accept the signature.
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test-api-key";
    process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test-api-secret";
    token = await getAdminToken(app);
  });

  afterEach(async () => {
    await Report.deleteMany({ patient: testData.patient._id });
  });

  const createReport = (files, extra = {}) =>
    request(app)
      .post("/api/reports")
      .set(authHeader(token))
      .send({
        patient: testData.patient._id.toString(),
        title: "Direct Upload Test",
        category: "xray",
        files,
        ...extra,
      });

  const file = (over = {}) => ({
    url: OK_URL(),
    publicId: "ujjwal-dental/xray_abc123",
    fileName: "xray.jpg",
    fileSize: 8 * 1024 * 1024, // 8MB -- the size that used to fail
    fileType: "image/jpeg",
    ...over,
  });

  it("signature endpoint mints a SIGNED, folder-pinned signature (requires auth)", async () => {
    const res = await request(app).post("/api/uploads/signature").set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.signature).toBeTruthy();
    expect(res.body.data.timestamp).toBeTruthy();
    expect(res.body.data.folder).toBe("ujjwal-dental"); // pinned server-side
    expect(res.body.data.cloudName).toBeTruthy();
    expect(res.body.data.apiKey).toBeTruthy();
    // The secret must never leave the server.
    expect(JSON.stringify(res.body)).not.toContain(process.env.CLOUDINARY_API_SECRET || "__none__");

    const anon = await request(app).post("/api/uploads/signature");
    expect(anon.status).toBe(401);
  });

  it("T1: an 8MB file is accepted -- the size that always failed through the serverless function", async () => {
    const res = await createReport([file()]);
    expect(res.status).toBe(201);

    const saved = await Report.findById(res.body.data.report._id);
    expect(saved.files).toHaveLength(1);
    expect(saved.files[0].fileSize).toBe(8 * 1024 * 1024);
    expect(saved.files[0].url).toBe(OK_URL());
  });

  it("T2: a normal small file still works (regression)", async () => {
    const res = await createReport([
      file({ fileSize: 180 * 1024, fileName: "scan.pdf", fileType: "application/pdf" }),
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.report.files[0].fileSize).toBe(180 * 1024);
  });

  it("T3: TEN large files in one request succeed -- the cumulative limit is gone", async () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      file({
        url: OK_URL(`scan${i}`),
        publicId: `ujjwal-dental/scan${i}`,
        fileName: `scan${i}.jpg`,
        fileSize: 9 * 1024 * 1024,
      })
    );
    // 90MB of files described in a request body of a few hundred bytes.
    const res = await createReport(ten);
    expect(res.status).toBe(201);

    const saved = await Report.findById(res.body.data.report._id);
    expect(saved.files).toHaveLength(10);
    const total = saved.files.reduce((s, f) => s + f.fileSize, 0);
    expect(total).toBe(90 * 1024 * 1024);
  });

  it("T3b: an 11th file is rejected (max-files cap still enforced)", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) =>
      file({ url: OK_URL(`s${i}`), publicId: `ujjwal-dental/s${i}` })
    );
    const res = await createReport(eleven);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/maximum 10 files/i);
  });

  it("T4 (HARD GATE): a FOREIGN url is refused -- no arbitrary URL can be attached to a medical record", async () => {
    const hostile = [
      // Different host entirely
      "https://evil.example.com/ujjwal-dental/fake.jpg",
      // Right host, WRONG cloud account
      `https://res.cloudinary.com/someone-elses-cloud/image/upload/ujjwal-dental/fake.jpg`,
      // Right host and cloud, but OUTSIDE our folder
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/other-folder/fake.jpg`,
      // Folder name only as a substring, not a real path segment
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/ujjwal-dental-evil/fake.jpg`,
      // Downgraded scheme
      `http://res.cloudinary.com/${CLOUD}/image/upload/v1/ujjwal-dental/fake.jpg`,
      // Not a URL at all
      "javascript:alert(1)",
    ];

    for (const url of hostile) {
      const res = await createReport([file({ url })]);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid upload url/i);
    }

    // Nothing was persisted by any of those attempts.
    expect(await Report.countDocuments({ patient: testData.patient._id })).toBe(0);
  });

  it("T4b (HARD GATE): a foreign publicId is refused even when the url looks right", async () => {
    const res = await createReport([
      file({ url: OK_URL(), publicId: "some-other-folder/fake" }),
    ]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid storage reference/i);
    expect(await Report.countDocuments({ patient: testData.patient._id })).toBe(0);
  });

  it("T4c: a foreign thumbnailUrl is dropped rather than persisted", async () => {
    const res = await createReport([
      file({ thumbnailUrl: "https://evil.example.com/thumb.jpg" }),
    ]);
    expect(res.status).toBe(201);
    const saved = await Report.findById(res.body.data.report._id);
    expect(saved.files[0].thumbnailUrl).toBeFalsy(); // silently discarded
  });

  it("T5: HEIC and HEIF are accepted through the direct path", async () => {
    for (const type of ["image/heic", "image/heif"]) {
      const res = await createReport([
        file({ fileType: type, fileName: `photo.${type.split("/")[1]}` }),
      ]);
      expect(res.status).toBe(201);
      await Report.deleteMany({ patient: testData.patient._id });
    }
  });

  it("T5b: a disallowed file type is still rejected", async () => {
    const res = await createReport([
      file({ fileType: "application/x-msdownload", fileName: "evil.exe" }),
    ]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unsupported type/i);
  });

  it("per-file descriptions survive the direct path", async () => {
    const res = await createReport([
      file({ url: OK_URL("a"), publicId: "ujjwal-dental/a", description: "Left molar" }),
      file({ url: OK_URL("b"), publicId: "ujjwal-dental/b", description: "Right molar" }),
    ]);
    expect(res.status).toBe(201);
    const saved = await Report.findById(res.body.data.report._id);
    expect(saved.files.map((f) => f.description)).toEqual(["Left molar", "Right molar"]);
  });

  it("T6 (HARD GATE): reports created the OLD way still read back intact (backward compatibility)", async () => {
    // A report exactly as the legacy multipart path persisted it.
    const legacy = await Report.createSafe({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      title: "Legacy Report",
      category: "opg",
      files: [
        {
          url: OK_URL("legacy"),
          publicId: "ujjwal-dental/legacy_x",
          fileName: "legacy.jpg",
          fileSize: 120000,
          fileType: "image/jpeg",
          description: "old upload",
        },
      ],
      uploadedBy: testData.admin._id,
    });

    const res = await request(app)
      .get(`/api/reports/${legacy._id}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    const r = res.body.data.report;
    expect(r.title).toBe("Legacy Report");
    expect(r.files).toHaveLength(1);
    expect(r.files[0].url).toBe(OK_URL("legacy"));
    expect(r.files[0].description).toBe("old upload");

    // And it still appears in the patient's report list.
    const list = await request(app)
      .get(`/api/reports/patient/${testData.patient._id}`)
      .set(authHeader(token));
    expect(list.status).toBe(200);
    const ids = (list.body.data.reports || list.body.data).map((x) => x._id);
    expect(ids).toContain(String(legacy._id));
  });

  it("rejects an empty/missing files payload", async () => {
    const res = await createReport([]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one file/i);
  });
});
