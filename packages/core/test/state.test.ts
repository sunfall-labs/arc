import { Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect";
import { KeyValueStore } from "effect/persistence";
import { describe, expect, it } from "vitest";
import { Machine, Message, makeRuntime, Model, State, Timeline } from "../src/index.js";
import {
  appStateOnRuntime,
  defaultRuntime,
  dehydrateAppStates,
  eraseRuntime,
  hydrateAppStates,
} from "../src/internal.js";

interface CounterApi {
  readonly load: Effect.Effect<number>;
}

const CounterApi = Context.Service<CounterApi>("@sunfall/arc-core/test/CounterApi");

/** The degenerate case: one variant, plain field updates. */
const SearchModel = Model({ Editing: { query: Schema.String } });
const SearchEvent = Message({ TypedQuery: { text: Schema.String }, ClearedQuery: {} });
const Search = State.define({
  name: "Search",
  machine: Machine.make({
    state: SearchModel,
    event: SearchEvent,
    initial: SearchModel.Editing({ query: "" }),
  })
    .onAny(SearchEvent.TypedQuery, ({ event }) => SearchModel.Editing({ query: event.text }))
    .onAny(SearchEvent.ClearedQuery, () => SearchModel.Editing({ query: "" })),
});

const MenuModel = Model({ Closed: {}, Open: {} });
const MenuEvent = Message({ ClickedMenu: {}, PressedEscape: {} });
const Menu = State.define({
  name: "Menu",
  machine: Machine.make({ state: MenuModel, event: MenuEvent, initial: MenuModel.Closed })
    .on(MenuModel.Closed, MenuEvent.ClickedMenu, () => MenuModel.Open)
    .on(MenuModel.Open, MenuEvent.ClickedMenu, () => MenuModel.Closed)
    .on(MenuModel.Open, MenuEvent.PressedEscape, () => MenuModel.Closed),
});

const DownloadModel = Model({
  Idle: {},
  Downloading: { url: Schema.String, received: Schema.Finite },
  Done: { url: Schema.String, bytes: Schema.Finite },
  Failed: { url: Schema.String, reason: Schema.String },
});
const DownloadEvent = Message({
  ClickedDownload: { url: Schema.String },
  ClickedCancel: {},
  ReceivedChunk: { bytes: Schema.Finite },
  FinishedDownload: {},
  FailedDownload: { reason: Schema.String },
});

/** A statechart whose Downloading variant owns the download. */
const makeDownload = (download: (url: string) => Stream.Stream<number, string>) =>
  State.define({
    name: "Download",
    machine: Machine.make({
      state: DownloadModel,
      event: DownloadEvent,
      initial: DownloadModel.Idle,
    })
      .when(
        [DownloadModel.Idle, DownloadModel.Done, DownloadModel.Failed],
        DownloadEvent.ClickedDownload,
        function hasUrl({ event }) {
          return event.url !== "";
        },
        ({ event }) => DownloadModel.Downloading({ url: event.url, received: 0 }),
      )
      .on(DownloadModel.Downloading, DownloadEvent.ReceivedChunk, ({ state, event }) =>
        DownloadModel.Downloading({ url: state.url, received: state.received + event.bytes }),
      )
      .on(DownloadModel.Downloading, DownloadEvent.FinishedDownload, ({ state }) =>
        DownloadModel.Done.with(state, { bytes: state.received }),
      )
      .on(DownloadModel.Downloading, DownloadEvent.FailedDownload, ({ state, event }) =>
        DownloadModel.Failed.with(state, { reason: event.reason }),
      )
      .on(DownloadModel.Downloading, DownloadEvent.ClickedCancel, () => DownloadModel.Idle)
      .spawn(DownloadModel.Downloading, ({ state, self }) =>
        download(state.url).pipe(
          Stream.runForEach((bytes) => self.send(DownloadEvent.ReceivedChunk({ bytes }))),
          Effect.andThen(self.send(DownloadEvent.FinishedDownload)),
          Effect.catch((reason) => self.send(DownloadEvent.FailedDownload({ reason }))),
        ),
      ),
  });

const waitFor = (condition: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (condition()) {
        return;
      }
      yield* Effect.sleep("2 millis");
    }
    throw new Error("Timed out waiting for the condition.");
  });

