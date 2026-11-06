import { beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@/db/client";
import type { Category, ErrorResponse, ExpenseEntry } from "@/types/responses";
import { setupWorkspace } from "@tests/helpers/api";
import { createTestDb } from "@tests/helpers/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as ErrorResponse).code;

const entry = (groupId: string, over: object = {}) => ({
  groupId,
  categoryId: "groceries",
  date: "2026-01-01",
  amountCents: 1234,
  ...over,
});

describe("expense categories", () => {
  test("built-in categories come first, then the admin's own", async () => {
    const ws = await setupWorkspace(db);

    const before = await ws.viewer.json<Category[]>(
      "GET",
      "/expenses/categories",
    );
    const after = await ws.admin.json<Category[]>(
      "POST",
      "/expenses/categories",
      { name: " Pocket money ", kind: "income" },
      201,
    );

    expect(before[0]).toEqual({
      id: "groceries",
      kind: "expense",
      name: null,
      hidden: false,
    });
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toEqual({
      id: expect.any(String),
      kind: "income",
      name: "Pocket money",
      hidden: false,
    });
  });

  test("names are unique per kind; only the admin creates", async () => {
    const ws = await setupWorkspace(db);
    await ws.admin.json(
      "POST",
      "/expenses/categories",
      { name: "Pets", kind: "expense" },
      201,
    );

    expect(
      await codeOf(
        await ws.admin.request("POST", "/expenses/categories", {
          name: "pets",
          kind: "expense",
        }),
      ),
    ).toBe("errors.categoryNameTaken");
    await ws.admin.json(
      "POST",
      "/expenses/categories",
      { name: "pets", kind: "income" },
      201,
    );
    expect(
      await codeOf(
        await ws.admin.request("POST", "/expenses/categories", {
          name: "X",
          kind: "other",
        }),
      ),
    ).toBe("errors.categoryKind");
    expect(
      (
        await ws.contributor.request("POST", "/expenses/categories", {
          name: "X",
          kind: "expense",
        })
      ).status,
    ).toBe(403);
  });

  test("the admin hides and shows categories", async () => {
    const ws = await setupWorkspace(db);

    const hidden = await ws.admin.json<Category[]>(
      "PUT",
      "/expenses/categories/travel",
      { hidden: true },
    );
    await ws.admin.json("PUT", "/expenses/categories/kids", { hidden: true });
    const shown = await ws.admin.json<Category[]>(
      "PUT",
      "/expenses/categories/travel",
      { hidden: false },
    );

    expect(hidden.find((c) => c.id === "travel")!.hidden).toBe(true);
    expect(shown.filter((c) => c.hidden).map((c) => c.id)).toEqual(["kids"]);
    const missing = await ws.admin.request("PUT", "/expenses/categories/nope", {
      hidden: true,
    });
    expect(missing.status).toBe(404);
    expect(await codeOf(missing)).toBe("errors.categoryNotFound");
    expect(
      await codeOf(
        await ws.admin.request("PUT", "/expenses/categories/kids", {
          hidden: "yes",
        }),
      ),
    ).toBe("errors.hidden");
  });
});

describe("expense entries", () => {
  test("users add entries in their groups and see only those", async () => {
    const ws = await setupWorkspace(db);

    const mine = await ws.contributor.json<ExpenseEntry>(
      "POST",
      "/expenses/entries",
      entry(ws.g1.id, { note: " Dentist " }),
      201,
    );
    await ws.other.json("POST", "/expenses/entries", entry(ws.g2.id), 201);

    expect(mine).toEqual({
      id: expect.any(String),
      userId: ws.users.contributor.id,
      groupId: ws.g1.id,
      date: "2026-01-01",
      categoryId: "groceries",
      amountCents: 1234,
      note: "Dentist",
    });
    expect(await ws.viewer.json("GET", "/expenses/entries")).toEqual([mine]);
    expect(
      await ws.admin.json<unknown[]>("GET", "/expenses/entries"),
    ).toHaveLength(2);
    expect(
      (await ws.viewer.request("POST", "/expenses/entries", entry(ws.g1.id)))
        .status,
    ).toBe(403);
  });

  test("validates the body with translation keys", async () => {
    const ws = await setupWorkspace(db);
    await ws.admin.json("PUT", "/expenses/categories/travel", { hidden: true });

    const cases: [object, string][] = [
      [{ categoryId: "nope" }, "errors.category"],
      [{ categoryId: "travel" }, "errors.category"],
      [{ amountCents: 0 }, "errors.amount"],
      [{ note: "x".repeat(201) }, "errors.note"],
      [{ groupId: ws.g2.id }, "errors.group"],
    ];
    for (const [over, code] of cases) {
      const res = await ws.contributor.request(
        "POST",
        "/expenses/entries",
        entry(ws.g1.id, over),
      );
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe(code);
    }
  });

  test("an edited entry keeps its category even after the admin hides it", async () => {
    const ws = await setupWorkspace(db);
    const created = await ws.contributor.json<ExpenseEntry>(
      "POST",
      "/expenses/entries",
      entry(ws.g1.id, { categoryId: "travel" }),
      201,
    );
    await ws.admin.json("PUT", "/expenses/categories/travel", { hidden: true });

    const edited = await ws.contributor.json<ExpenseEntry>(
      "PUT",
      `/expenses/entries/${created.id}`,
      entry(ws.g1.id, { categoryId: "travel", amountCents: 1 }),
    );
    const moved = await ws.admin.json<ExpenseEntry>(
      "PUT",
      `/expenses/entries/${created.id}`,
      entry(ws.g1.id, { userId: ws.users.contributor.id }),
    );

    expect(edited).toMatchObject({
      categoryId: "travel",
      amountCents: 1,
      note: "",
    });
    expect(moved).toMatchObject({
      categoryId: "groceries",
      userId: ws.users.contributor.id,
    });
  });

  test("deletes visible entries; others are not found", async () => {
    const ws = await setupWorkspace(db);
    const created = await ws.contributor.json<ExpenseEntry>(
      "POST",
      "/expenses/entries",
      entry(ws.g1.id),
      201,
    );

    const hidden = await ws.other.request(
      "DELETE",
      `/expenses/entries/${created.id}`,
    );
    expect(hidden.status).toBe(404);
    expect(await codeOf(hidden)).toBe("errors.recordNotFound");
    expect(
      (
        await ws.contributor.request(
          "DELETE",
          `/expenses/entries/${created.id}`,
        )
      ).status,
    ).toBe(204);
    expect(await ws.contributor.json("GET", "/expenses/entries")).toEqual([]);
  });
});
