# family-budget-be

Backend for the family budget app: an API for tracking a household's income, expenses and budgets. Built with [Bun](https://bun.sh) + [Hono](https://hono.dev).

## Scripts

| Command                            | Description                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `bun install`                      | Install dependencies                                                                                      |
| `bun run db:up`                    | Start the local Postgres (Docker Compose) and wait until it is ready                                      |
| `bun run db:down`                  | Stop the local Postgres (data is kept in the `db-data` volume)                                            |
| `bun run db:reset`                 | Delete the local Postgres and its data, then start an empty one (migrations run on the next server start) |
| `bun run db:generate`              | Generate a SQL migration in `drizzle/` from changes to `src/db/schema.ts`                                 |
| `bun run dev`                      | Start with watch mode and pretty logs                                                                     |
| `bun run start`                    | Start the server                                                                                          |
| `bun run build`                    | Bundle the server into `dist-server/server.js` (what the Docker image runs)                               |
| `bun test`                         | Run tests with coverage (fails below 100% lines/functions)                                                |
| `bun run typecheck`                | Type-check with `tsc`                                                                                     |
| `bun run lint`                     | Lint with oxlint (type-aware, see `.oxlintrc.json`)                                                       |
| `bun run format`                   | Format all files with Prettier                                                                            |
| `bun run format:check`             | Verify formatting (for CI)                                                                                |
| `bun run check`                    | Format check + lint + typecheck + tests — run before pushing                                              |
| `bun run docker:build`             | Build the Docker image with the current commit info baked in                                              |
| `bun run client:build`             | Build the frontend client package into `dist-client/`                                                     |
| `bun run client:verify`            | Build + type-check the client as a frontend would                                                         |
| `bun run client:publish <version>` | Tag the current commit as `v<version>` and push it, which publishes the client package                    |

## Git hooks

`bun install` points git at `.githooks/` (via the `prepare` script), so the checks CI runs also run locally:

| Hook         | Runs                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| `pre-commit` | Formats the staged files with Prettier (and re-stages them), then `bun run lint` |
| `pre-push`   | `bun run check` and `bun run client:verify` — the same steps as CI               |

`pre-commit` refuses files that have both staged and unstaged changes, because re-staging the formatted file would also stage the rest. Skip a hook in an emergency with `--no-verify`.

## Configuration

All configuration comes from env vars. Server settings are validated on startup in `src/config/env.ts`.

| Variable             | Default                   | Set by                    | Description                                                                                                     |
| -------------------- | ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`           | `development`             | Dockerfile (`production`) | `production` makes `ALLOWED_ORIGINS` and `DATABASE_URL` required                                                |
| `PORT`               | `3000`                    | Dockerfile (`3000`)       | Port the server listens on                                                                                      |
| `LOG_LEVEL`          | `info`                    | Dockerfile (`info`)       | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                  |
| `LOG_FORMAT`         | `json`                    | `bun run dev` (`pretty`)  | `json` or `pretty`; `pretty` needs the dev dependency `pino-pretty`, so it is not available in the Docker image |
| `GIT_COMMIT_HASH`    | none                      | Docker build arg (CI)     | Full commit hash                                                                                                |
| `GIT_COMMIT_MESSAGE` | none                      | Docker build arg (CI)     | Commit subject                                                                                                  |
| `GIT_COMMIT_AUTHOR`  | none                      | Docker build arg (CI)     | Commit author name                                                                                              |
| `GIT_COMMIT_DATE`    | none                      | Docker build arg (CI)     | Commit date (ISO 8601)                                                                                          |
| `ALLOWED_ORIGINS`    | `[]` (no origins allowed) | Deployment                | Comma-separated frontend origins allowed to call the API (CORS)                                                 |
| `DATABASE_URL`       | local Docker Postgres     | Deployment                | Postgres connection URL (`postgres://user:password@host:5432/db`)                                               |
| `COINGECKO_API_KEY`  | none (public API)         | Deployment (optional)     | CoinGecko Demo API key for crypto prices; without it the keyless public API is used, with lower rate limits     |

