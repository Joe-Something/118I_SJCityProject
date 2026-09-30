import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePublishedIssueDate } from "../src/lib/public-permit-dates.ts";

const now = new Date("2026-09-30T09:15:00.000Z");

test("accepts an issue date on the inclusive 30-day dataset boundary", () => {
  assert.equal(
    parsePublishedIssueDate("8/31/2026", now)?.toISOString(),
    "2026-08-31T12:00:00.000Z",
  );
});

test("rejects records older than the published 30-day window", () => {
  assert.equal(parsePublishedIssueDate("8/30/2026", now), null);
});

test("rejects issue dates after today", () => {
  assert.equal(parsePublishedIssueDate("10/1/2026", now), null);
});

test("rejects malformed and impossible calendar dates", () => {
  for (const value of ["", "not a date", "8/31/2026 extra", "2/29/2026", "13/1/2026"]) {
    assert.equal(parsePublishedIssueDate(value, now), null, value);
  }
});

test("accepts today's issue date", () => {
  assert.equal(
    parsePublishedIssueDate("9/30/2026", now)?.toISOString(),
    "2026-09-30T12:00:00.000Z",
  );
});