#!/usr/bin/env node

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_VERSION = "0.1.0";
const JSON_RPC_VERSION = "2.0";
const MAX_BODY_PREVIEW_CHARS = 30000;
const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_PAGES = 10;

const anyJsonObjectSchema = {
  type: "object",
  additionalProperties: true,
};

const querySchema = {
  type: "object",
  description: "Query parameters. Array values are appended repeatedly.",
  additionalProperties: true,
};

const headersSchema = {
  type: "object",
  description:
    "Additional headers. Authentication and content headers are managed automatically unless explicitly overridden.",
  additionalProperties: { type: "string" },
};

const idSchema = {
  type: "string",
  description: "Redmine numeric ID or identifier, passed as a string.",
};

const paginationToolProperties = {
  query: querySchema,
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 1000,
    default: DEFAULT_LIMIT,
  },
  max_pages: {
    type: "integer",
    minimum: 1,
    maximum: 1000,
    default: DEFAULT_MAX_PAGES,
  },
};

const state = {
  buffer: Buffer.alloc(0),
  initialized: false,
  pending: new Set(),
  rawMode: false,
  stdinEnded: false,
};

const tools = [
  {
    name: "redmine_api_request",
    description:
      "Call any Redmine REST API endpoint. This is the escape hatch for the complete Redmine API surface, version-specific endpoints, and plugin endpoints. Paths are resolved under REDMINE_URL.",
    inputSchema: objectSchema(
      {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
          description: "HTTP method.",
        },
        path: {
          type: "string",
          description:
            "REST path, for example /issues.json, /issues/123.json, /projects/my-project/wiki/index.json, or a plugin endpoint.",
        },
        query: querySchema,
        body: {
          ...anyJsonObjectSchema,
          description: "JSON request body for POST, PUT, PATCH, and DELETE requests.",
        },
        raw_body_base64: {
          type: "string",
          description:
            "Optional raw request body encoded as base64. Use for non-JSON endpoints such as uploads.",
        },
        headers: headersSchema,
      },
      ["method", "path"]
    ),
  },
  {
    name: "redmine_paginated_request",
    description:
      "Call a Redmine list endpoint and follow Redmine offset/limit pagination using total_count from the response body.",
    inputSchema: objectSchema(
      {
        path: {
          type: "string",
          description: "REST list path, for example /issues.json or /time_entries.json.",
        },
        query: querySchema,
        limit: paginationToolProperties.limit,
        max_pages: {
          ...paginationToolProperties.max_pages,
          description:
            "Safety limit for pagination. Increase when intentionally collecting large result sets.",
        },
        headers: headersSchema,
      },
      ["path"]
    ),
  },
  {
    name: "redmine_upload_file",
    description:
      "Upload binary content to Redmine /uploads.json and return an upload token for later attachment to issues, documents, wiki pages, or project files.",
    inputSchema: objectSchema(
      {
        filename: { type: "string" },
        content_base64: { type: "string" },
        content_type: {
          type: "string",
          default: "application/octet-stream",
        },
      },
      ["filename", "content_base64"]
    ),
  },
  {
    name: "redmine_current_user",
    description: "Get the authenticated Redmine user via /users/current.json.",
    inputSchema: objectSchema({
      include: {
        type: "array",
        items: { type: "string" },
        description: "Optional include values such as memberships or groups.",
      },
    }),
  },
  {
    name: "redmine_search",
    description:
      "Search Redmine with /search.json. Supports standard query params such as q, scope, all_words, titles_only, issues, news, documents, changesets, wiki_pages, messages, projects.",
    inputSchema: objectSchema({
      q: { type: "string" },
      project_id: idSchema,
      scope: { type: "string" },
      all_words: { type: "boolean" },
      titles_only: { type: "boolean" },
      ...paginationToolProperties,
    }),
  },
  resourceTool("redmine_issues", "Manage issues: list, get, create, update, add_note, delete.", [
    "list",
    "get",
    "create",
    "update",
    "add_note",
    "delete",
  ], {
    issue_id: idSchema,
    issue: anyJsonObjectSchema,
    notes: { type: "string" },
    include: arrayOfStringSchema("Issue include values such as journals, attachments, relations, changesets, children, watchers."),
  }),
  resourceTool("redmine_issue_relations", "Manage issue relations: list, create, delete.", [
    "list",
    "create",
    "delete",
  ], {
    issue_id: idSchema,
    relation_id: idSchema,
    relation: anyJsonObjectSchema,
  }),
  resourceTool("redmine_issue_watchers", "Manage issue watchers: add, remove.", [
    "add",
    "remove",
  ], {
    issue_id: idSchema,
    user_id: idSchema,
  }),
  resourceTool("redmine_projects", "Manage projects: list, get, create, update, delete, archive, unarchive.", [
    "list",
    "get",
    "create",
    "update",
    "delete",
    "archive",
    "unarchive",
  ], {
    project_id: idSchema,
    project: anyJsonObjectSchema,
    include: arrayOfStringSchema("Project include values such as trackers, issue_categories, enabled_modules, time_entry_activities."),
  }),
  resourceTool("redmine_memberships", "Manage project memberships: list, get, create, update, delete.", [
    "list",
    "get",
    "create",
    "update",
    "delete",
  ], {
    project_id: idSchema,
    membership_id: idSchema,
    membership: anyJsonObjectSchema,
  }),
  resourceTool("redmine_versions", "Manage project versions: list, get, create, update, delete.", [
    "list",
    "get",
    "create",
    "update",
    "delete",
  ], {
    project_id: idSchema,
    version_id: idSchema,
    version: anyJsonObjectSchema,
  }),
  resourceTool("redmine_time_entries", "Manage time entries: list, get, create, update, delete.", [
    "list",
    "get",
    "create",
    "update",
    "delete",
  ], {
    time_entry_id: idSchema,
    time_entry: anyJsonObjectSchema,
  }),
  resourceTool("redmine_users", "Manage users: list, get, create, update, delete.", [
    "list",
    "get",
    "create",
    "update",
    "delete",
  ], {
    user_id: idSchema,
    user: anyJsonObjectSchema,
    include: arrayOfStringSchema("User include values such as memberships or groups."),
  }),
  resourceTool("redmine_groups", "Manage groups: list, get, create, update, delete, add_user, remove_user.", [
    "list",
    "get",
    "create",
    "update",
    "delete",
    "add_user",
    "remove_user",
  ], {
    group_id: idSchema,
    user_id: idSchema,
    group: anyJsonObjectSchema,
    include: arrayOfStringSchema("Group include values such as users or memberships."),
  }),
  resourceTool("redmine_roles", "Read roles: list, get.", ["list", "get"], {
    role_id: idSchema,
  }),
  resourceTool("redmine_trackers", "Read trackers: list.", ["list"], {}),
  resourceTool("redmine_issue_statuses", "Read issue statuses: list.", ["list"], {}),
  resourceTool("redmine_enumerations", "Read Redmine enumerations: issue_priorities, time_entry_activities, document_categories.", ["list"], {
    resource: {
      type: "string",
      enum: ["issue_priorities", "time_entry_activities", "document_categories"],
    },
  }),
  resourceTool("redmine_custom_fields", "Read custom fields: list.", ["list"], {}),
  resourceTool("redmine_queries", "Read saved issue queries: list.", ["list"], {}),
  resourceTool("redmine_wiki", "Manage project wiki pages: list, get, update, delete.", [
    "list",
    "get",
    "update",
    "delete",
  ], {
    project_id: idSchema,
    title: { type: "string" },
    wiki_page: anyJsonObjectSchema,
    include: arrayOfStringSchema("Wiki include values such as attachments."),
  }),
  resourceTool("redmine_documents", "Manage documents: list, get, create, delete.", [
    "list",
    "get",
    "create",
    "delete",
  ], {
    project_id: idSchema,
    document_id: idSchema,
    document: anyJsonObjectSchema,
  }),
  resourceTool("redmine_files", "Manage project files: list, create.", [
    "list",
    "create",
  ], {
    project_id: idSchema,
    file: anyJsonObjectSchema,
    files: {
      type: "array",
      items: anyJsonObjectSchema,
      description: "Redmine file payloads, usually containing upload tokens.",
    },
  }),
  resourceTool("redmine_news", "Read news: list, get.", ["list", "get"], {
    project_id: idSchema,
    news_id: idSchema,
  }),
  resourceTool("redmine_attachments", "Manage attachments: get, delete.", [
    "get",
    "delete",
  ], {
    attachment_id: idSchema,
  }),
  resourceTool("redmine_issue_categories", "Manage issue categories: list, get, create, update, delete.", [
    "list",
    "get",
    "create",
    "update",
    "delete",
  ], {
    project_id: idSchema,
    category_id: idSchema,
    issue_category: anyJsonObjectSchema,
  }),
];

