/**
 * Tags the current commit as `v<version>` and pushes the tag, which triggers
 * the `Publish client` workflow.
 *
 * Usage: bun run client:publish 0.4.0
 */
import { $ } from "bun";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const input = process.argv[2];
const latest = (await $`git tag --list "v*.*.*" --sort=-v:refname`.text())
  .split("\n")
  .find(Boolean);

if (!input) {
  fail(
    `missing version, e.g. \`bun run client:publish 1.2.3\` (latest tag: ${latest ?? "none"})`,
  );
}
if (!/^v?\d+\.\d+\.\d+$/.test(input)) {
  fail(`"${input}" is not a version like 1.2.3`);
}

const tag = input.startsWith("v") ? input : `v${input}`;

if (latest && compareVersions(tag, latest) <= 0) {
  fail(`${tag} must be greater than the latest tag ${latest}`);
}

if ((await $`git status --porcelain`.text()).trim()) {
  fail("working tree has uncommitted changes");
}

const branch = (await $`git branch --show-current`.text()).trim();
if (branch !== "main") {
  fail(`tags are published from main, not "${branch || "detached HEAD"}"`);
}

await $`git fetch --quiet origin main --tags`;
const [head, remote] = await Promise.all([
  $`git rev-parse HEAD`.text(),
  $`git rev-parse origin/main`.text(),
]);
if (head.trim() !== remote.trim()) {
  fail("main is not in sync with origin/main; push or pull first");
}

if ((await $`git tag --list ${tag}`.text()).trim()) {
  fail(`tag ${tag} already exists`);
}

await $`git tag ${tag}`;
await $`git push origin ${tag}`;
console.log(`Published ${tag}; the Publish client workflow is starting.`);

/** Compares `vX.Y.Z` tags numerically. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => v.slice(1).split(".").map(Number);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
