import { Data } from "effect";

/** Duration accepted by Resource lifecycle policies, measured in milliseconds. */
export type DurationInput = number | `${number} ${"millisecond" | "milliseconds" | "second" | "seconds" | "minute" | "minutes"}`;

/** Error raised when a Resource lifecycle duration cannot be parsed. */
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

  const match = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?) (milliseconds?|seconds?|minutes?)$/i.exec(duration);
  if (!match) {
    throw new UnsupportedDuration({ duration });
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    throw new UnsupportedDuration({ duration });
  }
  const unit = (match[2] ?? "").toLowerCase();
  if (unit.startsWith("millisecond")) return amount;
  if (unit.startsWith("second")) return amount * 1_000;
  return amount * 60_000;
};
