import {
  Signal,
  type WritableSignal
} from "./signal.js";

interface ProgramRuntimeTimelineEventBase {
  readonly sequence: number;
  readonly program?: string;
}

export type ProgramRuntimeTimelineEventInput<Event extends ProgramRuntimeTimelineEventBase> =
  Event extends infer Candidate
    ? Candidate extends ProgramRuntimeTimelineEventBase
      ? Omit<Candidate, "sequence" | "program">
      : never
    : never;

export interface ProgramRuntimeTimelineOptions {
  readonly name?: string;
  readonly timeline?: false | {
    readonly limit?: number;
  };
}

export interface ProgramRuntimeTimeline<Event extends ProgramRuntimeTimelineEventBase> {
  readonly timeline: WritableSignal<ReadonlyArray<Event>>;
  readonly limit: number;
  record(event: ProgramRuntimeTimelineEventInput<Event>): void;
  clear(): void;
}

const defaultProgramTimelineLimit = 200;

export const resolveProgramTimelineLimit = (
  timeline: ProgramRuntimeTimelineOptions["timeline"]
): number => {
  if (timeline === false) {
    return 0;
  }

  const limit = typeof timeline === "object" ? timeline.limit : undefined;
  return typeof limit === "number" && Number.isFinite(limit) && limit >= 0
    ? Math.floor(limit)
    : defaultProgramTimelineLimit;
};

export const makeProgramRuntimeTimeline = <Event extends ProgramRuntimeTimelineEventBase>(
  options: ProgramRuntimeTimelineOptions
): ProgramRuntimeTimeline<Event> => {
  const limit = resolveProgramTimelineLimit(options.timeline);
  const timeline = Signal.make<ReadonlyArray<Event>>([]);
  let sequence = 0;

  return {
    timeline,
    limit,
    record: (event) => {
      if (limit === 0) {
        return;
      }

      const next = {
        sequence: ++sequence,
        ...(options.name === undefined ? {} : { program: options.name }),
        ...event
      } as Event;

      timeline.update((current) =>
        current.length + 1 <= limit
          ? [...current, next]
          : [...current.slice(current.length + 1 - limit), next]
      );
    },
    clear: () => {
      timeline.set([]);
    }
  };
};
