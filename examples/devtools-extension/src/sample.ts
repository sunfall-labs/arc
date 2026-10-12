import { Devtools } from "@sunfall/arc-devtools";

export const sampleDevtoolsPanels = (): Devtools.Panels =>
  Devtools.describePanels({
    spans: [
      {
        traceId: "extension-demo-trace",
        spanId: "extension-demo-request",
        name: "sunfall-arc.start.request",
        kind: "server",
        startTime: 0,
        durationMillis: 18,
        status: "success",
        attributes: {
          "sunfall-arc.request.id": "extension-demo-request",
          "sunfall-arc.request.transport": "ssr",
          "http.request.method": "GET",
          "url.path": "/projects/atlas",
          "http.route": "/projects/:id",
          "sunfall-arc.route.resources": ["Project.byId:atlas"],
          "sunfall-arc.route.href": "/projects/atlas?tab=activity",
          "http.response.status_code": 200,
          "sunfall-arc.request.status": "success",
          "sunfall-arc.teardown.reason": "response-end",
          "sunfall-arc.teardown.runtime_disposed": true,
          "sunfall-arc.teardown.fibers": 0,
        },
      },
      {
        traceId: "extension-demo-trace",
        spanId: "extension-demo-request-rpc",
        parentSpanId: "extension-demo-request",
        name: "sunfall-arc.start.rpc",
        kind: "server",
        startTime: 2,
        durationMillis: 6,
        status: "success",
        attributes: { "sunfall-arc.rpc.name": "Project.get" },
      },
    ],
  });
