#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DIARY_DIR = path.join(ROOT, "src", "content", "diary");

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args.set(key, value);
    i += 1;
  }
  return {
    out: args.get("out"),
  };
}

function extractTasks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const checked = [];
  const unchecked = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const checkedMatch = trimmed.match(/^- \[(x|X)\] (.+)$/);
    if (checkedMatch) {
      checked.push(checkedMatch[2].trim());
      continue;
    }
    const uncheckedMatch = trimmed.match(/^- \[ \] (.+)$/);
    if (uncheckedMatch) {
      unchecked.push(uncheckedMatch[1].trim());
    }
  }
  return { checked, unchecked };
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  if (!out) {
    throw new Error("Provide --out <path>.");
  }

  const files = (await fs.readdir(DIARY_DIR))
    .filter(name => name.endsWith(".md") || name.endsWith(".mdx"))
    .sort();
  if (files.length < 2) {
    throw new Error("Need at least two diary files to compute progress delta.");
  }

  const previousFile = files[files.length - 2];
  const latestFile = files[files.length - 1];

  const [previousRaw, latestRaw] = await Promise.all([
    fs.readFile(path.join(DIARY_DIR, previousFile), "utf8"),
    fs.readFile(path.join(DIARY_DIR, latestFile), "utf8"),
  ]);

  const previousTasks = extractTasks(previousRaw);
  const latestTasks = extractTasks(latestRaw);
  const unresolvedCarry = previousTasks.unchecked.filter(
    task => !latestTasks.checked.includes(task)
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "local-diary-files",
    previousFile,
    latestFile,
    summary: {
      previous: {
        checkedCount: previousTasks.checked.length,
        uncheckedCount: previousTasks.unchecked.length,
      },
      latest: {
        checkedCount: latestTasks.checked.length,
        uncheckedCount: latestTasks.unchecked.length,
      },
      unresolvedCarryCount: unresolvedCarry.length,
    },
    unresolvedCarry,
    latestUnchecked: latestTasks.unchecked,
    latestChecked: latestTasks.checked,
  };

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        out,
        previousFile,
        latestFile,
        unresolvedCarry: unresolvedCarry.length,
      },
      null,
      2
    )
  );
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diary_progress_snapshot failed: ${message}`);
  process.exit(1);
});
