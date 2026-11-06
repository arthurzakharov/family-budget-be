import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitInfoFromEnv,
  commitInfoFromGit,
  resolveCommitInfo,
} from "@/lib/commit-info";
import { envFixture } from "@tests/helpers/fixtures";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const fullEnv = {
  ...envFixture,
  GIT_COMMIT_HASH: HASH,
  GIT_COMMIT_MESSAGE: "fix: something",
  GIT_COMMIT_AUTHOR: "Env Author",
  GIT_COMMIT_DATE: "2026-09-30T10:00:00Z",
};

const HOOK_GIT_VARS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !HOOK_GIT_VARS.includes(key)),
);

function git(cwd: string, ...args: string[]) {
  Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...cleanEnv,
      GIT_AUTHOR_NAME: "Git Author",
      GIT_AUTHOR_EMAIL: "git@example.com",
      GIT_COMMITTER_NAME: "Git Author",
      GIT_COMMITTER_EMAIL: "git@example.com",
      GIT_COMMITTER_DATE: "2026-09-29T08:30:00+00:00",
    },
  });
}

let repoDir: string;
let emptyDir: string;

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "commit-info-repo-"));
  emptyDir = mkdtempSync(join(tmpdir(), "commit-info-empty-"));
  git(repoDir, "init", "-q");
  git(repoDir, "commit", "-q", "--allow-empty", "-m", "chore: initial commit");
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
});

describe("commitInfoFromEnv", () => {
  test("builds commit info from GIT_COMMIT_* variables", () => {
    expect(commitInfoFromEnv(fullEnv)).toEqual({
      hash: HASH,
      shortHash: "abcdef0",
      message: "fix: something",
      author: "Env Author",
      date: "2026-09-30T10:00:00Z",
    });
  });

  test("returns null when any variable is missing", () => {
    expect(
      commitInfoFromEnv({ ...fullEnv, GIT_COMMIT_AUTHOR: undefined }),
    ).toBeNull();
    expect(commitInfoFromEnv(envFixture)).toBeNull();
  });
});

describe("commitInfoFromGit", () => {
  test("reads the last commit of a repository", () => {
    const info = commitInfoFromGit(repoDir);

    expect(info).toMatchObject({
      message: "chore: initial commit",
      author: "Git Author",
    });
    expect(Date.parse(info!.date)).toBe(Date.parse("2026-09-29T08:30:00Z"));
    expect(info?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(info?.shortHash).toBe(info!.hash.slice(0, 7));
  });

  test("returns null outside a git repository", () => {
    expect(commitInfoFromGit(emptyDir)).toBeNull();
  });

  test("returns null when git cannot be spawned", () => {
    expect(commitInfoFromGit(join(emptyDir, "missing-dir"))).toBeNull();
  });
});

describe("resolveCommitInfo", () => {
  test("prefers env variables over git", () => {
    expect(resolveCommitInfo(fullEnv, repoDir)?.author).toBe("Env Author");
  });

  test("falls back to git when env variables are missing", () => {
    expect(resolveCommitInfo(envFixture, repoDir)?.author).toBe("Git Author");
  });

  test("returns null without env variables and without git", () => {
    expect(resolveCommitInfo(envFixture, emptyDir)).toBeNull();
  });
});
