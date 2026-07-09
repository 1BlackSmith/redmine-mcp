import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTestEnv } from "./load-env-file.js";

test("loadTestEnv loads dotenv values without overwriting existing environment", () => {
  const filename = `.env.test.${process.pid}.${Date.now()}`;
  const envPath = path.join(process.cwd(), filename);

  process.env.REDMINE_MCP_EXISTING = "from-process";
  delete process.env.REDMINE_MCP_UNQUOTED;
  delete process.env.REDMINE_MCP_DOUBLE_QUOTED;
  delete process.env.REDMINE_MCP_SINGLE_QUOTED;
  delete process.env.REDMINE_MCP_EXPORTED;

  try {
    fs.writeFileSync(envPath, [
      "REDMINE_MCP_UNQUOTED=value # comment",
      "REDMINE_MCP_DOUBLE_QUOTED=\"line\\nvalue\"",
      "REDMINE_MCP_SINGLE_QUOTED='literal value'",
      "export REDMINE_MCP_EXPORTED=from-export",
      "REDMINE_MCP_EXISTING=from-file",
      "",
    ].join(os.EOL));

    assert.equal(loadTestEnv(filename), true);
    assert.equal(process.env.REDMINE_MCP_UNQUOTED, "value");
    assert.equal(process.env.REDMINE_MCP_DOUBLE_QUOTED, "line\nvalue");
    assert.equal(process.env.REDMINE_MCP_SINGLE_QUOTED, "literal value");
    assert.equal(process.env.REDMINE_MCP_EXPORTED, "from-export");
    assert.equal(process.env.REDMINE_MCP_EXISTING, "from-process");
  } finally {
    fs.rmSync(envPath, { force: true });
    delete process.env.REDMINE_MCP_EXISTING;
    delete process.env.REDMINE_MCP_UNQUOTED;
    delete process.env.REDMINE_MCP_DOUBLE_QUOTED;
    delete process.env.REDMINE_MCP_SINGLE_QUOTED;
    delete process.env.REDMINE_MCP_EXPORTED;
  }
});
