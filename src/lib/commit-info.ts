import type { Env } from "@/config/env";
import type { CommitInfo } from "@/types/commit-info";

/**
 * Builds a `CommitInfo` object from raw commit fields, deriving the
 * 7-character short hash from the full hash.
 */
function toCommitInfo(
  hash: string,
  message: string,
  author: string,
  date: string,
): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    message,
    author,
    date,
  };
}

/**
 * Reads commit metadata from environment variables.
 * Returns `null` if any of the variables is missing or empty, so partial
 * commit info is never reported.
 */
export function commitInfoFromEnv(env: Env): CommitInfo | null {
  const {
    GIT_COMMIT_HASH,
    GIT_COMMIT_MESSAGE,
    GIT_COMMIT_AUTHOR,
    GIT_COMMIT_DATE,
  } = env;
  if (
    !GIT_COMMIT_HASH ||
    !GIT_COMMIT_MESSAGE ||
    !GIT_COMMIT_AUTHOR ||
    !GIT_COMMIT_DATE
  ) {
    return null;
  }
  return toCommitInfo(
    GIT_COMMIT_HASH,
    GIT_COMMIT_MESSAGE,
    GIT_COMMIT_AUTHOR,
    GIT_COMMIT_DATE,
  );
}

/**
 * Reads metadata of the latest commit by running `git log -1` in `cwd`
 * (defaults to the process working directory).
 * Returns `null` when git is unavailable, the directory is not a repository,
 * the repository has no commits, or any field is empty.
 */
export function commitInfoFromGit(cwd?: string): CommitInfo | null {
  const FIELD_SEPARATOR = "\x1f";

  try {
    const result = Bun.spawnSync(
      [
        "git",
        "log",
        "-1",
        `--format=%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%cI`,
      ],
      { ...(cwd && { cwd }), stdout: "pipe", stderr: "ignore" },
    );
    if (!result.success) return null;

    const [hash, message, author, date] = result.stdout
      .toString()
      .trim()
      .split(FIELD_SEPARATOR);
    if (!hash || !message || !author || !date) return null;
    return toCommitInfo(hash, message, author, date);
  } catch {
    return null;
  }
}

/**
 * Resolves commit metadata, preferring build-time environment variables
 * (used in Docker, where `.git` and the `git` binary are absent) and falling
 * back to the local git repository. Returns `null` if neither source yields
 * complete info.
 */
export function resolveCommitInfo(env: Env, cwd?: string): CommitInfo | null {
  return commitInfoFromEnv(env) ?? commitInfoFromGit(cwd);
}
