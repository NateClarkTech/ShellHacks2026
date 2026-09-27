import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

loadEnv(".env");
loadEnv(".env.local");

const apiUp = await portOpen(8000);
let api = null;
if (apiUp) {
  console.log("Scan API is already running on 127.0.0.1:8000");
} else {
  const uvicorn = existsSync(".venv/bin/uvicorn") ? ".venv/bin/uvicorn" : "";
  if (!uvicorn) {
    console.error("Missing .venv. Run: python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt");
    process.exit(1);
  }
  api = spawn(uvicorn, ["server.app:app", "--host", "127.0.0.1", "--port", "8000"], {
    stdio: "inherit",
    env: process.env,
  });
}

const viteBin = existsSync("node_modules/.bin/vite") ? "node_modules/.bin/vite" : "vite";
const vite = spawn(viteBin, [], { stdio: "inherit", env: process.env });

function stopApi() {
  if (api && api.exitCode == null && !api.killed) api.kill("SIGTERM");
}

function shutdown() {
  stopApi();
  if (vite.exitCode == null && !vite.killed) vite.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

vite.on("exit", (code) => {
  stopApi();
  process.exit(code ?? 0);
});

if (api) {
  api.on("exit", (code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") return;
    console.error("Scan API stopped. Stopping the page.");
    if (vite.exitCode == null && !vite.killed) vite.kill("SIGTERM");
    process.exit(code ?? 1);
  });
}
