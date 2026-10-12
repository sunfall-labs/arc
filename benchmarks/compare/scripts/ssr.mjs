// SSR throughput and latency with autocannon against a running server, plus
// the server process's CPU time per request, which is far less sensitive to
// other load on the machine than requests per second.
import { execFileSync } from "node:child_process";
import autocannon from "autocannon";
import { origin } from "./server.mjs";

export const ssrSettings = { connections: 10, pipelining: 1, warmupSeconds: 3, seconds: 10 };

const cannon = (path, seconds) =>
  autocannon({
    url: `${origin}${path}`,
    connections: ssrSettings.connections,
    pipelining: ssrSettings.pipelining,
    duration: seconds,
  });

/** User + system CPU time of a process in ms (`ps` reports `[[h:]m:]s.cc`). */
const cpuTimeMs = (pid) => {
  const text = execFileSync("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }).trim();
  return (
    text
      .split(":")
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0) * 1000
  );
};

/** Warms the route, then measures it: requests per second, latency percentiles (ms), CPU ms per request. */
export const measureSsr = async (path, { pid, seconds = ssrSettings.seconds }) => {
  await cannon(path, ssrSettings.warmupSeconds);
  const cpuBefore = cpuTimeMs(pid);
  const result = await cannon(path, seconds);
  const cpuAfter = cpuTimeMs(pid);
  return {
    requestsPerSecond: result.requests.average,
    p50: result.latency.p50,
    p99: result.latency.p99,
    cpuMsPerRequest: result.requests.total > 0 ? (cpuAfter - cpuBefore) / result.requests.total : 0,
    requests: result.requests.total,
    non2xx: result.non2xx,
    errors: result.errors,
    bytesPerResponse:
      result.requests.total > 0 ? result.throughput.total / result.requests.total : 0,
  };
};
