import { describe, it, expect } from "vitest";
import { parseIstDateRange, istStartOfDay, istEndOfDay } from "../../src/utils/istDateRange.js";

describe("parseIstDateRange -- fixes Billing Today/Yesterday zero-results bug (UTC-midnight vs IST-midnight)", () => {
  it("T1 (HARD GATE): a same-day 'Today' range (from===to) is NOT zero-width -- spans the full IST calendar day", () => {
    const range = parseIstDateRange("2026-07-28", "2026-07-28");
    // Old buggy behavior: new Date("2026-07-28") for BOTH from and to produced
    // an IDENTICAL instant (2026-07-28T00:00:00.000Z), a zero-width range that
    // matched nothing. Fixed range must span the whole day.
    expect(range.$gte.getTime()).not.toBe(range.$lte.getTime());
    expect(range.$lte.getTime() - range.$gte.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);

    // Confirmed real payment createdAt from production: 2026-07-28T04:38:10.029Z
    // (a 2000-rupee payment made at 10:08 AM IST on 2026-07-28) must fall
    // inside "Today"'s range when today=2026-07-28.
    const realPayment1 = new Date("2026-07-28T04:38:10.029Z");
    const realPayment2 = new Date("2026-07-28T04:33:25.967Z");
    const realPayment3 = new Date("2026-07-28T04:32:06.235Z");
    for (const p of [realPayment1, realPayment2, realPayment3]) {
      expect(p.getTime()).toBeGreaterThanOrEqual(range.$gte.getTime());
      expect(p.getTime()).toBeLessThanOrEqual(range.$lte.getTime());
    }
  });

  it("T2 (HARD GATE): 'Yesterday' range correctly captures a real payment made at 2026-07-27T10:06:17 UTC (15:36 IST)", () => {
    const range = parseIstDateRange("2026-07-27", "2026-07-27");
    const realPayment = new Date("2026-07-27T10:06:17.149Z"); // Rs300, confirmed real
    expect(realPayment.getTime()).toBeGreaterThanOrEqual(range.$gte.getTime());
    expect(realPayment.getTime()).toBeLessThanOrEqual(range.$lte.getTime());

    // And must NOT bleed into "today" (2026-07-28)'s range
    const todayRange = parseIstDateRange("2026-07-28", "2026-07-28");
    expect(realPayment.getTime()).toBeLessThan(todayRange.$gte.getTime());
  });

  it("T3: a payment made at 12:15 AM IST is correctly attributed to that LOCAL day, not shifted by the UTC boundary", () => {
    // 2026-07-28T00:15:00 IST = 2026-07-27T18:45:00 UTC
    const earlyMorningIst = new Date("2026-07-27T18:45:00.000Z");
    const july28Range = parseIstDateRange("2026-07-28", "2026-07-28");
    const july27Range = parseIstDateRange("2026-07-27", "2026-07-27");

    expect(earlyMorningIst.getTime()).toBeGreaterThanOrEqual(july28Range.$gte.getTime());
    expect(earlyMorningIst.getTime()).toBeLessThanOrEqual(july28Range.$lte.getTime());
    // Must NOT fall in the 27th's range
    expect(earlyMorningIst.getTime()).toBeGreaterThan(july27Range.$lte.getTime());
  });

  it("istStartOfDay/istEndOfDay produce the exact expected UTC instants for a known IST date", () => {
    // 2026-07-28 00:00:00 IST = 2026-07-27 18:30:00 UTC
    expect(istStartOfDay("2026-07-28").toISOString()).toBe("2026-07-27T18:30:00.000Z");
    // 2026-07-28 23:59:59.999 IST = 2026-07-28 18:29:59.999 UTC
    expect(istEndOfDay("2026-07-28").toISOString()).toBe("2026-07-28T18:29:59.999Z");
  });
});
