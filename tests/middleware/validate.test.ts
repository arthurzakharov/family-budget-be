import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { hc } from "hono/client";
import { z } from "zod";
import { errorHandler } from "@/middleware/error-handler";
import { requestContext } from "@/middleware/request-context";
import { validate } from "@/middleware/validate";
import type { ErrorResponse } from "@/types/responses";
import { createTestLog } from "@tests/helpers/log";

const transactionSchema = z.object({
  title: z.string().min(1),
  amount: z.number(),
});
const listSchema = z.object({ page: z.coerce.number().int().positive() });

function createTestApp() {
  const { log } = createTestLog();
  return new Hono()
    .use(requestContext(log))
    .post("/transactions", validate("json", transactionSchema), (c) =>
      c.json(c.req.valid("json"), 201),
    )
    .get("/transactions", validate("query", listSchema), (c) =>
      c.json(c.req.valid("query")),
    )
    .onError(errorHandler());
}

describe("validate", () => {
  test("passes valid input to the handler as parsed data", async () => {
    const app = createTestApp();

    const created = await app.request("/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Rent", amount: 100 }),
    });
    const listed = await app.request("/transactions?page=2");

    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ title: "Rent", amount: 100 });
    expect(await listed.json()).toEqual({ page: 2 });
  });

  test("answers invalid input with 400 and one issue per field, prefixed with the target", async () => {
    const app = createTestApp();

    const res = await app.request("/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "r-1" },
      body: JSON.stringify({ title: "", amount: "100" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body).toMatchObject({ error: "Bad Request", requestId: "r-1" });
    expect(body.issues?.map((issue) => issue.path)).toEqual([
      "json.title",
      "json.amount",
    ]);
  });

  test("validates query parameters", async () => {
    const res = await createTestApp().request("/transactions?page=0");

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.issues?.[0]?.path).toBe("query.page");
  });

  test("makes the validated input part of the client types", () => {
    const client = hc<ReturnType<typeof createTestApp>>("http://localhost");

    // Compile-time check only: the request is never sent.
    const send = (): unknown => [
      client.transactions.$post({ json: { title: "Rent", amount: 100 } }),
      // @ts-expect-error amount must be a number
      client.transactions.$post({ json: { title: "Rent", amount: "100" } }),
    ];

    expect(send).toBeFunction();
  });
});
