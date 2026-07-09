import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { runMcpServer } from "./mcp-test-client.js";

const DEFAULT_PAGE_QUERY = "limit=100&offset=0";

const actionCases = [
  paginatedCase("redmine_issues", "list", "/issues.json"),
  restCase("redmine_issues", "get", "GET", "/issues/101.json", { issue_id: "101" }),
  restCase("redmine_issues", "create", "POST", "/issues.json", {
    issue: { subject: "Created issue" },
  }, { issue: { subject: "Created issue" } }),
  restCase("redmine_issues", "update", "PUT", "/issues/101.json", {
    issue_id: "101",
    issue: { subject: "Updated issue" },
  }, { issue: { subject: "Updated issue" } }),
  restCase("redmine_issues", "add_note", "PUT", "/issues/101.json", {
    issue_id: "101",
    notes: "A note",
  }, { issue: { notes: "A note" } }),
  restCase("redmine_issues", "delete", "DELETE", "/issues/101.json", { issue_id: "101" }),

  restCase("redmine_issue_relations", "list", "GET", "/issues/101/relations.json", {
    issue_id: "101",
  }),
  restCase("redmine_issue_relations", "create", "POST", "/issues/101/relations.json", {
    issue_id: "101",
    relation: { issue_to_id: "102", relation_type: "relates" },
  }, { relation: { issue_to_id: "102", relation_type: "relates" } }),
  restCase("redmine_issue_relations", "delete", "DELETE", "/relations/201.json", {
    relation_id: "201",
  }),

  restCase("redmine_issue_watchers", "add", "POST", "/issues/101/watchers.json", {
    issue_id: "101",
    user_id: "301",
  }, { user_id: "301" }),
  restCase("redmine_issue_watchers", "remove", "DELETE", "/issues/101/watchers/301.json", {
    issue_id: "101",
    user_id: "301",
  }),

  restCase("redmine_issue_journals", "update", "PUT", "/journals/401.json", {
    journal_id: "401",
    notes: "Updated note",
  }, { journal: { notes: "Updated note" } }),
  restCase("redmine_issue_journals", "delete", "PUT", "/journals/401.json", {
    journal_id: "401",
  }, { journal: { notes: "" } }),

  paginatedCase("redmine_projects", "list", "/projects.json"),
  restCase("redmine_projects", "get", "GET", "/projects/project-alpha.json", {
    project_id: "project-alpha",
  }),
  restCase("redmine_projects", "create", "POST", "/projects.json", {
    project: { identifier: "project-alpha", name: "Project Alpha" },
  }, { project: { identifier: "project-alpha", name: "Project Alpha" } }),
  restCase("redmine_projects", "update", "PUT", "/projects/project-alpha.json", {
    project_id: "project-alpha",
    project: { name: "Project Alpha Updated" },
  }, { project: { name: "Project Alpha Updated" } }),
  restCase("redmine_projects", "delete", "DELETE", "/projects/project-alpha.json", {
    project_id: "project-alpha",
  }),
  restCase("redmine_projects", "archive", "PUT", "/projects/project-alpha/archive.json", {
    project_id: "project-alpha",
  }),
  restCase("redmine_projects", "unarchive", "PUT", "/projects/project-alpha/unarchive.json", {
    project_id: "project-alpha",
  }),

  paginatedCase(
    "redmine_memberships",
    "list",
    "/projects/project-alpha/memberships.json",
    "project_id=project-alpha",
    {
      project_id: "project-alpha",
    }
  ),
  restCase("redmine_memberships", "get", "GET", "/memberships/401.json", {
    membership_id: "401",
  }),
  restCase("redmine_memberships", "create", "POST", "/projects/project-alpha/memberships.json", {
    project_id: "project-alpha",
    membership: { user_id: "301", role_ids: ["1"] },
  }, { membership: { user_id: "301", role_ids: ["1"] } }),
  restCase("redmine_memberships", "update", "PUT", "/memberships/401.json", {
    membership_id: "401",
    membership: { role_ids: ["2"] },
  }, { membership: { role_ids: ["2"] } }),
  restCase("redmine_memberships", "delete", "DELETE", "/memberships/401.json", {
    membership_id: "401",
  }),

  paginatedCase(
    "redmine_versions",
    "list",
    "/projects/project-alpha/versions.json",
    "project_id=project-alpha",
    {
      project_id: "project-alpha",
    }
  ),
  restCase("redmine_versions", "get", "GET", "/versions/501.json", { version_id: "501" }),
  restCase("redmine_versions", "create", "POST", "/projects/project-alpha/versions.json", {
    project_id: "project-alpha",
    version: { name: "1.0" },
  }, { version: { name: "1.0" } }),
  restCase("redmine_versions", "update", "PUT", "/versions/501.json", {
    version_id: "501",
    version: { name: "1.1" },
  }, { version: { name: "1.1" } }),
  restCase("redmine_versions", "delete", "DELETE", "/versions/501.json", { version_id: "501" }),

  paginatedCase("redmine_time_entries", "list", "/time_entries.json"),
  restCase("redmine_time_entries", "get", "GET", "/time_entries/601.json", {
    time_entry_id: "601",
  }),
  restCase("redmine_time_entries", "create", "POST", "/time_entries.json", {
    time_entry: { issue_id: "101", hours: 1 },
  }, { time_entry: { issue_id: "101", hours: 1 } }),
  restCase("redmine_time_entries", "update", "PUT", "/time_entries/601.json", {
    time_entry_id: "601",
    time_entry: { hours: 2 },
  }, { time_entry: { hours: 2 } }),
  restCase("redmine_time_entries", "delete", "DELETE", "/time_entries/601.json", {
    time_entry_id: "601",
  }),

  paginatedCase("redmine_users", "list", "/users.json"),
  restCase("redmine_users", "get", "GET", "/users/301.json", { user_id: "301" }),
  restCase("redmine_users", "create", "POST", "/users.json", {
    user: { login: "alice", firstname: "Alice", lastname: "Tester" },
  }, { user: { login: "alice", firstname: "Alice", lastname: "Tester" } }),
  restCase("redmine_users", "update", "PUT", "/users/301.json", {
    user_id: "301",
    user: { firstname: "Alicia" },
  }, { user: { firstname: "Alicia" } }),
  restCase("redmine_users", "delete", "DELETE", "/users/301.json", { user_id: "301" }),

  paginatedCase("redmine_groups", "list", "/groups.json"),
  restCase("redmine_groups", "get", "GET", "/groups/701.json", { group_id: "701" }),
  restCase("redmine_groups", "create", "POST", "/groups.json", {
    group: { name: "QA" },
  }, { group: { name: "QA" } }),
  restCase("redmine_groups", "update", "PUT", "/groups/701.json", {
    group_id: "701",
    group: { name: "QA Team" },
  }, { group: { name: "QA Team" } }),
  restCase("redmine_groups", "delete", "DELETE", "/groups/701.json", { group_id: "701" }),
  restCase("redmine_groups", "add_user", "POST", "/groups/701/users.json", {
    group_id: "701",
    user_id: "301",
  }, { user_id: "301" }),
  restCase("redmine_groups", "remove_user", "DELETE", "/groups/701/users/301.json", {
    group_id: "701",
    user_id: "301",
  }),

  restCase("redmine_roles", "list", "GET", "/roles.json"),
  restCase("redmine_roles", "get", "GET", "/roles/801.json", { role_id: "801" }),
  restCase("redmine_trackers", "list", "GET", "/trackers.json"),
  restCase("redmine_issue_statuses", "list", "GET", "/issue_statuses.json"),
  restCase("redmine_enumerations", "list", "GET", "/enumerations/issue_priorities.json", {
    resource: "issue_priorities",
  }),
  restCase("redmine_custom_fields", "list", "GET", "/custom_fields.json"),
  restCase("redmine_queries", "list", "GET", "/queries.json"),

  restCase("redmine_wiki", "list", "GET", "/projects/project-alpha/wiki/index.json", {
    project_id: "project-alpha",
  }),
  restCase("redmine_wiki", "get", "GET", "/projects/project-alpha/wiki/Home%20Page.json", {
    project_id: "project-alpha",
    title: "Home Page",
  }),
  restCase("redmine_wiki", "update", "PUT", "/projects/project-alpha/wiki/Home%20Page.json", {
    project_id: "project-alpha",
    title: "Home Page",
    wiki_page: { text: "Updated" },
  }, { wiki_page: { text: "Updated" } }),
  restCase("redmine_wiki", "delete", "DELETE", "/projects/project-alpha/wiki/Home%20Page.json", {
    project_id: "project-alpha",
    title: "Home Page",
  }),

  paginatedCase(
    "redmine_documents",
    "list",
    "/projects/project-alpha/documents.json",
    "project_id=project-alpha",
    {
      project_id: "project-alpha",
    }
  ),
  restCase("redmine_documents", "get", "GET", "/documents/901.json", { document_id: "901" }),
  restCase("redmine_documents", "create", "POST", "/projects/project-alpha/documents.json", {
    project_id: "project-alpha",
    document: { title: "Spec" },
  }, { document: { title: "Spec" } }),
  restCase("redmine_documents", "delete", "DELETE", "/documents/901.json", {
    document_id: "901",
  }),

  restCase("redmine_files", "list", "GET", "/projects/project-alpha/files.json", {
    project_id: "project-alpha",
  }),
  restCase("redmine_files", "create", "POST", "/projects/project-alpha/files.json", {
    project_id: "project-alpha",
    file: { token: "upload-token", filename: "spec.txt" },
  }, { files: [{ token: "upload-token", filename: "spec.txt" }] }),

  paginatedCase(
    "redmine_news",
    "list",
    "/projects/project-alpha/news.json",
    "project_id=project-alpha",
    {
      project_id: "project-alpha",
    }
  ),
  restCase("redmine_news", "get", "GET", "/news/1001.json", { news_id: "1001" }),

  restCase("redmine_attachments", "get", "GET", "/attachments/1101.json", {
    attachment_id: "1101",
  }),
  restCase("redmine_attachments", "delete", "DELETE", "/attachments/1101.json", {
    attachment_id: "1101",
  }),

  restCase("redmine_issue_categories", "list", "GET", "/projects/project-alpha/issue_categories.json", {
    project_id: "project-alpha",
  }),
  restCase("redmine_issue_categories", "get", "GET", "/issue_categories/1201.json", {
    category_id: "1201",
  }),
  restCase("redmine_issue_categories", "create", "POST", "/projects/project-alpha/issue_categories.json", {
    project_id: "project-alpha",
    issue_category: { name: "Backend" },
  }, { issue_category: { name: "Backend" } }),
  restCase("redmine_issue_categories", "update", "PUT", "/issue_categories/1201.json", {
    category_id: "1201",
    issue_category: { name: "Frontend" },
  }, { issue_category: { name: "Frontend" } }),
  restCase("redmine_issue_categories", "delete", "DELETE", "/issue_categories/1201.json", {
    category_id: "1201",
  }),
];