process.stdin.on("data", (chunk) => {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  processMessages();
});

process.stdin.on("end", () => {
  state.stdinEnded = true;
  processMessages();
  maybeExit();
});

function processMessages() {
  while (true) {
    const headerEnd = state.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (processRawMessage()) continue;
      return;
    }

    const headers = state.buffer.subarray(0, headerEnd).toString("utf8");
    const contentLengthMatch = headers.match(/content-length:\s*(\d+)/i);
    if (!contentLengthMatch) {
      throw new Error("Missing Content-Length header");
    }

    const contentLength = Number(contentLengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (state.buffer.length < messageEnd) return;

    const rawMessage = state.buffer.subarray(messageStart, messageEnd).toString("utf8");
    state.buffer = state.buffer.subarray(messageEnd);

    const pending = handleMessage(rawMessage).catch((error) => {
      sendLog("error", stringifyError(error));
    });
    state.pending.add(pending);
    pending.finally(() => {
      state.pending.delete(pending);
      maybeExit();
    });
  }
}

function processRawMessage() {
  const firstByte = firstNonWhitespaceByte(state.buffer);
  if (firstByte === -1) {
    state.buffer = Buffer.alloc(0);
    return false;
  }

  if (firstByte > 0) {
    state.buffer = state.buffer.subarray(firstByte);
  }

  if (state.buffer[0] !== 123) {
    return false;
  }

  const messageEnd = findJsonObjectEnd(state.buffer);
  if (messageEnd === -1) return false;

  const rawMessage = state.buffer.subarray(0, messageEnd).toString("utf8");
  state.buffer = state.buffer.subarray(messageEnd);
  state.rawMode = true;

  const pending = handleMessage(rawMessage).catch((error) => {
    sendLog("error", stringifyError(error));
  });
  state.pending.add(pending);
  pending.finally(() => {
    state.pending.delete(pending);
    maybeExit();
  });

  return true;
}