const describeState = (entries: ReadonlyArray<Timeline.Entry>, name: string) =>
  entries
    .filter((entry) => entry.cause._tag === "State" && entry.cause.state === name)
    .map((entry) => Timeline.describe(entry.cause));

describe("State machines without a runtime", () => {
  it("replays transitions purely, as tests do", () => {
    expect(
      Effect.runSync(
        Machine.replay(Search.machine, [
          SearchEvent.TypedQuery({ text: "arc" }),
          SearchEvent.ClearedQuery,
        ]),
      ),
    ).toMatchObject({ _tag: "Editing", query: "" });
    expect(
      Effect.runSync(Machine.replay(Menu.machine, [MenuEvent.ClickedMenu, MenuEvent.PressedEscape]))
        ._tag,
    ).toBe("Closed");
    // Not valid in Closed: the message changes nothing.
    expect(Effect.runSync(Machine.replay(Menu.machine, [MenuEvent.PressedEscape]))._tag).toBe(
      "Closed",
    );
  });
});

describe("State runtime", () => {
  it("commits each message on the model, one Timeline entry per message", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const menu = State.start(Menu, { runtime: defaultRuntime });
        yield* menu.dispatch(MenuEvent.ClickedMenu);
        expect(menu.model.get()._tag).toBe("Open");
        yield* menu.dispatch(MenuEvent.PressedEscape);
        // Not valid in Closed: ignored, and recorded as such.
        yield* menu.dispatch(MenuEvent.PressedEscape);
        expect(menu.model.get()._tag).toBe("Closed");
        expect(describeState(recording.entries.get(), "Menu")).toEqual([
          'State "Menu" start',
          'State "Menu" ClickedMenu',
          'State "Menu" PressedEscape',
          'State "Menu" PressedEscape (ignored)',
        ]);
        yield* menu.dispose;
      }).pipe(Effect.scoped),
    ));

  it("runs transitions with the runtime's services", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runtime = makeRuntime(Layer.succeed(CounterApi)({ load: Effect.succeed(3) }));
        const CounterModel = Model({ Ready: { count: Schema.Finite } });
        const CounterEvent = Message({ ClickedLoad: {} });
        const Counter = State.define({
          name: "Counter",
          machine: Machine.make({
            state: CounterModel,
            event: CounterEvent,
            initial: CounterModel.Ready({ count: 0 }),
          }).onAny(CounterEvent.ClickedLoad, ({ state }) =>
            CounterApi.use((api) => api.load).pipe(
              Effect.map((amount) => CounterModel.Ready({ count: state.count + amount })),
            ),
          ),
        });
        const counter = State.start(Counter, { runtime });
        yield* counter.dispatch(CounterEvent.ClickedLoad);
        expect(counter.model.get()).toMatchObject({ count: 3 });
        yield* counter.dispose;
        yield* runtime.dispose;
      }),
    ));

  it("starts a variant's work on entry and interrupts it on exit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<string>();
        const interrupted = yield* Deferred.make<string>();
        const Download = makeDownload((url) =>
          Stream.fromEffect(
            Deferred.succeed(started, url).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, url)),
            ),
          ),
        );
        const download = State.start(Download, { runtime: defaultRuntime });
        yield* download.dispatch(DownloadEvent.ClickedDownload({ url: "/report.pdf" }));
        expect(yield* Deferred.await(started)).toBe("/report.pdf");
        yield* download.dispatch(DownloadEvent.ClickedCancel);
        expect(yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))).toBe(
          "/report.pdf",
        );
        expect(download.model.get()._tag).toBe("Idle");
        yield* download.dispose;
      }),
    ));

  it("turns work output and work failures into messages", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Download = makeDownload((url) =>
          url === "/missing" ? Stream.fail("not found") : Stream.make(3, 4),
        );
        const download = State.start(Download, { runtime: defaultRuntime });
        yield* download.dispatch(DownloadEvent.ClickedDownload({ url: "/a" }));
        yield* waitFor(() => download.model.get()._tag === "Done");
        expect(download.model.get()).toMatchObject({ _tag: "Done", url: "/a", bytes: 7 });
        yield* download.dispatch(DownloadEvent.ClickedDownload({ url: "/missing" }));
        yield* waitFor(() => download.model.get()._tag === "Failed");
        expect(download.model.get()).toMatchObject({ reason: "not found" });
        expect(download.failures.get()).toEqual([]);
        yield* download.dispose;
      }),
    ));

  it("guards a transition, and can() answers from the same table", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const download = State.start(
          makeDownload(() => Stream.never),
          { runtime: defaultRuntime },
        );
        expect(download.can(DownloadEvent.ClickedDownload({ url: "" }))).toBe(false);
        expect(download.can(DownloadEvent.ClickedDownload({ url: "/a" }))).toBe(true);
        expect(download.can(DownloadEvent.ClickedCancel)).toBe(false);
        yield* download.dispatch(DownloadEvent.ClickedDownload({ url: "" }));
        expect(download.model.get()._tag).toBe("Idle");
        yield* download.dispatch(DownloadEvent.ClickedDownload({ url: "/a" }));
        expect(download.can(DownloadEvent.ClickedCancel)).toBe(true);
        expect(describeState(recording.entries.get(), "Download")).toEqual([
          'State "Download" start',
          'State "Download" ClickedDownload (ignored)',
          'State "Download" ClickedDownload',
        ]);
        yield* download.dispose;
      }).pipe(Effect.scoped),
    ));

  it("rejects a message its schema rejects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const menu = State.start(Menu, { runtime: defaultRuntime });
        const rejected = yield* Effect.flip(menu.dispatch({ _tag: "Nope" } as never));
        expect(rejected).toMatchObject({ _tag: "StateFailure", phase: "Update" });
        expect(rejected.error).toBeInstanceOf(Schema.SchemaError);
        expect(menu.failures.get()).toHaveLength(1);
        menu.clearFailures();
        expect(menu.failures.get()).toEqual([]);
        yield* menu.dispose;
      }),
    ));

  it("reports a defect in work as a Work failure", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const download = State.start(
          makeDownload(() => Stream.die("boom")),
          { runtime: defaultRuntime },
        );
        // The work dies at once, so the message that started it fails with its defect.
        const died = yield* Effect.flip(
          download.dispatch(DownloadEvent.ClickedDownload({ url: "/a" })),
        );
        expect(died.error).toMatchObject({ _tag: "StateDefect", phase: "spawn" });
        yield* waitFor(() => download.failures.get().length > 0);
        expect(download.failures.get()[0]).toMatchObject({ phase: "Work" });
        expect(download.failures.get()[0]?.error).toBeInstanceOf(State.Defect);
        // The defect stops the State: recorded once, and it takes no more messages.
        yield* Effect.sleep("10 millis");
        expect(download.failures.get()).toHaveLength(1);
        expect(download.can(DownloadEvent.ClickedCancel)).toBe(false);
        const refused = yield* Effect.flip(download.dispatch(DownloadEvent.ClickedCancel));
        expect(refused.error).toMatchObject({ _tag: "StateDefect", phase: "stopped" });
        yield* download.dispose;
      }),
    ));

  it("stops on a throwing transition: one failure, refused dispatches, can() false", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Broken = State.define({
          name: "Broken",
          machine: Machine.make({ state: MenuModel, event: MenuEvent, initial: MenuModel.Closed })
            .on(MenuModel.Closed, MenuEvent.ClickedMenu, (): typeof MenuModel.Type => {
              throw new Error("kaboom");
            })
            .on(MenuModel.Closed, MenuEvent.PressedEscape, () => MenuModel.Closed),
        });
        const broken = State.start(Broken, { runtime: defaultRuntime });
        const first = yield* Effect.flip(broken.dispatch(MenuEvent.ClickedMenu));
        expect(first.error).toMatchObject({ _tag: "StateDefect", phase: "transition" });
        expect(broken.failures.get()).toHaveLength(1);
        expect(broken.can(MenuEvent.PressedEscape)).toBe(false);
        const refused = yield* Effect.flip(broken.dispatch(MenuEvent.PressedEscape));
        expect(refused.error).toMatchObject({ _tag: "StateDefect", phase: "stopped" });
        expect(broken.failures.get()).toHaveLength(1);
        yield* broken.dispose;
      }),
    ));

  it("fails dispatches after disposal with StateDisposed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const menu = State.start(Menu, { runtime: defaultRuntime });
        yield* menu.dispose;
        const afterDispose = yield* Effect.flip(menu.dispatch(MenuEvent.ClickedMenu));
        expect(afterDispose.error).toBeInstanceOf(State.Disposed);
      }),
    ));

  it("interrupts a variant's work on disposal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const download = State.start(
          makeDownload(() =>
            Stream.fromEffect(
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
              ),
            ),
          ),
          { runtime: defaultRuntime },
        );
        yield* download.dispatch(DownloadEvent.ClickedDownload({ url: "/a" }));
        yield* Deferred.await(started);
        yield* download.dispose;
        yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"));
      }),
    ));

  it("settles a pending dispatch when disposal drops it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const menu = State.start(Menu, { runtime: defaultRuntime });
        const pending = yield* Effect.forkChild(menu.dispatch(MenuEvent.ClickedMenu), {
          startImmediately: true,
        });
        yield* menu.dispose;
        const exit = yield* Fiber.await(pending).pipe(Effect.timeout("1 second"));
        // Processed before disposal, or failed with StateDisposed: never left hanging.
        if (Exit.isFailure(exit)) {
          expect(String(exit.cause)).toContain("StateDisposed");
        }
      }),
    ));
});

