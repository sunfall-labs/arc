import type { StartHydrationPayload } from "@sunfall/arc-start";
import { hydrationScriptId, streamHydrationAttribute } from "@sunfall/arc-start/testing";
import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

// Each test file gets its own in-memory database, migrated and seeded.
process.env.TRACKER_DB = ":memory:";
const { handleRequest } = await import("./server.js");

const origin = "https://tracker.test";

const request = (path: string, init: RequestInit = {}): Promise<Response> =>
  Effect.runPromise(Effect.scoped(handleRequest(new Request(`${origin}${path}`, init))));

/** A form posted without JavaScript to the page it is on. */
const formPost = (
  path: string,
  fields: Record<string, string | ReadonlyArray<string>>,
  cookie?: string,
) => {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of typeof value === "string" ? [value] : value) {
      body.append(name, item);
    }
  }
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body,
  });
};

const scripts = (html: string) =>
  Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g), (match) => ({
    attributes: match[1] ?? "",
    body: match[2] ?? "",
  }));

const rootPayload = (html: string): StartHydrationPayload =>
  JSON.parse(
    scripts(html).find((script) => script.attributes.includes(`id="${hydrationScriptId}"`))!.body,
  ) as StartHydrationPayload;

const hydratedResources = (html: string): ReadonlyArray<string> =>
  scripts(html)
    .filter((script) => script.attributes.includes(streamHydrationAttribute))
    .flatMap(
      (script) => (JSON.parse(script.body) as { payload: StartHydrationPayload }).payload.resources,
    )
    .map((resource) => resource.name);

let cookie = "";

beforeAll(async () => {
  // A no-JavaScript sign-in: a plain form post that answers with a redirect.
  const response = await formPost("/signin?next=%2Fprojects%2FTRK", {
    __sunfall_arc_action: "Tracker.signIn",
    __sunfall_arc_input: JSON.stringify({ redirectTo: "/projects/TRK" }),
    name: "Mara Chen",
    email: "mara@tracker.test",
  });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/projects/TRK");
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/HttpOnly/);
  cookie = setCookie.split(";")[0]!;
});

describe("tracker SSR", () => {
  it("redirects a request without a session to sign-in, keeping where it was going", async () => {
    const response = await request("/projects/TRK/issues?q=board");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/signin?next=%2Fprojects%2FTRK%2Fissues%3Fq%3Dboard",
    );
  });

  it("sends a signed-in visitor away from the sign-in page", async () => {
    const response = await request("/signin?next=/issues/TRK-1", { headers: { cookie } });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/issues/TRK-1");
  });

  it("server-renders the board with its data hydrated", async () => {
    const response = await request("/projects/TRK", { headers: { cookie } });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("<title>TRK board · Tracker</title>");
    expect(html).toContain('data-testid="board"');
    expect(html).toContain("Draft the onboarding checklist");
    expect(hydratedResources(html)).toEqual(
      expect.arrayContaining([
        "Tracker.currentUser",
        "Tracker.projects",
        "Tracker.team",
        "Tracker.board",
        "Tracker.labels",
      ]),
    );
  });

  it("server-renders a list URL's search, filters, and page", async () => {
    const html = await (
      await request("/projects/TRK/issues?q=polish&sort=title", { headers: { cookie } })
    ).text();
    expect(html).toContain("2 issues");
    expect(html).toContain("Polish focus rings (1)");
    expect(html).not.toContain("Draft the onboarding checklist");
    const second = await (
      await request("/projects/TRK/issues?page=2", { headers: { cookie } })
    ).text();
    expect(second).toContain("Page 2 of 2");
  });

  it("answers 404 for an issue that does not exist, inside the signed-in shell", async () => {
    const response = await request("/issues/TRK-9999", { headers: { cookie } });
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(html).toContain('data-testid="not-found"');
    expect(html).toContain("Mara Chen");
    expect(rootPayload(html).notFound).toBe(true);
    // What the preload loaded before its verdict hydrates the shell around the 404.
    expect(hydratedResources(html)).toEqual(
      expect.arrayContaining(["Tracker.currentUser", "Tracker.projects"]),
    );
  });

  it("answers 404 for an unknown project and an unknown URL", async () => {
    expect((await request("/projects/NOPE", { headers: { cookie } })).status).toBe(404);
    const unmatched = await request("/no/such/page", { headers: { cookie } });
    const html = await unmatched.text();
    expect(unmatched.status).toBe(404);
    // No preload ran; the shell's reads loaded during the render and hydrate too.
    expect(html).toContain("Mara Chen");
    expect(hydratedResources(html)).toEqual(
      expect.arrayContaining(["Tracker.currentUser", "Tracker.projects"]),
    );
  });

  it("creates an issue from a no-JavaScript form post", async () => {
    const response = await formPost(
      "/projects/WEB/new",
      {
        __sunfall_arc_action: "Tracker.createIssue",
        __sunfall_arc_input: JSON.stringify({ projectKey: "WEB" }),
        title: "Form post issue",
        description: "",
        status: "todo",
        priority: "low",
        assigneeId: "",
        labelIds: ["l_web-copy", "l_web-bug"],
      },
      cookie,
    );
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toMatch(/^\/issues\/WEB-\d+$/);
    const html = await (await request(location, { headers: { cookie } })).text();
    expect(html).toContain("Form post issue");
  });

  it("renders the form again with its errors and values when a no-JavaScript post fails validation", async () => {
    const response = await formPost(
      "/projects/WEB/new",
      {
        __sunfall_arc_action: "Tracker.createIssue",
        __sunfall_arc_input: JSON.stringify({ projectKey: "WEB" }),
        title: "x",
        description: "Kept *as typed*",
        status: "in_review",
        priority: "urgent",
        assigneeId: "",
        labelIds: "l_web-copy",
      },
      cookie,
    );
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    // The error next to the field, and every field as it was posted.
    expect(html).toContain("Give the issue a title.");
    expect(html).toMatch(/<input[^>]*name="title"[^>]*value="x"/);
    expect(html).toContain("Kept *as typed*");
    expect(html).toMatch(/<input[^>]*value="l_web-copy"[^>]*checked/);
    // The hydrating client starts from the same outcome.
    expect(rootPayload(html).postedAction).toMatchObject({
      action: "Tracker.createIssue",
      values: { title: "x" },
      outcome: { _tag: "ValidationFailure", fieldErrors: { title: ["Give the issue a title."] } },
    });
  });
});
