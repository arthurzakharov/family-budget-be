import { beforeAll, describe, expect, test } from "bun:test";
import type { Db } from "@/db/client";
import type { AuthStatus, ErrorResponse } from "@/types/responses";
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

const newEmail = (): string => `${crypto.randomUUID()}@Example.com`;

async function signup(browser: Browser, email = newEmail()) {
  return browser.json<AuthStatus>("POST", "/auth/signup", {
    email,
    password: PASSWORD,
    name: "  Admin  ",
    userPassword: PASSWORD,
  });
}

describe("auth", () => {
  test("status is none without a session", async () => {
    const browser = new Browser(createTestApp({ db }));

    expect(await browser.json("GET", "/auth/status")).toEqual({
      stage: "none",
    });
  });

  test("signup creates the workspace and logs its admin in", async () => {
    const browser = new Browser(createTestApp({ db }));

    const status = await signup(browser);

    expect(status).toEqual({
      stage: "user",
      user: {
        id: expect.any(String),
        name: "Admin",
        role: "admin",
        groupIds: [],
      },
    });
    expect(await browser.json("GET", "/auth/status")).toEqual(status);
  });

  test("session cookie is HttpOnly and SameSite=Lax locally", async () => {
    const res = await new Browser(createTestApp({ db })).request(
      "POST",
      "/auth/signup",
      {
        email: newEmail(),
        password: PASSWORD,
        name: "A",
        userPassword: PASSWORD,
      },
    );

    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  test("session cookie is Secure and SameSite=None when secure", async () => {
    const res = await new Browser(createTestApp({ db, secure: true })).request(
      "POST",
      "/auth/signup",
      {
        email: newEmail(),
        password: PASSWORD,
        name: "A",
        userPassword: PASSWORD,
      },
    );

    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=None");
  });

  test("signup rejects a taken email, case-insensitively", async () => {
    const email = newEmail();
    await signup(new Browser(createTestApp({ db })), email);

    const res = await new Browser(createTestApp({ db })).request(
      "POST",
      "/auth/signup",
      {
        email: email.toUpperCase(),
        password: PASSWORD,
        name: "B",
        userPassword: PASSWORD,
      },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "Conflict",
      code: "errors.emailTaken",
    });
  });

  test("signup validates its fields with translation keys", async () => {
    const browser = new Browser(createTestApp({ db }));
    const valid = {
      email: newEmail(),
      password: PASSWORD,
      name: "A",
      userPassword: PASSWORD,
    };

    const codes = [];
    for (const body of [
      { ...valid, email: "nope" },
      { ...valid, password: "short" },
      { ...valid, name: "   " },
      { ...valid, userPassword: undefined },
    ]) {
      const res = await browser.request("POST", "/auth/signup", body);
      expect(res.status).toBe(400);
      codes.push(((await res.json()) as ErrorResponse).code);
    }

    expect(codes).toEqual([
      "errors.email",
      "errors.password",
      "errors.name",
      "errors.password",
    ]);
  });

  test("logging in takes two steps", async () => {
    const ws = await setupWorkspace(db);
    const browser = new Browser(ws.app);

    const unlocked = await browser.json<AuthStatus>("POST", "/auth/login", {
      email: ws.email.toUpperCase(),
      password: PASSWORD,
    });
    expect(unlocked).toEqual({
      stage: "workspace",
      users: [
        { id: ws.users.admin.id, name: "Admin" },
        { id: ws.users.contributor.id, name: "Vera" },
        { id: ws.users.viewer.id, name: "Kid" },
        { id: ws.users.other.id, name: "Dad" },
      ],
    });
    expect(await browser.json("GET", "/auth/status")).toEqual(unlocked);

    const picked = await browser.json("POST", "/auth/user-login", {
      userId: ws.users.contributor.id,
      password: PASSWORD,
    });
    expect(picked).toEqual({ stage: "user", user: ws.users.contributor });
  });

  test("login rejects a wrong email or password", async () => {
    const ws = await setupWorkspace(db);
    const browser = new Browser(ws.app);

    for (const body of [
      { email: ws.email, password: "wrong-password" },
      { email: "unknown@example.com", password: PASSWORD },
      { email: ws.email },
    ]) {
      const res = await browser.request("POST", "/auth/login", body);
      expect(res.status).toBe(body.password ? 401 : 400);
      expect(await res.json()).toMatchObject({
        code: "errors.invalidCredentials",
      });
    }
  });

  test("user login needs an unlocked workspace and the right password", async () => {
    const ws = await setupWorkspace(db);
    const browser = new Browser(ws.app);
    const body = { userId: ws.users.viewer.id, password: PASSWORD };

    const locked = await browser.request("POST", "/auth/user-login", body);
    expect(locked.status).toBe(401);
    expect(await locked.json()).toMatchObject({ code: "errors.unauthorized" });

    await browser.json("POST", "/auth/login", {
      email: ws.email,
      password: PASSWORD,
    });
    for (const wrong of [
      { ...body, password: "wrong-password" },
      { ...body, userId: crypto.randomUUID() },
    ]) {
      const res = await browser.request("POST", "/auth/user-login", wrong);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        code: "errors.invalidCredentials",
      });
    }
  });

  test("switch-user goes back to picking a user", async () => {
    const ws = await setupWorkspace(db);

    const status = await ws.viewer.json<AuthStatus>(
      "POST",
      "/auth/switch-user",
    );

    expect(status.stage).toBe("workspace");
    expect((await ws.viewer.request("GET", "/groups")).status).toBe(401);
    const anonymous = new Browser(ws.app);
    expect((await anonymous.request("POST", "/auth/switch-user")).status).toBe(
      401,
    );
  });

  test("logout ends the session and clears the cookie", async () => {
    const ws = await setupWorkspace(db);
    const cookie = ws.viewer.cookie!;

    expect(await ws.viewer.json("POST", "/auth/logout")).toEqual({
      stage: "none",
    });

    expect(ws.viewer.cookie).toBeUndefined();
    const reused = await ws.app.request("/auth/status", {
      headers: { Cookie: cookie },
    });
    expect(await reused.json()).toEqual({ stage: "none" });
    expect(await ws.viewer.json("POST", "/auth/logout")).toEqual({
      stage: "none",
    });
  });

  test("a user changes their own password", async () => {
    const ws = await setupWorkspace(db);

    const wrong = await ws.viewer.request("POST", "/auth/password", {
      current: "wrong-password",
      next: "new-secret",
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: "errors.wrongPassword" });

    const changed = await ws.viewer.request("POST", "/auth/password", {
      current: PASSWORD,
      next: "new-secret",
    });
    expect(changed.status).toBe(204);

    const browser = new Browser(ws.app);
    await browser.json("POST", "/auth/login", {
      email: ws.email,
      password: PASSWORD,
    });
    const status = await browser.json<AuthStatus>("POST", "/auth/user-login", {
      userId: ws.users.viewer.id,
      password: "new-secret",
    });
    expect(status.stage).toBe("user");
  });

  test("protected routes need a logged-in user", async () => {
    const ws = await setupWorkspace(db);

    const res = await new Browser(ws.app).request("GET", "/groups");

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: "Unauthorized",
      code: "errors.unauthorized",
    });
  });

  test("an expired session counts as logged out", async () => {
    const ws = await setupWorkspace(db);
    const { sessions } = await import("@/db/schema");
    await db.update(sessions).set({ expiresAt: new Date(0) });

    expect(await ws.viewer.json("GET", "/auth/status")).toEqual({
      stage: "none",
    });
  });
});

describe("CSRF", () => {
  test("rejects form posts from other origins", async () => {
    const app = createTestApp({ db });

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Origin: "https://evil.example.com",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "a=b",
    });

    expect(res.status).toBe(403);
  });

  test("answers a malformed JSON body with 400", async () => {
    const app = createTestApp({ db });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Bad Request" });
  });
});