describe("State on the Timeline", () => {
  it("records messages as data and replays them from the start", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const Download = makeDownload(() => Stream.make(2, 3));
        const download = State.start(Download, { runtime: defaultRuntime });
        yield* download.dispatch(DownloadEvent.ClickedCancel);
        yield* download.dispatch(DownloadEvent.ClickedDownload({ url: "/a" }));
        yield* waitFor(() => download.model.get()._tag === "Done");

        expect(describeState(recording.entries.get(), "Download")).toEqual([
          'State "Download" start',
          'State "Download" ClickedCancel (ignored)',
          'State "Download" ClickedDownload',
          'State "Download" ReceivedChunk',
          'State "Download" ReceivedChunk',
          'State "Download" FinishedDownload',
        ]);

        // Message-level replay: the recorded messages, re-applied without a
        // runtime from the recorded start, reach the recorded model.
        const [history] = State.history(Download, recording.entries.get());
        expect(history?.from._tag).toBe("Idle");
        const replayed = Effect.runSync(
          Machine.replay(
            Download.machine,
            history!.messages.map((entry) => entry.message),
            { from: history!.from },
          ),
        );
        expect(replayed).toEqual(download.model.get());

        // Value-level travel renders the model as it was after any message.
        const started = recording.entries
          .get()
          .find((entry) => Timeline.describe(entry.cause) === 'State "Download" ClickedDownload')!;
        yield* recording.travel(started.sequence);
        expect(recording.position.get()).toBe(started.sequence);
        yield* recording.resume();
        yield* download.dispose;
      }).pipe(Effect.scoped),
    ));
});