function firstNonWhitespaceByte(buffer) {
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (byte !== 9 && byte !== 10 && byte !== 13 && byte !== 32) {
      return i;
    }
  }
  return -1;
}

function findJsonObjectEnd(buffer) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString && byte === 92) {
      escaped = true;
      continue;
    }

    if (byte === 34) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (byte === 123 || byte === 91) {
      depth += 1;
      continue;
    }

    if (byte === 125 || byte === 93) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}

function maybeExit() {
  if (!state.stdinEnded || state.pending.size > 0) return;
  setImmediate(() => process.exit(0));
}

async function handleMessage(rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch (error) {
    sendError(null, -32700, `Parse error: ${error.message}`);
    return;
  }

  if (!message || typeof message !== "object") {
    sendError(null, -32600, "Invalid request");
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    await handleNotification(message);
    return;
  }

  try {
    const result = await routeRequest(message);
    sendResponse(message.id, result);
  } catch (error) {
    const code = Number.isInteger(error.code) ? error.code : -32603;
    sendError(message.id, code, error.message || "Internal error", error.data);
  }
}

async function handleNotification(message) {
  if (message.method === "notifications/initialized") {
    state.initialized = true;
  }
}

async function routeRequest(message) {
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          logging: {},
        },
        serverInfo: {
          name: "redmine-mcp",
          version: SERVER_VERSION,
        },
        instructions:
          "Use named Redmine resource tools for common workflows. Use redmine_api_request for any Redmine REST endpoint, including plugin/version-specific endpoints, and redmine_paginated_request for list endpoints.",
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call":
      return callTool(message.params || {});
    default:
      throw rpcError(-32601, `Method not found: ${message.method}`);
  }
}

