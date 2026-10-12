import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Action, Server } from "../src/index.js";
import {
  makeCoreDefinitionRegistry,
  makeCoreDefinitionRegistryAdapter,
  snapshotCoreDefinitionRegistry,
  actionDefinitionRegistry,
  getActionDefinition,
  coreDefinitionRegistryDiagnostics,
  clearActionDefinitionRegistryUnsafe,
} from "../src/internal.js";

let registryTestId = 0;

const registryName = (name: string): string =>
  `Core.definition-registry.${++registryTestId}.${name}`;

describe("Core definition registry", () => {
  it("preserves the global Action and Server registry facades", () => {
    const Ping = Action.define({
      name: registryName("global-action"),
      run: () => Effect.succeed("pong"),
    });
    const ping = Server.fn(registryName("global-server"), {
      handler: () => Effect.succeed("pong"),
    });

    expect(actionDefinitionRegistry().get(Ping.name)).toBe(Ping);
    expect(getActionDefinition(Ping.name)).toBe(Ping);
    expect(Server.functions().get(ping.name)).toBe(ping);
    expect(Server.get(ping.name)).toBe(ping);
  });

  it("captures app registry snapshots without later global definitions", () => {
    const BeforeAction = Action.define({
      name: registryName("snapshot-before-action"),
      run: () => Effect.succeed("before"),
    });
    const beforeServer = Server.fn(registryName("snapshot-before-server"), {
      handler: () => Effect.succeed("before"),
    });

    const app = { registry: snapshotCoreDefinitionRegistry() };

    const AfterAction = Action.define({
      name: registryName("snapshot-after-action"),
      run: () => Effect.succeed("after"),
    });
    const afterServer = Server.fn(registryName("snapshot-after-server"), {
      handler: () => Effect.succeed("after"),
    });

    expect(app.registry.actions.get(BeforeAction.name)).toBe(BeforeAction);
    expect(app.registry.serverFunctions.get(beforeServer.name)).toBe(beforeServer);
    expect(app.registry.actions.has(AfterAction.name)).toBe(false);
    expect(app.registry.serverFunctions.has(afterServer.name)).toBe(false);
    expect(actionDefinitionRegistry().get(AfterAction.name)).toBe(AfterAction);
    expect(Server.functions().get(afterServer.name)).toBe(afterServer);
  });

  it("accepts an explicit app registry instead of inheriting globals", () => {
    const GlobalAction = Action.define({
      name: registryName("explicit-global-action"),
      run: () => Effect.succeed("global"),
    });
    const LocalAction = Action.define({
      name: registryName("explicit-local-action"),
      run: () => Effect.succeed("local"),
    });
    const globalServer = Server.fn(registryName("explicit-global-server"), {
      handler: () => Effect.succeed("global"),
    });
    const localServer = Server.fn(registryName("explicit-local-server"), {
      handler: () => Effect.succeed("local"),
    });

    const app = {
      registry: makeCoreDefinitionRegistry({
        actions: [LocalAction],
        serverFunctions: [localServer],
      }),
    };

    expect(app.registry.actions.get(LocalAction.name)).toBe(LocalAction);
    expect(app.registry.serverFunctions.get(localServer.name)).toBe(localServer);
    expect(app.registry.actions.has(GlobalAction.name)).toBe(false);
    expect(app.registry.serverFunctions.has(globalServer.name)).toBe(false);
    expect(actionDefinitionRegistry().get(GlobalAction.name)).toBe(GlobalAction);
    expect(Server.functions().get(globalServer.name)).toBe(globalServer);
  });

  it("normalizes explicit registry Map inputs by definition name", () => {
    const LocalAction = Action.define({
      name: registryName("map-local-action"),
      run: () => Effect.succeed("local"),
    });
    const localServer = Server.fn(registryName("map-local-server"), {
      handler: () => Effect.succeed("local"),
    });

    const app = {
      registry: makeCoreDefinitionRegistry({
        actions: new Map([["wrong-action-key", LocalAction]]),
        serverFunctions: new Map([["wrong-server-key", localServer]]),
      }),
    };

    expect(app.registry.actions.get(LocalAction.name)).toBe(LocalAction);
    expect(app.registry.actions.has("wrong-action-key")).toBe(false);
    expect(app.registry.serverFunctions.get(localServer.name)).toBe(localServer);
    expect(app.registry.serverFunctions.has("wrong-server-key")).toBe(false);
  });

  it("replaces duplicate global definitions and records diagnostics", () => {
    const actionName = registryName("duplicate-action");
    const FirstAction = Action.define({
      name: actionName,
      run: () => Effect.succeed("first"),
    });
    const SecondAction = Action.define({
      name: actionName,
      run: () => Effect.succeed("second"),
    });
    const serverName = registryName("duplicate-server");
    const firstServer = Server.fn(serverName, {
      handler: () => Effect.succeed("first"),
    });
    const secondServer = Server.fn(serverName, {
      handler: () => Effect.succeed("second"),
    });

    expect(getActionDefinition(actionName)).not.toBe(FirstAction);
    expect(getActionDefinition(actionName)).toBe(SecondAction);
    expect(Server.get(serverName)).not.toBe(firstServer);
    expect(Server.get(serverName)).toBe(secondServer);
    expect(coreDefinitionRegistryDiagnostics().duplicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "action",
          name: actionName,
          policy: "replace",
        }),
        expect.objectContaining({
          kind: "serverFunction",
          name: serverName,
          policy: "replace",
        }),
      ]),
    );
  });

  it("clears duplicate diagnostics with unsafe registry resets", () => {
    const actionName = registryName("reset-duplicate-action");
    Action.define({
      name: actionName,
      run: () => Effect.succeed("first"),
    });
    Action.define({
      name: actionName,
      run: () => Effect.succeed("second"),
    });
    expect(coreDefinitionRegistryDiagnostics().duplicates).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "action", name: actionName })]),
    );

    clearActionDefinitionRegistryUnsafe();

    expect(coreDefinitionRegistryDiagnostics().duplicates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "action", name: actionName })]),
    );

    const serverName = registryName("reset-duplicate-server");
    Server.fn(serverName, {
      handler: () => Effect.succeed("first"),
    });
    Server.fn(serverName, {
      handler: () => Effect.succeed("second"),
    });
    expect(Server.registryDiagnostics().duplicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "serverFunction", name: serverName }),
      ]),
    );

    Server.clearRegistryUnsafe();

    expect(Server.registryDiagnostics().duplicates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "serverFunction", name: serverName }),
      ]),
    );
  });

  it("can create an isolated replacing registry adapter", () => {
    const registry = makeCoreDefinitionRegistryAdapter<
      { readonly name: string; readonly version: number },
      { readonly name: string; readonly version: number }
    >({ duplicates: "replace" });
    const first = { name: registryName("isolated-action"), version: 1 };
    const second = { name: first.name, version: 2 };

    registry.registerAction(first);
    const registration = registry.registerAction(second);

    expect(registration).toMatchObject({
      duplicate: true,
      retained: second,
    });
    expect(registry.definitions().actions.get(first.name)).toBe(second);
    expect(registry.diagnostics().duplicates).toEqual([
      expect.objectContaining({
        kind: "action",
        name: first.name,
        policy: "replace",
      }),
    ]);
  });
});