describe("State persistence", () => {
  const DraftModel = Model({ Drafting: { text: Schema.String } });
  const DraftEvent = Message({ TypedDraft: { text: Schema.String } });
  const Draft = State.define({
    name: "Draft",
    machine: Machine.make({
      state: DraftModel,
      event: DraftEvent,
      initial: DraftModel.Drafting({ text: "" }),
    }).onAny(DraftEvent.TypedDraft, ({ event }) => DraftModel.Drafting({ text: event.text })),
    persist: { key: "draft" },
  });

  const memoryRuntime = () => makeRuntime(KeyValueStore.layerMemory);
  const storeOf = (runtime: ReturnType<typeof memoryRuntime>) =>
    runtime.provide(
      Effect.gen(function* () {
        return yield* KeyValueStore.KeyValueStore;
      }),
    );

  it("restores the persisted model before messages, and saves each change", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runtime = memoryRuntime();
        const store = yield* storeOf(runtime);
        yield* store.set("arc/states/v1/draft", JSON.stringify({ _tag: "Drafting", text: "kept" }));
        const recording = yield* Timeline.record();
        const draft = State.start(Draft, { runtime });
        yield* waitFor(() => draft.model.get().text === "kept");
        yield* draft.dispatch(DraftEvent.TypedDraft({ text: "kept and more" }));
        expect(JSON.parse((yield* store.get("arc/states/v1/draft")) as string)).toEqual({
          _tag: "Drafting",
          text: "kept and more",
        });
        expect(describeState(recording.entries.get(), "Draft")).toEqual([
          'State "Draft" start',
          'State "Draft" restore',
          'State "Draft" TypedDraft',
        ]);
        yield* draft.dispose;
        yield* runtime.dispose;
      }).pipe(Effect.scoped),
    ));

  it("ignores a persisted model its schema rejects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runtime = memoryRuntime();
        const store = yield* storeOf(runtime);
        yield* store.set("arc/states/v1/draft", JSON.stringify({ _tag: "Drafting", text: 42 }));
        const draft = State.start(Draft, { runtime });
        yield* draft.dispatch(DraftEvent.TypedDraft({ text: "fresh" }));
        expect(draft.model.get().text).toBe("fresh");
        expect(draft.failures.get()).toEqual([]);
        yield* draft.dispose;
        yield* runtime.dispose;
      }),
    ));
});