test("routes every declared resource action to the expected Redmine request", async () => {
  const { baseUrl, requests, close } = await startRedmineStub();
  const messages = [
    { jsonrpc: "2.0", id: "tools-list", method: "tools/list" },
    ...actionCases.map((testCase, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "tools/call",
      params: {
        name: testCase.tool,
        arguments: testCase.args,
      },
    })),
  ];

  try {
    const responses = await runMcpServer(messages, {
      REDMINE_URL: baseUrl,
      REDMINE_API_KEY: "test-key",
    });
    const responseById = new Map(responses.map((response) => [response.id, response]));

    assertActionMatrixCoversToolList(responseById.get("tools-list").result.tools, actionCases);

    for (const testCase of actionCases) {
      const response = responseById.get(actionCases.indexOf(testCase));
      assert.ok(response, `${testCase.tool}.${testCase.action} did not return a response`);
      assert.equal(response.error, undefined, `${testCase.tool}.${testCase.action} failed`);

      const body = JSON.parse(response.result.content[0].text);
      assert.equal(body.status, 200, `${testCase.tool}.${testCase.action} returned non-200`);
    }

    assert.deepEqual(
      normalizeRequests(requests),
      normalizeRequests(actionCases.map(({ expected }) => expected))
    );
  } finally {
    await close();
  }
});

