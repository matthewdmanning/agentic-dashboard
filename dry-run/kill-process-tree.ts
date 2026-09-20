import { spawnSync, type ChildProcess } from "node:child_process";

/**
 * Kills a spawned process and everything it spawned. `child.kill()` sends a
 * signal to that one PID only — on Windows there is no signal propagation to
 * children, so a process that itself spawns children (tsx, Vite's esbuild
 * dependency scanner) survives it and goes on holding its port or file watch
 * after the thing that started it believes it is gone.
 */
export function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else child.kill("SIGTERM");
}
