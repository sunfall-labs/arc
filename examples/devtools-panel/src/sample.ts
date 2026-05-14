import { describeDevtoolsPanels, type DevtoolsPanels } from "@effect-ui/devtools";

export const sampleDevtoolsPanels = (): DevtoolsPanels =>
  describeDevtoolsPanels({
    requestTraces: [
      {
        request: {
          id: "demo-request",
          method: "GET",
          url: "https://example.test/projects/atlas?tab=activity",
          path: "/projects/atlas",
          transport: "ssr"
        },
        response: {
          status: 200,
          statusText: "OK"
        },
        services: ["ProjectApi"],
        resources: [
          {
            key: "Project.byId:atlas",
            family: "Project.byId",
            input: { id: "atlas" },
            state: "Success"
          }
        ],
        collections: [
          {
            name: "ProjectSummaries",
            state: "loaded",
            eventCount: 2
          }
        ],
        serverFunctions: [
          {
            name: "Project.get",
            status: "success"
          }
        ],
        actions: [
          {
            name: "Project.rename",
            state: "Idle"
          }
        ],
        fibers: [
          {
            name: "request-runtime",
            status: "done"
          }
        ],
        streams: [
          {
            name: "html",
            state: "closed",
            chunkCount: 2
          }
        ],
        status: "success",
        teardown: {
          runtimeDisposed: true,
          reason: "response-end",
          durationMillis: 18,
          beforeDispose: {
            fiberCount: 1,
            familyCount: 1,
            moduleCount: 1,
            tagCount: 0
          },
          afterDispose: {
            fiberCount: 0,
            familyCount: 0,
            moduleCount: 0,
            tagCount: 0
          }
        }
      }
    ]
  });