- **Dockerfile:** sets `NODE_ENV`, `PORT` and `LOG_LEVEL` in the image. A deployment env var with the same name overrides them.
- **Docker build args:** CI passes the four `GIT_COMMIT_*` values when it builds the image (`bun run docker:build` does the same locally). They are baked into the image.
- **Deployment:** must set `ALLOWED_ORIGINS` and `DATABASE_URL`, otherwise the server refuses to start in production (and browsers would block every frontend request).
- **Local development:** run `bun run db:up` once per session; all other defaults work and commit info is read from the local git repository. To call the API from a local frontend, create a `.env` (git-ignored, loaded by Bun automatically) with e.g. `ALLOWED_ORIGINS=http://localhost:5173`.

## Database

Postgres, accessed with [Drizzle ORM](https://orm.drizzle.team) through Bun's built-in Postgres client.

- **Tables** are defined in `src/db/schema.ts`. Every record belongs to a `workspaces` row (one household, logged into by email): `users` (role `admin`/`contributor`/`viewer`), `groups` and `user_groups` (who money belongs to), `sessions`, `deposit_transactions`, `deposit_rates`, `crypto_transactions`, `expense_categories` (custom ones; the built-in ones live in `src/lib/categories.ts`) and `expense_entries`. Money amounts are positive integers in euro cents (12.34 € = `1234`), never floats; crypto amounts and coin prices are `numeric`, since they need fractions of a coin and of a cent.
- **Migrations** are plain SQL files in `drizzle/`, generated from the schema and committed. To change the database: edit `src/db/schema.ts`, run `bun run db:generate`, review the new `.sql` file, commit both.
- **Starting over:** the app is still in a test phase and every database (local and deployed) can be thrown away. Instead of piling up migrations, you may delete `drizzle/`, run `bun run db:generate` to get one fresh `0000` migration, and recreate the databases: `bun run db:reset` locally, a new Render Postgres when deployed. A database that ran the old migrations fails to start with the new ones, so it must be recreated.
- **Applying migrations:** the server runs pending migrations on startup, before it accepts requests (`src/db/client.ts`). Applied ones are recorded in the `drizzle.__drizzle_migrations` table, so each runs once.
- **Tests** run the same migrations on an in-memory Postgres ([PGlite](https://pglite.dev), `tests/helpers/db.ts`), so they need neither Docker nor a database in CI.
- **Browsing data locally:** connect any SQL client (e.g. the IDE's Database panel) to `localhost:5432`, database, user and password `family_budget`.

## Endpoints

- `GET /health` — `{ status: "ok", commit: { shortHash, date } | null }`. The full hash, message and author are only written to the startup log, not exposed publicly.
- Budget endpoints (below). Request and response types are part of the typed client; money is in euro cents (`amountCents`, and every amount of `/deposit/interest`).

| Route                                                   | Who               | What                                                                                   |
| ------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `GET /auth/status`                                      | anyone            | `AuthStatus`: `none`, `workspace` (pick a user) or `user`                              |
| `POST /auth/signup`                                     | anyone            | New workspace and its admin, logged in                                                 |
| `POST /auth/login`, `POST /auth/user-login`             | anyone            | Log in in two steps: unlock the workspace, then pick a user                            |
| `POST /auth/switch-user`, `POST /auth/logout`           | anyone            | Back to picking a user / end the session                                               |
| `POST /auth/password`                                   | user              | Change own password                                                                    |
| `GET /auth/workspace`                                   | user              | The workspace's login email                                                            |
| `PUT /auth/workspace/email`, `POST …/password`          | admin             | Change the workspace's login email / password (needs the current workspace password)   |
| `GET /members`, `GET /groups`                           | user              | Names and roles of the workspace's users; its groups                                   |
| `GET/POST /users`, `PUT/DELETE /users/:id`              | admin             | Users, their roles and groups                                                          |
| `PUT /users/:id/password`                               | admin             | Set a user's password                                                                  |
| `POST /groups`, `POST/DELETE /groups/:id/members[/:id]` | admin             | Groups and membership                                                                  |
| `GET/POST /deposit/transactions`, `PUT/DELETE …/:id`    | user / non-viewer | Deposits and withdrawals of the user's groups                                          |
| `GET/POST /deposit/rates`, `PUT /deposit/rates/:id`     | user / non-viewer | Yearly interest rate periods (never overlapping)                                       |
| `GET /deposit/interest`                                 | user              | Balance, monthly payouts after tax, pending interest; non-admins get their groups only |
| `GET /crypto/coins`, `PUT /crypto/coins`                | user / admin      | Coins the workspace trades                                                             |
| `GET/POST /crypto/transactions`, `PUT/DELETE …/:id`     | user / non-viewer | Buys and sells of the user's groups                                                    |
| `GET/POST /expenses/categories`, `PUT …/:id`            | user / admin      | Built-in and custom categories; the admin creates, hides and shows them                |
| `GET/POST /expenses/entries`, `PUT/DELETE …/:id`        | user / non-viewer | Expenses and income of the user's groups                                               |

Records of groups a user does not belong to never leave the server (the admin sees all groups). Admins never add records under their own name: on create and update they send `userId`, a non-admin user of the workspace.

- **Sessions** live in an HttpOnly `session` cookie. The frontend calls the API with `credentials: "include"` (`createFamilyBudgetClient(url, { init: { credentials: "include" } })`); CORS allows credentials for `ALLOWED_ORIGINS`. In production the cookie is `Secure; SameSite=None`, so the frontend may be on another site, over HTTPS; locally it is `SameSite=Lax`, which works for a frontend on another `localhost` port. Hono's `csrf()` rejects form-type requests (including body-less `POST`s) whose `Origin` is not allowed.
- Errors — `{ error, code?, requestId, issues? }` (`ErrorResponse` in the client). `code` is a translation key for the frontend (e.g. `errors.groupNotFound`); for validation errors it is the first issue's message. `requestId` matches the `X-Request-Id` response header and the server logs, so a frontend can show it for support requests:

  | Status | When                                                                                                                        |
  | ------ | --------------------------------------------------------------------------------------------------------------------------- |
  | `400`  | Request failed validation (`issues` lists `{ path, message }` per field, e.g. `json.name`), or a rule like `errors.overlap` |
  | `401`  | Not logged in (`errors.unauthorized`) or wrong credentials (`errors.invalidCredentials`)                                    |
  | `403`  | Logged in, but the role may not do this (`errors.forbidden`), or a cross-site form request                                  |
  | `404`  | Unknown route, or a record that does not exist or is not visible to the user                                                |
  | `409`  | The email already has a workspace (`errors.emailTaken`)                                                                     |
  | `4xx`  | An external API answered with a status the route passes through (e.g. `404`), see "Errors" below                            |
  | `502`  | An external API returned an error, an unexpected body, or could not be reached                                              |
  | `504`  | An external API did not answer within the `HttpClient` timeout                                                              |
  | `500`  | Any other unhandled error                                                                                                   |

Every response also carries standard security headers (`X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, …) from Hono's `secureHeaders()`.

Commit info is resolved once at startup, in this order:

1. all four `GIT_COMMIT_*` env vars (baked into the image by CI)
2. the local git repository (development)

If none of these succeed, `commit` is `null` and a warning is logged at startup.

## Trying requests locally

`requests/*.http` contains ready-made requests for the endpoints. They use the variables `{{host}}` and `{{origin}}`, defined per environment:

| Environment | `host`                                                | `origin`                |
| ----------- | ----------------------------------------------------- | ----------------------- |
| `local`     | `http://localhost:3000` (start it with `bun run dev`) | `http://localhost:5173` |
| `deployed`  | `https://family-budget-be.onrender.com`               | `http://localhost:5173` |

**WebStorm** has the HTTP Client built in, no plugin needed. It reads the environments from `requests/http-client.env.json`.

1. Open a `.http` file.
2. Pick the environment in the **Run with** selector at the top of the editor (`local` or `deployed`).
3. Click the ▶ gutter icon next to a request.

**VSCode** needs the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension (`humao.rest-client`). It does not read `http-client.env.json`; it reads the environments from `rest-client.environmentVariables` in `.vscode/settings.json`. `.vscode/` is git-ignored, so add them to your own settings once, copying the values from `requests/http-client.env.json`:

```json
"rest-client.environmentVariables": {
  "local": { "host": "http://localhost:3000", "origin": "http://localhost:5173" },
  "deployed": { "host": "https://family-budget-be.onrender.com", "origin": "http://localhost:5173" }
}
```

1. Open a `.http` file.
2. Select the environment: click the environment name in the status bar (bottom right, `No Environment` at first), or run **Rest Client: Switch Environment** from the command palette (`Ctrl+Alt+E` / `Cmd+Alt+E`), and pick `local` or `deployed`. Without an environment, `{{host}}` is not resolved and the request fails.
3. Click **Send Request** above a request.

`requests/http-client.env.json` is the source of truth: when an environment changes there, update your VSCode settings too.

## Docker

```sh
bun run docker:build   # build image `family-budget-be-image` with current commit info
bun run docker:run     # start container `family-budget-be-container` on port 3000 (replaces a running one)
bun run docker:logs    # follow logs
bun run docker:stop    # stop (container is removed automatically)
```

The image contains only the bundled `server.js` and its source map (no `src/` or `node_modules`), so stack traces still point at the `.ts` files. The bundle is not minified on purpose: minifying renames classes, which would break the error names in logs. The image runs with `NODE_ENV=production`, so `docker:run` passes the required deployment variables itself: `ALLOWED_ORIGINS=http://localhost:5173`, for a frontend dev server on the default Vite port, and a `DATABASE_URL` pointing at the local Postgres from `bun run db:up` (via `host.docker.internal`).

## Deployment

The `image` job in `.github/workflows/ci.yml` runs on every push to `main`, and when CI is started manually on `main` (Actions → CI → Run workflow), after all checks pass:

1. builds the Docker image with the four `GIT_COMMIT_*` build args;
2. pushes it to `ghcr.io/arthurzakharov/family-budget-be-container`, tagged with the commit hash and `latest`;
3. calls the `DEPLOY_HOOK_URL` repository secret with `imgURL` set to that exact image, so the platform deploys the image CI built and tested.

The platform only pulls the image and sets the runtime env vars (`ALLOWED_ORIGINS`, `DATABASE_URL`); it does not build anything. Without the `DEPLOY_HOOK_URL` secret, the job still pushes the image and skips the deploy.

## Typed client for frontends

Published to GitHub Packages as `@arthurzakharov/family-budget-be-client` (types + a tiny `hono/client` wrapper, no server code).

### Using it in a frontend

1. Create a GitHub **classic** personal access token with the `read:packages` scope.
2. Add `.npmrc` to the frontend repo (commit it — the token comes from an env var):

   ```ini
   @arthurzakharov:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```

3. Install (with `GITHUB_TOKEN` exported in your shell / CI):

   ```sh
   bun add @arthurzakharov/family-budget-be-client hono
   ```

4. Use it:

   ```ts
   import { createFamilyBudgetClient } from "@arthurzakharov/family-budget-be-client";

   const api = createFamilyBudgetClient(
     import.meta.env.VITE_FAMILLY_BUDGET_BE_URL,
   );
   const res = await api.health.$get();
   const body = await res.json(); // { status: "ok"; commit: PublicCommitInfo | null }
   ```

The frontend origin must be listed in family-budget-be's `ALLOWED_ORIGINS` env var (comma-separated), otherwise browsers block the requests (CORS).

### Publishing a new version

```sh
bun run client:publish 0.4.0
```

This tags the current commit as `v0.4.0` and pushes the tag. It refuses to run unless you are on `main`, in sync with `origin/main`, with a clean working tree, and the version is greater than the latest tag.
The `Publish client` workflow then runs all checks, builds `dist-client/` and publishes `@arthurzakharov/family-budget-be-client@0.4.0`.
Use `bun run client:verify` locally to build the package and type-check it the way a frontend would.

## Code style

Rules marked **(enforced)** fail `bun run check`, and therefore CI.

**Formatting and imports**

- Prettier formats everything: double quotes, semicolons, trailing commas, 80 columns **(enforced)**.
- Import from `src` with `@/…` and from `tests` with `@tests/…`; use `import type` for type-only imports **(enforced)**.
- Import concrete files, not folders: there are no `index.ts` barrel files, because the client build cannot resolve them.

**Types**

- Use `type`, not `interface` **(enforced)**.
- Exported functions and public methods declare their return type **(enforced)**. Exception: `src/app.ts`, `src/routes/**`, `src/client.ts` and `src/middleware/validate.ts`, where Hono infers the route types that become `AppType` and the client types.
- Name the object argument of a function `<FunctionName>Params` (e.g. `CreateAppParams`) and of a class constructor `<ClassName>Constructor` (e.g. `HttpClientConstructor`).
- Destructure object arguments in the signature. Pass the object on unchanged only when the function just forwards it.
- An optional property that callers may set to `undefined` is typed `name?: T | undefined` (`exactOptionalPropertyTypes` is on).
- Only export what another file uses.

**Structure**

- Folders: `api/` for requests to external services, `lib/` for app logic, `contexts/` for async contexts (e.g. `contexts/request.ts`), `routes/` and `middleware/` for Hono, `config/` for env parsing, `errors.ts` for the error classes, `types/` for types shared with the frontend client (they import only from `types/` or `hono`, so the client package ships no server code). File names are kebab-case.
- Pass dependencies as arguments (no singletons). Request-scoped data (log, request id, client abort signal) comes from the getters in `src/contexts/request.ts`; they throw outside a request. Code that runs outside a request (startup, shutdown) gets the root logger as an argument.
- Use a class only when there is shared state (e.g. `HttpClient`); mark public members `public` explicitly and make private members `#` fields, never `private` **(enforced)**. Stateless logic stays in plain functions.
- Await or return every promise **(enforced)**.
- Keep names in the code platform-neutral (no GitHub/GitLab/Render names); platform specifics belong in CI and deployment config.
- Tests mirror `src/` under `tests/`; coverage must stay at 100% **(enforced)**.

## Adding an endpoint

1. **External API call** (if the endpoint needs one): add a method to the API's class in `src/api/` (e.g. `ExchangeRatesApi`), built on `HttpClient`. Describe the external response with a zod schema there and return your own type, so the external shape never leaks into routes.
2. **Response type**: add it to `src/types/responses.ts` (import-free), so frontends get it from the client package.
3. **Route**: create `src/routes/<name>.ts` exporting a function that receives its dependencies (API class, `db`) and returns a chained `new Hono<AppEnv>()` router. Put `requireUser(db, { admin?, edit? })` before the handler of a route that needs a logged-in user; it sets `c.var.user`. Give every schema field a translation key as its message (see `src/lib/schemas.ts`), and throw `ApiError(status, "errors.…")` for expected failures. Log with `getRequestLog()` from `@/contexts/request` (or `c.var.log` in a handler); it is bound to the request id. `HttpClient` reads the request context itself, so outgoing calls are logged under the same request id, the external service receives it as `X-Request-Id`, and the call is cancelled if the client disconnects. Validate input with `validate("json" | "query" | "param", schema)` and read it with `c.req.valid(...)`.
4. **Mount** it in `src/app.ts` via `.route(...)` (keep it chained so `AppType` stays typed), passing the dependencies from `createApp`'s params; `server.ts` creates the real instances.
5. **Errors**: let them propagate. Validation errors become `400`, `HttpClient` failures `502`/`504`, everything else `500` — see `src/middleware/error-handler.ts`. To pass an upstream client error on to the caller, list it per call: `http.get(path, schema, { passthrough: [404] })`. The caller then gets that status with a generic message (e.g. `Not Found`), never the upstream body. Only list statuses that mean the same thing for your endpoint (an upstream `404` on a side lookup is still your `502`). An `HttpError`'s `body` and `headers` are readable in code but are never written to logs, because they may contain personal or financial data.
6. **Tests** under `tests/routes/`: pass a fake API class or an `HttpClient` with a fake `fetch` — no network. For routes that use the database, `createTestDb()` and `setupWorkspace()` (`tests/helpers/`) give an in-memory Postgres and a workspace with logged-in users of every role. Call `HttpClient` through the app or inside `runWithRequestContext(...)`, since it needs a request context. Coverage is enforced at 100%.

```ts
export function createExchangeRateRoutes(rates: ExchangeRatesApi) {
  return new Hono().get(
    "/exchange-rates/:currency",
    validate("param", z.object({ currency: z.string().length(3) })),
    async (c) =>
      c.json<ExchangeRateResponse>(
        await rates.getRate(c.req.valid("param").currency),
      ),
  );
}
```

The new route is automatically part of the client types; publish a new tag so frontends get it.
