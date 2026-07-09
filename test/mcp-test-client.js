import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../src/server.js", import.meta.url));

export function createMcpClient({ env = {}, args = [], timeoutMs = 30000 } = {}) {
  const child = spawn(process.execPath, [serverPath, ...args], {
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  let stdout = "";
  let stderr = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    stdout += chunk;

    while (true) {
      const newlineIndex = stdout.indexOf("\n");
      if (newlineIndex === -1) break;

      const line = stdout.slice(0, newlineIndex).trim();
      stdout = stdout.slice(newlineIndex + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        rejectAll(new Error(`Invalid JSON-RPC response: ${error.message}\n${line}`));
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(message, "id")) continue;
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timeout);

      if (message.error) {
        const error = new Error(message.error.message);
        error.code = message.error.code;
        error.data = message.error.data;
        waiter.reject(error);
      } else {
        waiter.resolve(message.result);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.on("exit", (code, signal) => {
    if (pending.size === 0) return;
    rejectAll(new Error(`MCP server exited before responding; code=${code} signal=${signal}\n${stderr}`));
  });

  function request(method, params) {
    const id = nextId;
    nextId += 1;

    const message = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} response after ${timeoutMs}ms\n${stderr}`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async function callTool(name, args) {
    const result = await request("tools/call", {
      name,
      arguments: args,
    });
    return JSON.parse(result.content[0].text);
  }

  async function close() {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timeout);
    }
    pending.clear();

    if (child.exitCode !== null || child.killed) return;
    child.stdin.end();
    const [code, signal] = await once(child, "exit");
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
  }

  function rejectAll(error) {
    for (const [id, waiter] of pending.entries()) {
      pending.delete(id);
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  }

  return {
    request,
    callTool,
    close,
  };
}

export async function runMcpServer(messages, env) {
  const client = createMcpClient({ env });
  try {
    const responses = [];
    for (const message of messages) {
      const result = await client.request(message.method, message.params);
      responses.push({ jsonrpc: "2.0", id: message.id, result });
    }
    return responses;
  } finally {
    await client.close();
  }
}
