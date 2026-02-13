import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const sourceDir = join(root, "app", "renderer");
const outDir = join(root, "build");

async function run() {
  await mkdir(outDir, { recursive: true });
  await cp(sourceDir, outDir, { recursive: true, force: true });
  process.stdout.write("[sync-static] build/ renderer assets synced\n");
}

run().catch((error) => {
  process.stderr.write(`[sync-static] failed: ${String(error)}\n`);
  process.exit(1);
});
