import { beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@/db/client";
import type { ErrorResponse, PublicUser } from "@/types/responses";
import { setupWorkspace, type Browser } from "@tests/helpers/api";
import { createTestDb } from "@tests/helpers/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as ErrorResponse).code;

const groupsOf = async (browser: Browser, id: string) =>
  (await browser.json<PublicUser[]>("GET", "/users"))
    .find((u) => u.id === id)!
    .groupIds.toSorted();

describe("groups", () => {
  test("every user lists the workspace's groups", async () => {
    const ws = await setupWorkspace(db);

    expect(await ws.viewer.json("GET", "/groups")).toEqual([ws.g1, ws.g2]);
  });

  test("only the admin creates groups, with unique names", async () => {
    const ws = await setupWorkspace(db);

    expect(
      (await ws.contributor.request("POST", "/groups", { name: "Kids" }))
        .status,
    ).toBe(403);
    const taken = await ws.admin.request("POST", "/groups", {
      name: " family ",
    });
    expect(await codeOf(taken)).toBe("errors.groupNameTaken");
    const empty = await ws.admin.request("POST", "/groups", { name: "" });
    expect(await codeOf(empty)).toBe("errors.name");
  });

  test("the admin adds and removes members", async () => {
    const ws = await setupWorkspace(db);
    const id = ws.users.viewer.id;

    const added = await ws.admin.request(
      "POST",
      `/groups/${ws.g2.id}/members`,
      { userId: id },
    );
    expect(added.status).toBe(204);
    await ws.admin.request("POST", `/groups/${ws.g2.id}/members`, {
      userId: id,
    });
    expect(await groupsOf(ws.admin, id)).toEqual(
      [ws.g1.id, ws.g2.id].toSorted(),
    );

    const removed = await ws.admin.request(
      "DELETE",
      `/groups/${ws.g1.id}/members/${id}`,
    );
    expect(removed.status).toBe(204);
    expect(await groupsOf(ws.admin, id)).toEqual([ws.g2.id]);
  });

  test("users keep at least one group and the admin none", async () => {
    const ws = await setupWorkspace(db);

    const last = await ws.admin.request(
      "DELETE",
      `/groups/${ws.g1.id}/members/${ws.users.viewer.id}`,
    );
    expect(await codeOf(last)).toBe("errors.lastGroup");
    const admin = await ws.admin.request(
      "POST",
      `/groups/${ws.g1.id}/members`,
      { userId: ws.users.admin.id },
    );
    expect(await codeOf(admin)).toBe("errors.adminNoGroups");
  });

  test("unknown groups and users are not found", async () => {
    const ws = await setupWorkspace(db);
    const other = await setupWorkspace(db);

    const group = await ws.admin.request(
      "POST",
      `/groups/${other.g1.id}/members`,
      { userId: ws.users.viewer.id },
    );
    expect(group.status).toBe(404);
    expect(await codeOf(group)).toBe("errors.groupNotFound");
    const user = await ws.admin.request(
      "DELETE",
      `/groups/${ws.g1.id}/members/${other.users.viewer.id}`,
    );
    expect(user.status).toBe(404);
    expect(await codeOf(user)).toBe("errors.userNotFound");
  });
});