function restCase(tool, action, method, url, args = {}, body = undefined) {
  return {
    tool,
    action,
    args: { action, ...args },
    expected: { method, url, body },
  };
}

function paginatedCase(tool, action, path, queryPrefixOrArgs = {}, args = undefined) {
  const queryPrefix = typeof queryPrefixOrArgs === "string" ? queryPrefixOrArgs : "";
  const testArgs = args === undefined ? queryPrefixOrArgs : args;
  const query = [queryPrefix, DEFAULT_PAGE_QUERY].filter(Boolean).join("&");
  return restCase(tool, action, "GET", `${path}?${query}`, testArgs);
}

async function startRedmineStub() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const rawBody = await readBody(req);
    requests.push({
      method: req.method,
      url: req.url,
      body: rawBody ? JSON.parse(rawBody) : undefined,
    });

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ total_count: 0, limit: 100, offset: 0, items: [] }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function assertActionMatrixCoversToolList(tools, cases) {
  const declaredActions = new Map();
  for (const tool of tools) {
    const actions = tool.inputSchema?.properties?.action?.enum;
    if (Array.isArray(actions)) {
      declaredActions.set(tool.name, actions);
    }
  }

  const coveredActions = new Map();
  for (const testCase of cases) {
    const actions = coveredActions.get(testCase.tool) || [];
    actions.push(testCase.action);
    coveredActions.set(testCase.tool, actions);
  }

  assert.deepEqual(
    mapToSortedEntries(coveredActions),
    mapToSortedEntries(declaredActions),
    "actionCases must cover every action declared by tools/list"
  );
}

function normalizeRequests(requests) {
  return requests
    .map((request) => ({
      method: request.method,
      url: request.url,
      body: request.body,
    }))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function mapToSortedEntries(map) {
  return [...map.entries()]
    .map(([tool, actions]) => [tool, [...actions].sort()])
    .sort(([left], [right]) => left.localeCompare(right));
}

async function readBody(stream) {
  let body = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    body += chunk;
  }
  return body;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