async function callTool(params) {
  const name = params.name;
  const args = params.arguments || {};

  switch (name) {
    case "redmine_api_request":
      return toolResult(await redmineApiRequest(args));
    case "redmine_paginated_request":
      return toolResult(await redminePaginatedRequest(args));
    case "redmine_upload_file":
      return toolResult(await redmineUploadFile(args));
    case "redmine_current_user":
      return toolResult(await currentUser(args));
    case "redmine_search":
      return toolResult(await redmineSearch(args));
    case "redmine_issues":
      return toolResult(await issues(args));
    case "redmine_issue_relations":
      return toolResult(await issueRelations(args));
    case "redmine_issue_watchers":
      return toolResult(await issueWatchers(args));
    case "redmine_projects":
      return toolResult(await projects(args));
    case "redmine_memberships":
      return toolResult(await memberships(args));
    case "redmine_versions":
      return toolResult(await versions(args));
    case "redmine_time_entries":
      return toolResult(await timeEntries(args));
    case "redmine_users":
      return toolResult(await users(args));
    case "redmine_groups":
      return toolResult(await groups(args));
    case "redmine_roles":
      return toolResult(await roles(args));
    case "redmine_trackers":
      ensureListAction(args, "redmine_trackers");
      return toolResult(await rest("GET", "/trackers.json"));
    case "redmine_issue_statuses":
      ensureListAction(args, "redmine_issue_statuses");
      return toolResult(await rest("GET", "/issue_statuses.json"));
    case "redmine_enumerations":
      return toolResult(await enumerations(args));
    case "redmine_custom_fields":
      ensureListAction(args, "redmine_custom_fields");
      return toolResult(await rest("GET", "/custom_fields.json"));
    case "redmine_queries":
      ensureListAction(args, "redmine_queries");
      return toolResult(await rest("GET", "/queries.json"));
    case "redmine_wiki":
      return toolResult(await wiki(args));
    case "redmine_documents":
      return toolResult(await documents(args));
    case "redmine_files":
      return toolResult(await files(args));
    case "redmine_news":
      return toolResult(await news(args));
    case "redmine_attachments":
      return toolResult(await attachments(args));
    case "redmine_issue_categories":
      return toolResult(await issueCategories(args));
    default:
      throw rpcError(-32602, `Unknown tool: ${name}`);
  }
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function resourceTool(name, description, actions, properties) {
  return {
    name,
    description,
    inputSchema: objectSchema({
      action: {
        type: "string",
        enum: actions,
      },
      query: querySchema,
      limit: paginationToolProperties.limit,
      max_pages: paginationToolProperties.max_pages,
      headers: headersSchema,
      ...properties,
    }, ["action"]),
  };
}

function arrayOfStringSchema(description) {
  return {
    type: "array",
    items: { type: "string" },
    description,
  };
}

async function redmineApiRequest(args) {
  const method = requiredString(args.method, "method").toUpperCase();
  const path = requiredString(args.path, "path");
  const response = await fetchRedmine(buildRestUrl(path, args.query), {
    method,
    headers: args.headers,
    body: acceptsBody(method) ? args.body : undefined,
    rawBodyBase64: acceptsBody(method) ? args.raw_body_base64 : undefined,
  });

  return formatResponse(response);
}

async function redminePaginatedRequest(args) {
  const path = requiredString(args.path, "path");
  const maxPages = normalizeInteger(args.max_pages, DEFAULT_MAX_PAGES, 1, 1000, "max_pages");
  const limit = normalizeInteger(args.limit, DEFAULT_LIMIT, 1, 1000, "limit");
  const query = { ...(args.query || {}) };

  if (query.limit === undefined) query.limit = limit;
  if (query.offset === undefined) query.offset = 0;

  const pages = [];
  const items = [];
  let pageCount = 0;
  let nextOffset = Number(query.offset);
  let totalCount;

  while (pageCount < maxPages) {
    query.offset = nextOffset;
    const response = await fetchRedmine(buildRestUrl(path, query), {
      method: "GET",
      headers: args.headers,
    });
    const formatted = await formatResponse(response);
    const body = formatted.body && typeof formatted.body === "object" ? formatted.body : {};
    const pageItems = extractItems(body);
    pages.push({
      offset: nextOffset,
      status: formatted.status,
      body: formatted.body,
    });

    if (!response.ok) break;
    if (pageItems.length > 0) items.push(...pageItems);

    totalCount = numberOrUndefined(body.total_count);
    const responseLimit = numberOrUndefined(body.limit) || Number(query.limit);
    const responseOffset = numberOrUndefined(body.offset) || nextOffset;
    nextOffset = responseOffset + responseLimit;
    pageCount += 1;

    if (totalCount === undefined) break;
    if (nextOffset >= totalCount) break;
  }

  return {
    status: pages.length ? pages[pages.length - 1].status : 0,
    page_count: pageCount,
    item_count: items.length,
    total_count: totalCount,
    truncated: totalCount !== undefined && nextOffset < totalCount,
    items,
    pages,
  };
}

async function redmineUploadFile(args) {
  const filename = requiredString(args.filename, "filename");
  const contentBase64 = requiredString(args.content_base64, "content_base64");
  const contentType = typeof args.content_type === "string" && args.content_type
    ? args.content_type
    : "application/octet-stream";
  const response = await fetchRedmine(buildRestUrl("/uploads.json", { filename }), {
    method: "POST",
    rawBodyBase64: contentBase64,
    headers: {
      "Content-Type": contentType,
    },
  });
  return formatResponse(response);
}

async function currentUser(args) {
  return rest("GET", "/users/current.json", includeQuery(args));
}

async function redmineSearch(args) {
  const query = stripHelperArgs(args);
  if (args.project_id !== undefined) query.project_id = args.project_id;
  if (args.q !== undefined) query.q = args.q;
  if (args.scope !== undefined) query.scope = args.scope;
  if (args.all_words !== undefined) query.all_words = args.all_words;
  if (args.titles_only !== undefined) query.titles_only = args.titles_only;
  return redminePaginatedRequest({
    path: "/search.json",
    query,
    limit: args.limit,
    max_pages: args.max_pages,
    headers: args.headers,
  });
}

async function issues(args) {
  switch (requiredAction(args, "redmine_issues")) {
    case "list":
      return paginated("/issues.json", args);
    case "get":
      return rest("GET", `/issues/${encodePathId(args.issue_id)}.json`, includeQuery(args));
    case "create":
      return rest("POST", "/issues.json", undefined, { issue: requiredObject(args.issue, "issue") });
    case "update":
      return rest("PUT", `/issues/${encodePathId(args.issue_id)}.json`, undefined, { issue: requiredObject(args.issue, "issue") });
    case "add_note":
      return rest("PUT", `/issues/${encodePathId(args.issue_id)}.json`, undefined, { issue: { notes: requiredString(args.notes, "notes") } });
    case "delete":
      return rest("DELETE", `/issues/${encodePathId(args.issue_id)}.json`);
  }
}

async function issueRelations(args) {
  switch (requiredAction(args, "redmine_issue_relations")) {
    case "list":
      return rest("GET", `/issues/${encodePathId(args.issue_id)}/relations.json`);
    case "create":
      return rest("POST", `/issues/${encodePathId(args.issue_id)}/relations.json`, undefined, { relation: requiredObject(args.relation, "relation") });
    case "delete":
      return rest("DELETE", `/relations/${encodePathId(args.relation_id)}.json`);
  }
}

async function issueWatchers(args) {
  switch (requiredAction(args, "redmine_issue_watchers")) {
    case "add":
      return rest("POST", `/issues/${encodePathId(args.issue_id)}/watchers.json`, undefined, { user_id: requiredId(args.user_id, "user_id") });
    case "remove":
      return rest("DELETE", `/issues/${encodePathId(args.issue_id)}/watchers/${encodePathId(args.user_id)}.json`);
  }
}

async function projects(args) {
  switch (requiredAction(args, "redmine_projects")) {
    case "list":
      return paginated("/projects.json", args);
    case "get":
      return rest("GET", `/projects/${encodePathId(args.project_id)}.json`, includeQuery(args));
    case "create":
      return rest("POST", "/projects.json", undefined, { project: requiredObject(args.project, "project") });
    case "update":
      return rest("PUT", `/projects/${encodePathId(args.project_id)}.json`, undefined, { project: requiredObject(args.project, "project") });
    case "delete":
      return rest("DELETE", `/projects/${encodePathId(args.project_id)}.json`);
    case "archive":
      return rest("PUT", `/projects/${encodePathId(args.project_id)}/archive.json`);
    case "unarchive":
      return rest("PUT", `/projects/${encodePathId(args.project_id)}/unarchive.json`);
  }
}

async function memberships(args) {
  switch (requiredAction(args, "redmine_memberships")) {
    case "list":
      return paginated(`/projects/${encodePathId(args.project_id)}/memberships.json`, args);
    case "get":
      return rest("GET", `/memberships/${encodePathId(args.membership_id)}.json`);
    case "create":
      return rest("POST", `/projects/${encodePathId(args.project_id)}/memberships.json`, undefined, { membership: requiredObject(args.membership, "membership") });
    case "update":
      return rest("PUT", `/memberships/${encodePathId(args.membership_id)}.json`, undefined, { membership: requiredObject(args.membership, "membership") });
    case "delete":
      return rest("DELETE", `/memberships/${encodePathId(args.membership_id)}.json`);
  }
}

async function versions(args) {
  switch (requiredAction(args, "redmine_versions")) {
    case "list":
      return paginated(`/projects/${encodePathId(args.project_id)}/versions.json`, args);
    case "get":
      return rest("GET", `/versions/${encodePathId(args.version_id)}.json`);
    case "create":
      return rest("POST", `/projects/${encodePathId(args.project_id)}/versions.json`, undefined, { version: requiredObject(args.version, "version") });
    case "update":
      return rest("PUT", `/versions/${encodePathId(args.version_id)}.json`, undefined, { version: requiredObject(args.version, "version") });
    case "delete":
      return rest("DELETE", `/versions/${encodePathId(args.version_id)}.json`);
  }
}

async function timeEntries(args) {
  switch (requiredAction(args, "redmine_time_entries")) {
    case "list":
      return paginated("/time_entries.json", args);
    case "get":
      return rest("GET", `/time_entries/${encodePathId(args.time_entry_id)}.json`);
    case "create":
      return rest("POST", "/time_entries.json", undefined, { time_entry: requiredObject(args.time_entry, "time_entry") });
    case "update":
      return rest("PUT", `/time_entries/${encodePathId(args.time_entry_id)}.json`, undefined, { time_entry: requiredObject(args.time_entry, "time_entry") });
    case "delete":
      return rest("DELETE", `/time_entries/${encodePathId(args.time_entry_id)}.json`);
  }
}

async function users(args) {
  switch (requiredAction(args, "redmine_users")) {
    case "list":
      return paginated("/users.json", args);
    case "get":
      return rest("GET", `/users/${encodePathId(args.user_id)}.json`, includeQuery(args));
    case "create":
      return rest("POST", "/users.json", undefined, { user: requiredObject(args.user, "user") });
    case "update":
      return rest("PUT", `/users/${encodePathId(args.user_id)}.json`, undefined, { user: requiredObject(args.user, "user") });
    case "delete":
      return rest("DELETE", `/users/${encodePathId(args.user_id)}.json`);
  }
}

async function groups(args) {
  switch (requiredAction(args, "redmine_groups")) {
    case "list":
      return paginated("/groups.json", args);
    case "get":
      return rest("GET", `/groups/${encodePathId(args.group_id)}.json`, includeQuery(args));
    case "create":
      return rest("POST", "/groups.json", undefined, { group: requiredObject(args.group, "group") });
    case "update":
      return rest("PUT", `/groups/${encodePathId(args.group_id)}.json`, undefined, { group: requiredObject(args.group, "group") });
    case "delete":
      return rest("DELETE", `/groups/${encodePathId(args.group_id)}.json`);
    case "add_user":
      return rest("POST", `/groups/${encodePathId(args.group_id)}/users.json`, undefined, { user_id: requiredId(args.user_id, "user_id") });
    case "remove_user":
      return rest("DELETE", `/groups/${encodePathId(args.group_id)}/users/${encodePathId(args.user_id)}.json`);
  }
}

async function roles(args) {
  switch (requiredAction(args, "redmine_roles")) {
    case "list":
      return rest("GET", "/roles.json");
    case "get":
      return rest("GET", `/roles/${encodePathId(args.role_id)}.json`);
  }
}

async function enumerations(args) {
  ensureListAction(args, "redmine_enumerations");
  const resource = requiredString(args.resource, "resource");
  if (!["issue_priorities", "time_entry_activities", "document_categories"].includes(resource)) {
    throw rpcError(-32602, "resource must be issue_priorities, time_entry_activities, or document_categories");
  }
  return rest("GET", `/enumerations/${resource}.json`);
}

async function wiki(args) {
  switch (requiredAction(args, "redmine_wiki")) {
    case "list":
      return rest("GET", `/projects/${encodePathId(args.project_id)}/wiki/index.json`);
    case "get":
      return rest("GET", `/projects/${encodePathId(args.project_id)}/wiki/${encodePathId(args.title)}.json`, includeQuery(args));
    case "update":
      return rest("PUT", `/projects/${encodePathId(args.project_id)}/wiki/${encodePathId(args.title)}.json`, undefined, { wiki_page: requiredObject(args.wiki_page, "wiki_page") });
    case "delete":
      return rest("DELETE", `/projects/${encodePathId(args.project_id)}/wiki/${encodePathId(args.title)}.json`);
  }
}

async function documents(args) {
  switch (requiredAction(args, "redmine_documents")) {
    case "list":
      if (args.project_id !== undefined) {
        return paginated(`/projects/${encodePathId(args.project_id)}/documents.json`, args);
      }
      return paginated("/documents.json", args);
    case "get":
      return rest("GET", `/documents/${encodePathId(args.document_id)}.json`);
    case "create":
      return rest("POST", `/projects/${encodePathId(args.project_id)}/documents.json`, undefined, { document: requiredObject(args.document, "document") });
    case "delete":
      return rest("DELETE", `/documents/${encodePathId(args.document_id)}.json`);
  }
}

async function files(args) {
  switch (requiredAction(args, "redmine_files")) {
    case "list":
      return rest("GET", `/projects/${encodePathId(args.project_id)}/files.json`);
    case "create":
      return rest("POST", `/projects/${encodePathId(args.project_id)}/files.json`, undefined, { files: args.files || [requiredObject(args.file, "file")] });
  }
}

async function news(args) {
  switch (requiredAction(args, "redmine_news")) {
    case "list":
      if (args.project_id !== undefined) {
        return paginated(`/projects/${encodePathId(args.project_id)}/news.json`, args);
      }
      return paginated("/news.json", args);
    case "get":
      return rest("GET", `/news/${encodePathId(args.news_id)}.json`);
  }
}

async function attachments(args) {
  switch (requiredAction(args, "redmine_attachments")) {
    case "get":
      return rest("GET", `/attachments/${encodePathId(args.attachment_id)}.json`);
    case "delete":
      return rest("DELETE", `/attachments/${encodePathId(args.attachment_id)}.json`);
  }
}

async function issueCategories(args) {
  switch (requiredAction(args, "redmine_issue_categories")) {
    case "list":
      return rest("GET", `/projects/${encodePathId(args.project_id)}/issue_categories.json`);
    case "get":
      return rest("GET", `/issue_categories/${encodePathId(args.category_id)}.json`);
    case "create":
      return rest("POST", `/projects/${encodePathId(args.project_id)}/issue_categories.json`, undefined, { issue_category: requiredObject(args.issue_category, "issue_category") });
    case "update":
      return rest("PUT", `/issue_categories/${encodePathId(args.category_id)}.json`, undefined, { issue_category: requiredObject(args.issue_category, "issue_category") });
    case "delete":
      return rest("DELETE", `/issue_categories/${encodePathId(args.category_id)}.json`);
  }
}

async function rest(method, path, query, body) {
  const response = await fetchRedmine(buildRestUrl(path, query), {
    method,
    body,
  });
  return formatResponse(response);
}

async function paginated(path, args) {
  return redminePaginatedRequest({
    path,
    query: stripHelperArgs(args),
    limit: args.limit,
    max_pages: args.max_pages,
    headers: args.headers,
  });
}

function includeQuery(args) {
  const query = { ...(args.query || {}) };
  if (Array.isArray(args.include) && args.include.length > 0) {
    query.include = args.include.join(",");
  }
  return query;
}

function stripHelperArgs(args) {
  const query = { ...(args.query || {}) };
  for (const [key, value] of Object.entries(args)) {
    if ([
      "action",
      "query",
      "headers",
      "limit",
      "max_pages",
      "include",
      "issue",
      "project",
      "membership",
      "version",
      "time_entry",
      "user",
      "group",
      "wiki_page",
      "document",
      "file",
      "files",
      "relation",
      "issue_category",
    ].includes(key)) {
      continue;
    }
    if (value !== undefined) query[key] = value;
  }
  return query;
}

function extractItems(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  for (const [key, value] of Object.entries(body)) {
    if (["limit", "offset", "total_count"].includes(key)) continue;
    if (Array.isArray(value)) return value;
  }
  return [];
}

function numberOrUndefined(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function encodePathId(value) {
  if (value === undefined || value === null || value === "") {
    throw rpcError(-32602, "Required Redmine ID/identifier value is missing");
  }
  return encodeURIComponent(String(value));
}

function requiredAction(args, toolName) {
  return requiredString(args.action, `${toolName}.action`);
}

function ensureListAction(args, toolName) {
  const action = requiredAction(args, toolName);
  if (action !== "list") {
    throw rpcError(-32602, `${toolName}.action must be list`);
  }
}

function requiredId(value, name) {
  if (value === undefined || value === null || value === "") {
    throw rpcError(-32602, `${name} is required`);
  }
  return value;
}

function requiredObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw rpcError(-32602, `${name} must be an object`);
  }
  return value;
}

