import { expect, test } from "bun:test";
import { nextDay, today } from "@/lib/dates";

test("nextDay crosses months and years", () => {
  expect(nextDay("2026-02-28")).toBe("2026-03-01");
  expect(nextDay("2026-12-31")).toBe("2027-01-01");
});

test("today is the local date", () => {
  expect(today(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
