import { Data } from "effect";

export type DurationInput = number | `${number} ${"millisecond" | "milliseconds" | "second" | "seconds" | "minute" | "minutes"}`;

export class UnsupportedDuration extends Data.TaggedError("UnsupportedDuration")<{
  readonly duration: unknown;
}> {}

export const parseDuration = (duration: DurationInput | undefined): number => {
  if (duration === undefined) {
    return 0;
  }

  if (typeof duration === "number") {
    return duration;
  }

  const match = /^(\d+) (milliseconds?|seconds?|minutes?)$/.exec(duration);
  if (!match) {
    throw new UnsupportedDuration({ duration });
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  if (unit.startsWith("millisecond")) return amount;
  if (unit.startsWith("second")) return amount * 1_000;
  return amount * 60_000;
};
