import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export function loadTestEnv(filename = ".env.test") {
  const envPath = path.join(projectRoot, filename);
  if (!fs.existsSync(envPath)) return false;

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }

  return true;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;

  const assignment = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trim()
    : trimmed;
  const separator = assignment.indexOf("=");
  if (separator === -1) return undefined;

  const key = assignment.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;

  return {
    key,
    value: parseEnvValue(assignment.slice(separator + 1).trim()),
  };
}

function parseEnvValue(value) {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  const commentIndex = value.search(/\s#/);
  return commentIndex === -1 ? value : value.slice(0, commentIndex).trimEnd();
}