async function fetchRedmine(url, options) {
  const headers = {
    Accept: "application/json",
    "User-Agent": `redmine-mcp/${SERVER_VERSION}`,
    ...(options.headers || {}),
  };
  applyAuth(headers);

  const init = {
    method: options.method,
    headers,
  };

  if (options.rawBodyBase64 !== undefined) {
    init.body = Buffer.from(String(options.rawBodyBase64), "base64");
    if (!hasHeader(headers, "content-type")) {
      headers["Content-Type"] = "application/octet-stream";
    }
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    if (!hasHeader(headers, "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }

  return fetch(url, init);
}

async function formatResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();
  const body = parseBody(rawBody, contentType);

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: selectedHeaders(response.headers),
    body,
  };
}

function buildRestUrl(path, query) {
  if (!path.startsWith("/")) {
    throw rpcError(-32602, "path must start with /");
  }

  if (/^https?:\/\//i.test(path)) {
    throw rpcError(-32602, "path must be relative to REDMINE_URL, not an absolute URL");
  }

  const base = getRedmineBaseUrl();
  const basePath = base.pathname.replace(/\/$/, "");
  const url = new URL(`${basePath}${path}`, `${base.protocol}//${base.host}`);
  appendQuery(url.searchParams, query || {});
  return url;
}

function appendQuery(searchParams, query) {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) searchParams.append(key, String(item));
      }
      continue;
    }
    searchParams.set(key, String(value));
  }
}

