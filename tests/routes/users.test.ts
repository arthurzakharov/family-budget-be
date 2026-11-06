import { beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@/db/client";
import type { ErrorResponse, PublicUser } from "@/types/responses";
import {
  Browser,
  createTestApp,
  PASSWORD,
  setupWorkspace,
} from "@tests/helpers/api";
import { createTestDb } from "@tests/helpers/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as ErrorResponse).code;

describe("members", () => {
  test("every user sees names and roles of the workspace", async () => {
    const ws = await setupWorkspace(db);

    const members = await ws.viewer.json("GET", "/members");

    expect(members).toEqual([
      { id: ws.users.admin.id, name: "Admin", role: "admin" },
      { id: ws.users.contributor.id, name: "Vera", role: "contributor" },
      { id: ws.users.viewer.id, name: "Kid", role: "viewer" },
      { id: ws.users.other.id, name: "Dad", role: "contributor" },
    ]);
  });
});

describe("users", () => {
  test("only the admin lists users", async () => {
    const ws = await setupWorkspace(db);

    expect(await ws.admin.json("GET", "/users")).toEqual(
      Object.values(ws.users),
    );
    const res = await ws.contributor.request("GET", "/users");
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("errors.forbidden");
  });

  test("creating a user needs a unique name, a non-admin role and existing groups", async () => {
    const ws = await setupWorkspace(db);
    const valid = {
      name: "Mom",
      role: "contributor",
      password: PASSWORD,
      groupIds: [ws.g1.id, ws.g1.id],
    };

    const created = await ws.admin.json<PublicUser>(
      "POST",
      "/users",
      valid,
      201,
    );
    expect(created).toEqual({
      id: expect.any(String),
      name: "Mom",
      role: "contributor",
      groupIds: [ws.g1.id],
    });

    const cases: [unknown, string][] = [
      [{ ...valid, name: "mom" }, "errors.nameTaken"],
      [{ ...valid, role: "admin" }, "errors.role"],
      [{ ...valid, groupIds: [] }, "errors.groupsRequired"],
      [
        { ...valid, name: "New", groupIds: [crypto.randomUUID()] },
        "errors.groupsRequired",
      ],
    ];
    for (const [body, code] of cases) {
      const res = await ws.admin.request("POST", "/users", body);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe(code);
    }
  });

  test("users need groups to exist first", async () => {
    const browser = new Browser(createTestApp({ db }));
    await browser.json("POST", "/auth/signup", {
      email: `${crypto.randomUUID()}@example.com`,
      password: PASSWORD,
      name: "Admin",
      userPassword: PASSWORD,
    });

    const res = await browser.request("POST", "/users", {
      name: "Mom",
      role: "viewer",
      password: PASSWORD,
      groupIds: [crypto.randomUUID()],
    });

    expect(await codeOf(res)).toBe("errors.noGroups");
  });

  test("the admin changes a user's role and groups", async () => {
    const ws = await setupWorkspace(db);

    const updated = await ws.admin.json("PUT", `/users/${ws.users.viewer.id}`, {
      role: "contributor",
      groupIds: [ws.g2.id, ws.g1.id],
    });

    expect(updated).toEqual({
      ...ws.users.viewer,
      role: "contributor",
      groupIds: [ws.g2.id, ws.g1.id],
    });
    const status = await ws.viewer.json<{ user: PublicUser }>(
      "GET",
      "/auth/status",
    );
    expect(status.user.role).toBe("contributor");
    expect(status.user.groupIds.toSorted()).toEqual(
      [ws.g1.id, ws.g2.id].toSorted(),
    );
  });

  test("the admin's own role never changes", async () => {
    const ws = await setupWorkspace(db);

    const res = await ws.admin.request("PUT", `/users/${ws.users.admin.id}`, {
      role: "viewer",
      groupIds: [ws.g1.id],
    });

    expect(await codeOf(res)).toBe("errors.adminFixed");
  });

  test("unknown users and users of other workspaces are not found", async () => {
    const ws = await setupWorkspace(db);
    const other = await setupWorkspace(db);
    const body = { role: "viewer", groupIds: [ws.g1.id] };

    for (const id of [
      "not-a-uuid",
      crypto.randomUUID(),
      other.users.viewer.id,
    ]) {
      const res = await ws.admin.request("PUT", `/users/${id}`, body);
      expect(res.status).toBe(404);
      expect(await codeOf(res)).toBe("errors.userNotFound");
    }
  });

  test("deleting a user logs them out and keeps their records", async () => {
    const ws = await setupWorkspace(db);
    const tx = await ws.contributor.json<{ id: string }>(
      "POST",
      "/deposit/transactions",
      {
        groupId: ws.g1.id,
        type: "deposit",
        date: "2026-01-01",
        amountCents: 100,
      },
      201,
    );

    const res = await ws.admin.request(
      "DELETE",
      `/users/${ws.users.contributor.id}`,
    );

    expect(res.status).toBe(204);
    expect(
      (await ws.contributor.json<{ stage: string }>("GET", "/auth/status"))
        .stage,
    ).toBe("workspace");
    const list = await ws.admin.json<{ id: string; userId: string | null }[]>(
      "GET",
      "/deposit/transactions",
    );
    expect(list).toEqual([
      expect.objectContaining({ id: tx.id, userId: null }),
    ]);
  });

  test("the admin cannot delete themselves", async () => {
    const ws = await setupWorkspace(db);

    const res = await ws.admin.request("DELETE", `/users/${ws.users.admin.id}`);

    expect(await codeOf(res)).toBe("errors.cannotDeleteSelf");
  });

  test("the admin sets a user's password", async () => {
    const ws = await setupWorkspace(db);

    const short = await ws.admin.request(
      "PUT",
      `/users/${ws.users.viewer.id}/password`,
      { password: "x" },
    );
    expect(await codeOf(short)).toBe("errors.password");
    const res = await ws.admin.request(
      "PUT",
      `/users/${ws.users.viewer.id}/password`,
      { password: "new-secret" },
    );
    expect(res.status).toBe(204);

    const browser = new Browser(ws.app);
    await browser.json("POST", "/auth/login", {
      email: ws.email,
      password: PASSWORD,
    });
    const status = await browser.json<{ stage: string }>(
      "POST",
      "/auth/user-login",
      {
        userId: ws.users.viewer.id,
        password: "new-secret",
      },
    );
    expect(status.stage).toBe("user");
  });
});
