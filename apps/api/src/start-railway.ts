import { spawn } from "node:child_process";

const serverEntry = "apps/api/dist/server.js";
const workerEntry = "apps/api/dist/ocr-worker-service.js";

let serverProcess: ReturnType<typeof spawn> | null = null;
let workerProcess: ReturnType<typeof spawn> | null = null;
let stopping = false;

function log(message: string) {
  // eslint-disable-next-line no-console
  console.log(`[railway-supervisor] ${message}`);
}

function spawnServer() {
  log("starting API server");
  serverProcess = spawn(process.execPath, [serverEntry], {
    stdio: "inherit",
    env: process.env
  });

  serverProcess.on("exit", (code, signal) => {
    log(`API server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    if (!stopping) {
      stopping = true;
      if (workerProcess && !workerProcess.killed) {
        workerProcess.kill("SIGTERM");
      }
      process.exit(code ?? 1);
    }
  });
}

function spawnWorker() {
  log("starting OCR worker");
  workerProcess = spawn(process.execPath, [workerEntry], {
    stdio: "inherit",
    env: process.env
  });

  workerProcess.on("exit", (code, signal) => {
    log(`OCR worker exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    if (!stopping) {
      setTimeout(() => {
        if (!stopping) {
          spawnWorker();
        }
      }, 2000);
    }
  });
}

function stop(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  log(`received ${signal}, stopping children`);
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
  if (workerProcess && !workerProcess.killed) {
    workerProcess.kill("SIGTERM");
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

spawnServer();
spawnWorker();
