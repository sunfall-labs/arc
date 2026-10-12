#!/usr/bin/env node
// Runs the production build (`node dist/server/index.js`) against an
// in-memory database and checks that it serves the app: the sign-in redirect,
// a server-rendered page that references the built client (not `/src`), the
// built assets that page links, and no-JavaScript form posts: a sign-in or a
// new issue that fails validation renders its form again (422) with its error
// and values, and a valid one redirects. Run `pnpm build` first.

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Data, Effect } from "effect";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

class ProductionSmokeError extends Data.TaggedError("ProductionSmokeError") {}

const fail = (message, cause) => new ProductionSmokeError({ message, cause });

const check = (condition, message) => (condition ? Effect.void : Effect.fail(fail(message)));

const request = (origin, path, init = {}) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`${origin}${path}`, { redirect: "manual", ...init }),
      catch: (cause) => fail(`GET ${path} failed.`, cause),
    });
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => fail(`Reading GET ${path} failed.`, cause),
    });
    return { response, body };
  });

/** Starts the production server on a free port; resolves with its origin once it listens. */
const startServer = Effect.acquireRelease(
  Effect.callback((resume) => {
    const child = spawn(process.execPath, [resolve("dist/server/index.js")], {
      env: { ...process.env, TRACKER_DB: ":memory:", PORT: "0", HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const onData = (chunk) => {
      output += chunk;
      const listening = /Listening on (http:\/\/\S+)/.exec(output);
      if (listening) {
        child.stdout.off("data", onData);
        resume(Effect.succeed({ child, origin: listening[1] }));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("exit", (code) =>
      resume(
        Effect.fail(fail(`The production server exited (${code}) before listening:\n${output}`)),
      ),
    );
  }).pipe(Effect.timeout("20 seconds")),
  ({ child }) =>
    Effect.callback((resume) => {
      if (child.exitCode !== null) {
        resume(Effect.void);
        return;
      }
      child.once("exit", () => resume(Effect.void));
      child.kill("SIGTERM");
    }),
);

/** A form posted without JavaScript to the page it is on. */
const formPost = (origin, path, fields, cookie) => {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      body.append(name, item);
    }
  }
  return request(origin, path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body,
  });
};

const program = Effect.scoped(
  Effect.gen(function* () {
    const { origin } = yield* startServer;

    const home = yield* request(origin, "/");
    yield* check(
      home.response.status === 302 && home.response.headers.get("location") === "/signin",
      `GET / answered ${home.response.status}, expected a 302 to /signin.`,
    );

    const signIn = yield* request(origin, "/signin");
    yield* check(signIn.response.status === 200, `GET /signin answered ${signIn.response.status}.`);
    yield* check(!signIn.body.includes("/src/"), "The production page references /src modules.");
    const entry = /<script type="module" src="([^"]+)"><\/script>/.exec(signIn.body)?.[1];
    yield* check(entry?.startsWith("/assets/") === true, `The page's entry is ${entry}.`);
    const linked = [
      ...signIn.body.matchAll(/<link rel="(?:stylesheet|modulepreload)" href="([^"]+)"/g),
    ].map((match) => match[1]);
    yield* check(linked.includes(entry), "The page does not modulepreload its entry.");
    yield* check(
      linked.some((href) => /signin\.component-.*\.js$/.test(href)),
      "The page does not modulepreload the matched route's chunk.",
    );
    for (const href of linked) {
      const asset = yield* request(origin, href);
      yield* check(asset.response.status === 200, `GET ${href} answered ${asset.response.status}.`);
    }

    const missing = yield* request(origin, "/assets/missing.js");
    yield* check(missing.response.status !== 200, "A missing asset answered 200.");

    // No-JavaScript sign-in that fails validation: the form again, with its error and values.
    const signInFields = {
      __sunfall_arc_action: "Tracker.signIn",
      __sunfall_arc_input: JSON.stringify({ redirectTo: "/projects/TRK/new" }),
      name: "Mara Chen",
    };
    const badSignIn = yield* formPost(origin, "/signin", {
      ...signInFields,
      email: "not an email",
    });
    yield* check(
      badSignIn.response.status === 422 &&
        (badSignIn.response.headers.get("content-type") ?? "").includes("text/html") &&
        badSignIn.body.includes("Use a valid email address.") &&
        /<input[^>]*name="email"[^>]*value="not an email"/.test(badSignIn.body),
      `An invalid no-JS sign-in answered ${badSignIn.response.status} without its form, error, and values.`,
    );
    const goodSignIn = yield* formPost(origin, "/signin", {
      ...signInFields,
      email: "mara@tracker.test",
    });
    const cookie = goodSignIn.response.headers.get("set-cookie")?.split(";")[0];
    yield* check(
      goodSignIn.response.status === 303 &&
        goodSignIn.response.headers.get("location") === "/projects/TRK/new" &&
        cookie !== undefined,
      `A valid no-JS sign-in answered ${goodSignIn.response.status}, expected a 303 with a session.`,
    );

    // No-JavaScript new issue: an invalid title renders the form again; a valid one redirects.
    const issueFields = {
      __sunfall_arc_action: "Tracker.createIssue",
      __sunfall_arc_input: JSON.stringify({ projectKey: "TRK" }),
      description: "From the production smoke test",
      status: "todo",
      priority: "high",
      assigneeId: "",
      labelIds: ["l_trk-bug"],
    };
    const badIssue = yield* formPost(
      origin,
      "/projects/TRK/new",
      { ...issueFields, title: "x" },
      cookie,
    );
    yield* check(
      badIssue.response.status === 422 &&
        badIssue.body.includes("Give the issue a title.") &&
        /<input[^>]*name="title"[^>]*value="x"/.test(badIssue.body) &&
        badIssue.body.includes("From the production smoke test"),
      `An invalid no-JS issue answered ${badIssue.response.status} without its form, error, and values.`,
    );
    const goodIssue = yield* formPost(
      origin,
      "/projects/TRK/new",
      { ...issueFields, title: "Production smoke issue" },
      cookie,
    );
    yield* check(
      goodIssue.response.status === 303 &&
        /^\/issues\/TRK-\d+$/.test(goodIssue.response.headers.get("location") ?? ""),
      `A valid no-JS issue answered ${goodIssue.response.status}, expected a 303 to the issue.`,
    );

    console.log(
      `Production server OK: ${origin} served /signin, ${linked.length} assets, and no-JS form posts.`,
    );
  }),
);

runScriptMainEffect(
  program.pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        console.error(cause);
        process.exitCode = 1;
      }),
    ),
  ),
);
