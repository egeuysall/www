import { expect, test } from "bun:test";

import { viewBaseline } from "../../../convex/view_baseline";

test("view baselines are stable and stay between 650 and 1500", () => {
  const keys = ["blog:summer", "diary:2026-06-07", "photo:img-31"];
  const views = keys.map(viewBaseline);

  expect(keys.map(viewBaseline)).toEqual(views);
  expect(views.every((count) => count >= 650 && count <= 1_500)).toBe(true);
  expect(new Set(views).size).toBeGreaterThan(1);
});
