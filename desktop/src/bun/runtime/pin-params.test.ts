import { expect, test } from "bun:test";
import { pinParamsSchema } from "./pin-params";

test("threads.pin params need a boolean pinned and a thread id", () => {
  expect(pinParamsSchema.safeParse({ threadId: "t", pinned: true }).success).toBe(true);
  expect(pinParamsSchema.safeParse({ threadId: "t", pinned: false }).success).toBe(true);
  for (const pinned of ["false", "true", 0, 1, null, undefined]) expect(pinParamsSchema.safeParse({ threadId: "t", pinned }).success).toBe(false);
  expect(pinParamsSchema.safeParse({ threadId: "", pinned: true }).success).toBe(false);
  expect(pinParamsSchema.safeParse({ threadId: "t", pinned: true, extra: 1 }).success).toBe(false);
});
