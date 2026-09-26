import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const marker = ".wrangler/ppi-applied-migrations.json";
let applied = [];
try {
  applied = JSON.parse(readFileSync(marker, "utf8"));
} catch {}
for (const file of readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  if (applied.includes(file)) continue;
  const r = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/sites-env.mjs",
      "./node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "dist/server/wrangler.json",
      "--persist-to",
      ".wrangler/state",
      "--file",
      "drizzle/" + file,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) process.exit(r.status || 1);
  applied.push(file);
  mkdirSync(".wrangler", { recursive: true });
  writeFileSync(marker, JSON.stringify(applied, null, 2));
}
console.log("Local migrations are up to date.");