describe("App State hydration", () => {
  const ToastModel = Model({ Hidden: {}, Showing: { text: Schema.String } });
  const ToastEvent = Message({ Notified: { text: Schema.String } });
  const Toast = State.define({
    name: "Hydrated.toast",
    scope: "app",
    machine: Machine.make({
      state: ToastModel,
      event: ToastEvent,
      initial: ToastModel.Hidden,
    }).onAny(ToastEvent.Notified, ({ event }) => ToastModel.Showing({ text: event.text })),
  });

  it("carries a server model to the browser, decoded by the state schema", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = eraseRuntime(makeRuntime(Layer.empty));
        const onServer = appStateOnRuntime(Toast, server);
        yield* onServer.dispatch(ToastEvent.Notified({ text: "Saved" }));
        const snapshots = yield* server.provide(dehydrateAppStates);
        expect(snapshots).toEqual([
          { name: "Hydrated.toast", model: { _tag: "Showing", text: "Saved" } },
        ]);
        const wire = JSON.parse(JSON.stringify(snapshots));
        yield* server.dispose;

        const browser = eraseRuntime(makeRuntime(Layer.empty));
        yield* browser.provide(hydrateAppStates(wire));
        const onBrowser = appStateOnRuntime(Toast, browser);
        expect(onBrowser.model.get()).toEqual({ _tag: "Showing", text: "Saved" });
        expect(onBrowser.failures.get()).toEqual([]);
        yield* browser.dispose;
      }),
    ));

  it("rejects a tampered snapshot: the State starts from initial and reports a Hydrate failure", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const browser = eraseRuntime(makeRuntime(Layer.empty));
        yield* browser.provide(
          hydrateAppStates([{ name: "Hydrated.toast", model: { _tag: "Showing", text: 7 } }]),
        );
        const onBrowser = appStateOnRuntime(Toast, browser);
        expect(onBrowser.model.get()._tag).toBe("Hidden");
        expect(onBrowser.failures.get()).toHaveLength(1);
        expect(onBrowser.failures.get()[0]).toMatchObject({ phase: "Hydrate" });
        expect(onBrowser.failures.get()[0]?.error).toBeInstanceOf(Schema.SchemaError);
        yield* browser.dispose;
      }),
    ));

  it("leaves a model still at initial out of the payload", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = eraseRuntime(makeRuntime(Layer.empty));
        appStateOnRuntime(Toast, server);
        expect(yield* server.provide(dehydrateAppStates)).toEqual([]);
        yield* server.dispose;
      }),
    ));
});
