// Starts one app's production server and stops it again.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export const port = Number(process.env.COMPARE_PORT ?? 4400);
export const origin = `http://127.0.0.1:${port}`;

export const startServer = async (framework) => {
  const child = spawn(process.execPath, framework.start, {
    cwd: framework.cwd,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${framework.id} server exited (${child.exitCode}): ${stderr}`);
    }
    try {
      const response = await fetch(`${origin}/`);
      await response.arrayBuffer();
      if (response.ok) {
        return {
          pid: child.pid,
          stop: async () => {
            child.kill("SIGTERM");
            const exited = new Promise((resolve) => child.once("exit", resolve));
            await Promise.race([exited, sleep(5000)]);
            if (child.exitCode === null && child.signalCode === null) {
              child.kill("SIGKILL");
              await exited;
            }
          },
        };
      }
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  child.kill("SIGKILL");
  throw new Error(`${framework.id} server did not answer within 30s: ${stderr}`);
};
