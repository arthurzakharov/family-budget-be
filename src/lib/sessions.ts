import { and, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions, userGroups, users } from "@/db/schema";
import type { PublicUser, Role } from "@/types/responses";

/** How long a login lasts. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type Session = {
  token: string;
  workspaceId: string;
  /** `null` until a user is picked in the second login step. */
  userId: string | null;
};

/** The logged-in user, with what access checks need. */
export type CurrentUser = PublicUser & {
  workspaceId: string;
  passwordHash: string;
};

/** Starts a login; expired sessions are dropped whenever a new one is created. */
export async function createSession(
  db: Db,
  { workspaceId, userId }: Omit<Session, "token">,
): Promise<Session> {
  const now = new Date();
  const session = { token: crypto.randomUUID(), workspaceId, userId };
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.insert(sessions).values({
    ...session,
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
  });
  return session;
}

/** The session with this token, unless it has expired. */
export async function findSession(
  db: Db,
  token: string | undefined,
): Promise<Session | null> {
  if (!token) return null;
  const [session] = await db
    .select({
      token: sessions.token,
      workspaceId: sessions.workspaceId,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.token, token));
  if (!session || session.expiresAt <= new Date()) return null;
  return {
    token: session.token,
    workspaceId: session.workspaceId,
    userId: session.userId,
  };
}

/** Picks (or, with `null`, un-picks) the session's user. */
export async function setSessionUser(
  db: Db,
  token: string,
  userId: string | null,
): Promise<void> {
  await db.update(sessions).set({ userId }).where(eq(sessions.token, token));
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

/** Users of a workspace with their groups, in the order they were created. */
export async function listWorkspaceUsers(
  db: Db,
  workspaceId: string,
): Promise<CurrentUser[]> {
  const rows = await db
    .select({
      id: users.id,
      workspaceId: users.workspaceId,
      name: users.name,
      role: users.role,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.workspaceId, workspaceId))
    .orderBy(users.createdAt, users.id);
  if (rows.length === 0) return [];
  const memberships = await db
    .select()
    .from(userGroups)
    .where(
      inArray(
        userGroups.userId,
        rows.map((u) => u.id),
      ),
    );
  return rows.map((u) => ({
    ...u,
    groupIds: memberships
      .filter((m) => m.userId === u.id)
      .map((m) => m.groupId),
  }));
}

/** A user of the workspace, or `undefined`. */
export async function findWorkspaceUser(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<CurrentUser | undefined> {
  const all = await listWorkspaceUsers(db, workspaceId);
  return all.find((u) => u.id === userId);
}

/** Deletes a user of the workspace; their sessions go back to "pick a user". */
export async function deleteWorkspaceUser(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(users)
    .where(and(eq(users.id, userId), eq(users.workspaceId, workspaceId)));
}

export function toPublicUser({
  id,
  name,
  role,
  groupIds,
}: PublicUser): PublicUser {
  return { id, name, role, groupIds };
}

/** Viewers can only look; admins and contributors can add and change records. */
export function canEdit(role: Role): boolean {
  return role !== "viewer";
}