function getRedmineBaseUrl() {
  const rawUrl = process.env.REDMINE_URL || process.env.REDMINE_BASE_URL;
  if (!rawUrl) {
    throw rpcError(-32602, "Missing REDMINE_URL in the MCP server config environment.");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw rpcError(-32602, "REDMINE_URL must be a valid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw rpcError(-32602, "REDMINE_URL must use http or https");
  }

  return url;
}

function applyAuth(headers) {
  if (hasHeader(headers, "x-redmine-api-key") || hasHeader(headers, "authorization")) {
    return;
  }

  const apiKey =
    process.env.REDMINE_API_KEY ||
    process.env.REDMINE_TOKEN ||
    process.env.REDMINE_ACCESS_TOKEN;
  if (apiKey) {
    headers["X-Redmine-API-Key"] = apiKey;
    return;
  }

  const username = process.env.REDMINE_USERNAME;
  const password = process.env.REDMINE_PASSWORD;
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
    return;
  }

  throw rpcError(
    -32602,
    "Missing Redmine credentials. Set REDMINE_API_KEY or REDMINE_USERNAME/REDMINE_PASSWORD in the MCP server config environment."
  );
}

function selectedHeaders(headers) {
  const result = {};
  for (const name of [
    "content-type",
    "etag",
    "last-modified",
    "x-redmine-api-version",
    "retry-after",
  ]) {
    const value = headers.get(name);
    if (value !== null) result[name] = value;
  }
  return result;
}

