#!/usr/bin/env node
// Runs the production build (`node dist/server/index.js`) against an
// in-memory database and checks that it serves the app: the sign-in redirect,
// a server-rendered page that references the built client (not `/src`), and
// the built assets that page links. Run `pnpm build` first.

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Data, Effect } from "effect";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

class ProductionSmokeError extends Data.TaggedError("ProductionSmokeError") {}

const fail = (message, cause) => new ProductionSmokeError({ message, cause });

const check = (condition, message) => (condition ? Effect.void : Effect.fail(fail(message)));

const request = (origin, path) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`${origin}${path}`, { redirect: "manual" }),
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
    console.log(`Production server OK: ${origin} served /signin and ${linked.length} assets.`);
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
