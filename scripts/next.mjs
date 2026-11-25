import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const [command, ...options] = process.argv.slice(2);
require("@next/env").loadEnvConfig(process.cwd(), command === "dev");
const executable =
  process.platform === "win32"
    ? "node_modules/node/bin/node.exe"
    : "node_modules/node/bin/node";
const child = spawn(
  existsSync(executable) ? executable : process.execPath,
  [require.resolve("next/dist/bin/next"), command, "frontend", ...options],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
