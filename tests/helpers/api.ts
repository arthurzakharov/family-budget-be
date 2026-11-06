import { createApp } from "@/app";
import type { Db } from "@/db/client";
import type { AuthStatus, Group, PublicUser } from "@/types/responses";
import { createTestLog } from "@tests/helpers/log";

export const TODAY = "2026-03-15";

/** The frontend's origin; allowed by `createTestApp` and sent by `Browser`. */
export const ORIGIN = "http://localhost:5173";

type CreateTestAppParams = {
  db: Db;
  origin?: string[];
  secure?: boolean;
};

export function createTestApp({
  db,
  origin = [ORIGIN],
  secure = false,
}: CreateTestAppParams) {
  const { log } = createTestLog();
  return createApp({
    log,
    commitInfo: null,
    origin,
    db,
    cookie: { secure },
    today: () => TODAY,
  });
}

type TestApp = ReturnType<typeof createTestApp>;

/** Sends JSON requests to the app and keeps the session cookie, like a browser. */
export class Browser {
  #cookie: string | undefined;

  public constructor(public readonly app: TestApp) {}

  public get cookie(): string | undefined {
    return this.#cookie;
  }

  public async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const res = await this.app.request(path, {
      method,
      headers: {
        Origin: ORIGIN,
        ...(this.#cookie && { Cookie: this.#cookie }),
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const setCookie = res.headers.get("Set-Cookie");
    if (setCookie) {
      const pair = setCookie.split(";")[0]!;
      this.#cookie = pair.endsWith("=") ? undefined : pair;
    }
    return res;
  }

  /** Sends a request and returns the JSON body, failing on an unexpected status. */
  public async json<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    status = 200,
  ): Promise<NoInfer<T>> {
    const res = await this.request(method, path, body);
    if (res.status !== status) {
      throw new Error(
        `${method} ${path}: expected ${status}, got ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  /** Logs in as a user of the workspace (both steps). */
  public async login(email: string, userId: string): Promise<AuthStatus> {
    await this.json("POST", "/auth/login", { email, password: PASSWORD });
    return this.json<AuthStatus>("POST", "/auth/user-login", {
      userId,
      password: PASSWORD,
    });
  }
}

export const PASSWORD = "secret1";

/**
 * A workspace with two groups and four users, each logged in in their own browser:
 * admin; contributor in g1; viewer in g1; other (contributor) in g2.
 */
export async function setupWorkspace(db: Db) {
  const app = createTestApp({ db });
  const email = `${crypto.randomUUID()}@example.com`;
  const admin = new Browser(app);
  const signup = await admin.json<AuthStatus & { stage: "user" }>(
    "POST",
    "/auth/signup",
    { email, password: PASSWORD, name: "Admin", userPassword: PASSWORD },
  );
  const g1 = await admin.json<Group>(
    "POST",
    "/groups",
    { name: "Family" },
    201,
  );
  const g2 = await admin.json<Group>(
    "POST",
    "/groups",
    { name: "Father" },
    201,
  );
  const createUser = (name: string, role: string, groupIds: string[]) =>
    admin.json<PublicUser>(
      "POST",
      "/users",
      { name, role, password: PASSWORD, groupIds },
      201,
    );
  const users = {
    admin: signup.user,
    contributor: await createUser("Vera", "contributor", [g1.id]),
    viewer: await createUser("Kid", "viewer", [g1.id]),
    other: await createUser("Dad", "contributor", [g2.id]),
  };
  const browserFor = async (user: PublicUser) => {
    const browser = new Browser(app);
    await browser.login(email, user.id);
    return browser;
  };
  return {
    app,
    email,
    g1,
    g2,
    users,
    admin,
    contributor: await browserFor(users.contributor),
    viewer: await browserFor(users.viewer),
    other: await browserFor(users.other),
  };
}
