import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { expenseCategories, expenseEntries, workspaces } from "@/db/schema";
import { ApiError } from "@/errors";
import { assertUsableGroup, chosenUserId, recordId } from "@/lib/access";
import { allCategories } from "@/lib/categories";
import { visibleRecord, visibleTo } from "@/lib/records";
import * as Schemas from "@/lib/schemas";
import type { CurrentUser } from "@/lib/sessions";
import { requireUser } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import type { AppEnv } from "@/types/app-env";
import type { Category, ExpenseEntry } from "@/types/responses";

const createCategorySchema = z.object({
  name: Schemas.name,
  kind: z.enum(["expense", "income"], { error: "errors.categoryKind" }),
});

const updateCategorySchema = z.object({
  hidden: z.boolean({ error: "errors.hidden" }),
});

const entrySchema = z.object({
  groupId: Schemas.groupId,
  categoryId: z.string({ error: "errors.category" }),
  date: Schemas.date(),
  amountCents: Schemas.amountCents,
  note: z
    .string({ error: "errors.note" })
    .trim()
    .max(200, { error: "errors.note" })
    .default(""),
  userId: Schemas.recordUserId,
});

const columns = {
  id: expenseEntries.id,
  userId: expenseEntries.userId,
  groupId: expenseEntries.groupId,
  date: expenseEntries.date,
  categoryId: expenseEntries.categoryId,
  amountCents: expenseEntries.amountCents,
  note: expenseEntries.note,
};

const NOT_FOUND = "errors.recordNotFound";

/**
 * Expenses and income. Everyone reads the categories, only the admin creates,
 * hides and shows them. Reading entries is for everyone, changes need a
 * non-viewer; both only within the user's groups.
 */
export function createExpenseRoutes(db: Db) {
  /** All categories, hidden ones too, to name the categories of old entries. */
  async function categoriesOf(workspaceId: string): Promise<Category[]> {
    const [[workspace], custom] = await Promise.all([
      db
        .select({ hidden: workspaces.hiddenCategories })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId)),
      db
        .select({
          id: expenseCategories.id,
          kind: expenseCategories.kind,
          name: expenseCategories.name,
        })
        .from(expenseCategories)
        .where(eq(expenseCategories.workspaceId, workspaceId))
        .orderBy(expenseCategories.createdAt, expenseCategories.id),
    ]);
    return allCategories({ custom, hidden: workspace!.hidden });
  }

  /**
   * Throws unless the category is visible and the group usable. When editing,
   * the entry's own category stays allowed even if the admin has hidden it since.
   */
  async function assertValid(
    user: CurrentUser,
    body: { categoryId: string; groupId: string },
    existingCategoryId?: string,
  ) {
    const categories = await categoriesOf(user.workspaceId);
    const allowed = categories.some(
      (c) =>
        c.id === body.categoryId && (!c.hidden || c.id === existingCategoryId),
    );
    if (!allowed) throw new ApiError(400, "errors.category");
    await assertUsableGroup(db, user, body.groupId);
  }

  async function findEntry(user: CurrentUser, id: string) {
    const [found] = await db
      .select(columns)
      .from(expenseEntries)
      .where(visibleRecord(expenseEntries, user, recordId(id, NOT_FOUND)));
    if (!found) throw new ApiError(404, NOT_FOUND);
    return found;
  }

  const admin = requireUser(db, { admin: true });
  const reader = requireUser(db);
  const editor = requireUser(db, { edit: true });

  return (
    new Hono<AppEnv>()
      .get("/expenses/categories", reader, async (c) =>
        c.json<Category[]>(await categoriesOf(c.var.user.workspaceId)),
      )
      // Creates a category in one of the two lists; answers with all categories.
      .post(
        "/expenses/categories",
        admin,
        validate("json", createCategorySchema),
        async (c) => {
          const { name, kind } = c.req.valid("json");
          const { workspaceId } = c.var.user;
          const existing = await categoriesOf(workspaceId);
          const taken = existing.some(
            (cat) =>
              cat.kind === kind &&
              cat.name?.toLowerCase() === name.toLowerCase(),
          );
          if (taken) throw new ApiError(400, "errors.categoryNameTaken");
          await db
            .insert(expenseCategories)
            .values({ workspaceId, kind, name });
          return c.json<Category[]>(await categoriesOf(workspaceId), 201);
        },
      )
      // Shows or hides a category; answers with all categories.
      .put(
        "/expenses/categories/:id",
        admin,
        validate("json", updateCategorySchema),
        async (c) => {
          const { hidden } = c.req.valid("json");
          const { workspaceId } = c.var.user;
          const id = c.req.param("id");
          const categories = await categoriesOf(workspaceId);
          if (!categories.some((cat) => cat.id === id)) {
            throw new ApiError(404, "errors.categoryNotFound");
          }
          const others = categories
            .filter((cat) => cat.hidden && cat.id !== id)
            .map((cat) => cat.id);
          await db
            .update(workspaces)
            .set({ hiddenCategories: hidden ? [...others, id] : others })
            .where(eq(workspaces.id, workspaceId));
          return c.json<Category[]>(await categoriesOf(workspaceId));
        },
      )
      .get("/expenses/entries", reader, async (c) =>
        c.json<ExpenseEntry[]>(
          await db
            .select(columns)
            .from(expenseEntries)
            .where(visibleTo(expenseEntries, c.var.user))
            .orderBy(expenseEntries.date, expenseEntries.createdAt),
        ),
      )
      .post(
        "/expenses/entries",
        editor,
        validate("json", entrySchema),
        async (c) => {
          const { userId, ...body } = c.req.valid("json");
          const user = c.var.user;
          await assertValid(user, body);
          const owner = (await chosenUserId(db, user, userId)) ?? user.id;
          const [created] = await db
            .insert(expenseEntries)
            .values({ ...body, workspaceId: user.workspaceId, userId: owner })
            .returning(columns);
          return c.json<ExpenseEntry>(created!, 201);
        },
      )
      .put(
        "/expenses/entries/:id",
        editor,
        validate("json", entrySchema),
        async (c) => {
          const { userId, ...body } = c.req.valid("json");
          const user = c.var.user;
          const existing = await findEntry(user, c.req.param("id"));
          await assertValid(user, body, existing.categoryId);
          // Keeps the user unless the admin picked another one.
          const owner = await chosenUserId(db, user, userId);
          const [updated] = await db
            .update(expenseEntries)
            .set({ ...body, ...(owner && { userId: owner }) })
            .where(eq(expenseEntries.id, existing.id))
            .returning(columns);
          return c.json<ExpenseEntry>(updated!);
        },
      )
      .delete("/expenses/entries/:id", editor, async (c) => {
        const existing = await findEntry(c.var.user, c.req.param("id"));
        await db
          .delete(expenseEntries)
          .where(eq(expenseEntries.id, existing.id));
        return c.body(null, 204);
      })
  );
}
