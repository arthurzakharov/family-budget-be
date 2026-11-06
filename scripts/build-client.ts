import { $, Glob } from "bun";
import { readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "dist-client");
const rootPkg = await Bun.file(join(root, "package.json")).json();
const version = (process.env.CLIENT_VERSION ?? rootPkg.version).replace(
  /^v/,
  "",
);

await rm(outDir, { recursive: true, force: true });

const build = await Bun.build({
  entrypoints: [join(root, "src/client.ts")],
  outdir: outDir,
  target: "browser",
  format: "esm",
  external: ["hono", "hono/*"],
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}

await $`bunx tsc -p ${join(root, "tsconfig.client.json")}`.cwd(root);

const aliasPattern = /(["'])@\/([^"']+)\1/g;
for await (const file of new Glob("**/*.d.ts").scan(outDir)) {
  const path = join(outDir, file);
  const source = await Bun.file(path).text();
  const rewritten = source.replace(aliasPattern, (_, quote, target) => {
    const rel = relative(dirname(path), join(outDir, target));
    return `${quote}${rel.startsWith(".") ? rel : `./${rel}`}.js${quote}`;
  });
  await Bun.write(path, rewritten);
}

// Route types never depend on the database handle, so its (drizzle) type is
// replaced with an opaque stub instead of making drizzle a client dependency.
await Bun.write(
  join(outDir, "db/client.d.ts"),
  "/** Server-only database handle; opaque to clients. */\nexport type Db = unknown;\n",
);

const importPattern = /(?:from\s+|import\()\s*["'](\.[^"']+)\.js["']/g;
const reachable = new Set<string>();
const queue = [join(outDir, "client.d.ts")];
while (queue.length > 0) {
  const path = queue.pop()!;
  if (reachable.has(path)) continue;
  reachable.add(path);
  const source = await Bun.file(path).text();
  for (const [, specifier] of source.matchAll(importPattern)) {
    queue.push(join(dirname(path), `${specifier}.d.ts`));
  }
}
for await (const file of new Glob("**/*.d.ts").scan(outDir)) {
  if (!reachable.has(join(outDir, file))) await rm(join(outDir, file));
}
for await (const dir of new Glob("**/").scan({
  cwd: outDir,
  onlyFiles: false,
})) {
  const path = join(outDir, dir);
  if ((await readdir(path)).length === 0) await rm(path, { recursive: true });
}

const clientPkg = {
  name: "@arthurzakharov/family-budget-be-client",
  version,
  description: "Typed API client for family-budget-be",
  type: "module",
  main: "./client.js",
  types: "./client.d.ts",
  exports: {
    ".": { types: "./client.d.ts", import: "./client.js" },
  },
  sideEffects: false,
  peerDependencies: { hono: rootPkg.dependencies.hono },
  repository: {
    type: "git",
    url: "git+https://github.com/arthurzakharov/family-budget-be.git",
  },
  publishConfig: { registry: "https://npm.pkg.github.com" },
};
await Bun.write(
  join(outDir, "package.json"),
  `${JSON.stringify(clientPkg, null, 2)}\n`,
);

console.log(`Built ${clientPkg.name}@${version} in ${relative(root, outDir)}/`);