function parseBody(rawBody, contentType) {
  if (!rawBody) return null;
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody.slice(0, MAX_BODY_PREVIEW_CHARS);
    }
  }
  return rawBody.slice(0, MAX_BODY_PREVIEW_CHARS);
}

function toolResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function sendResponse(id, result) {
  sendMessage({
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  sendMessage({
    jsonrpc: JSON_RPC_VERSION,
    id,
    error,
  });
}

function sendLog(level, data) {
  sendMessage({
    jsonrpc: JSON_RPC_VERSION,
    method: "notifications/message",
    params: {
      level,
      logger: "redmine-mcp",
      data,
    },
  });
}

function sendMessage(message) {
  const body = JSON.stringify(message);
  if (state.rawMode) {
    process.stdout.write(`${body}\n`);
    return;
  }
  const byteLength = Buffer.byteLength(body, "utf8");
  process.stdout.write(`Content-Length: ${byteLength}\r\n\r\n${body}`);
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw rpcError(-32602, `${name} must be a non-empty string`);
  }
  return value;
}

function normalizeInteger(value, defaultValue, min, max, name) {
  if (value === undefined || value === null) return defaultValue;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw rpcError(-32602, `${name} must be an integer between ${min} and ${max}`);
  }
  return normalized;
}

function acceptsBody(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function hasHeader(headers, name) {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

function rpcError(code, message, data) {
  const error = new Error(message);
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

function stringifyError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  return String(error);
}
