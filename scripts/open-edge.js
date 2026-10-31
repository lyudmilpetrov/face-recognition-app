import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Vite passes the actual development URL as the last argument.
const url = process.argv[process.argv.length - 1];
let command = "microsoft-edge";
let args = [url];

if (process.platform === "win32") {
  const installRoots = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  command =
    installRoots
      .map((root) =>
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe")
      )
      .find((executable) => existsSync(executable)) || "msedge";
} else if (process.platform === "darwin") {
  command = "open";
  args = ["-a", "Microsoft Edge", url];
}

const browser = spawn(command, args, {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});

browser.once("error", () => {
  console.error(
    `Unable to open Microsoft Edge. Install Edge or set BROWSER in .env.development.local. Open ${url} manually.`
  );
  process.exitCode = 1;
});

browser.unref();
