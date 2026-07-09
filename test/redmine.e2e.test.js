import assert from "node:assert/strict";
import test from "node:test";
import { loadTestEnv } from "./load-env-file.js";
import { createMcpClient } from "./mcp-test-client.js";

loadTestEnv(process.env.REDMINE_TEST_ENV_FILE || ".env.test");

const e2eEnabled = process.env.REDMINE_E2E === "1";
const redmineUrl = process.env.REDMINE_E2E_URL || process.env.REDMINE_URL;
const redmineApiKey =
  process.env.REDMINE_E2E_API_KEY ||
  process.env.REDMINE_API_KEY ||
  process.env.REDMINE_TOKEN ||
  process.env.REDMINE_ACCESS_TOKEN;
const configuredNewsId = process.env.REDMINE_E2E_NEWS_ID;

const skipReason = e2eEnabled && redmineUrl && redmineApiKey
  ? false
  : "set REDMINE_E2E=1 plus REDMINE_E2E_URL/REDMINE_E2E_API_KEY or REDMINE_URL/REDMINE_API_KEY";

test("live Redmine e2e covers all tool actions and removes created records", {
  skip: skipReason,
  timeout: 180000,
}, async () => {
  const suffix = `${Date.now()}-${process.pid}`;
  const projectIdentifier = `redmine-mcp-e2e-${suffix}`;
  const projectName = `redmine-mcp e2e ${suffix}`;
  const userLogin = `rme2e${Date.now()}${process.pid}`.slice(0, 60);
  const userMail = `${userLogin}@example.invalid`;
  const groupName = `redmine-mcp e2e ${suffix}`.slice(0, 255);
  const cleanup = [];
  const coveredTools = new Set();
  const coveredActions = new Map();
  const coveredMethods = new Map();

  const client = createMcpClient({
    env: {
      REDMINE_URL: redmineUrl,
      REDMINE_API_KEY: redmineApiKey,
    },
    timeoutMs: 60000,
  });

  let projectWasCreated = false;

  try {
    const toolList = await client.request("tools/list");

    const currentUser = await callTool(client, coveredTools, coveredMethods, "redmine_current_user", {});
    const currentUserId = requiredEntity(currentUser, "user").id;

    await callTool(client, coveredTools, coveredMethods, "redmine_paginated_request", {
      path: "/projects.json",
      limit: 1,
      max_pages: 1,
    });
    await callTool(client, coveredTools, coveredMethods, "redmine_search", {
      q: projectIdentifier,
      limit: 1,
      max_pages: 1,
    });

    const roles = await callAction(client, coveredTools, coveredActions, "redmine_roles", "list");
    const role = firstBodyItem(roles, "roles", "roles");
    await callAction(client, coveredTools, coveredActions, "redmine_roles", "get", {
      role_id: String(role.id),
    });

    const trackers = await callAction(client, coveredTools, coveredActions, "redmine_trackers", "list");
    const tracker = firstBodyItem(trackers, "trackers", "trackers");

    await callAction(client, coveredTools, coveredActions, "redmine_issue_statuses", "list");
    await callAction(client, coveredTools, coveredActions, "redmine_custom_fields", "list");
    await callAction(client, coveredTools, coveredActions, "redmine_queries", "list");

    const priorities = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_enumerations",
      "list",
      { resource: "issue_priorities" }
    );
    const priority = firstBodyItem(priorities, "issue_priorities", "issue priorities");

    const activities = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_enumerations",
      "list",
      { resource: "time_entry_activities" }
    );
    const activity = firstBodyItem(activities, "time_entry_activities", "time entry activities");

    const documentCategories = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_enumerations",
      "list",
      { resource: "document_categories" }
    );
    const documentCategory = firstBodyItem(documentCategories, "document_categories", "document categories");

    const newsList = await callAction(client, coveredTools, coveredActions, "redmine_news", "list", {
      limit: 1,
      max_pages: 1,
    });
    const newsId = configuredNewsId || firstOptionalId(newsList, "news") || "0";
    await callAction(client, coveredTools, coveredActions, "redmine_news", "get", {
      news_id: String(newsId),
    }, configuredNewsId || newsId !== "0" ? undefined : [401, 403, 404]);

    const project = await callAction(client, coveredTools, coveredActions, "redmine_projects", "create", {
      project: {
        name: projectName,
        identifier: projectIdentifier,
        description: "Temporary project created by redmine-mcp e2e tests.",
        is_public: false,
        enabled_module_names: ["issue_tracking", "time_tracking", "wiki", "documents", "files", "news"],
      },
    }, [200, 201]);
    const projectId = requiredEntity(project, "project").id;
    projectWasCreated = true;
    defer(cleanup, "delete project", () => cleanupAction(client, "redmine_projects", {
      action: "delete",
      project_id: projectIdentifier,
    }));

    await callAction(client, coveredTools, coveredActions, "redmine_projects", "get", {
      project_id: projectIdentifier,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_projects", "list", {
      query: { name: projectName },
      limit: 5,
      max_pages: 1,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_projects", "update", {
      project_id: projectIdentifier,
      project: { description: "Updated by redmine-mcp e2e tests." },
    });
    await callAction(client, coveredTools, coveredActions, "redmine_projects", "archive", {
      project_id: String(projectId),
    }, [200, 204, 403, 404]);
    await callAction(client, coveredTools, coveredActions, "redmine_projects", "unarchive", {
      project_id: String(projectId),
    }, [200, 204, 403, 404]);

    await callTool(client, coveredTools, coveredMethods, "redmine_api_request", {
      method: "GET",
      path: `/projects/${projectIdentifier}.json`,
    });
    await callTool(client, coveredTools, coveredMethods, "redmine_api_request", {
      method: "HEAD",
      path: `/projects/${projectIdentifier}.json`,
    });
    const apiCategory = await callTool(client, coveredTools, coveredMethods, "redmine_api_request", {
      method: "POST",
      path: `/projects/${projectIdentifier}/issue_categories.json`,
      body: { issue_category: { name: `api ${suffix}` } },
    }, [200, 201]);
    const apiCategoryId = requiredEntity(apiCategory, "issue_category").id;
    defer(cleanup, "delete api issue category", () => cleanupAction(client, "redmine_api_request", {
      method: "DELETE",
      path: `/issue_categories/${apiCategoryId}.json`,
    }));
    await callTool(client, coveredTools, coveredMethods, "redmine_api_request", {
      method: "PUT",
      path: `/issue_categories/${apiCategoryId}.json`,
      body: { issue_category: { name: `api updated ${suffix}` } },
    });
    await callTool(client, coveredTools, coveredMethods, "redmine_api_request", {
      method: "PATCH",
      path: `/projects/${projectIdentifier}.json`,
      body: { project: { description: "Patched by redmine-mcp e2e tests." } },
    });

    const user = await callAction(client, coveredTools, coveredActions, "redmine_users", "create", {
      user: {
        login: userLogin,
        firstname: "RedmineMcp",
        lastname: "E2E",
        mail: userMail,
        password: `RedmineMcp-${suffix}-A1!`,
        must_change_passwd: false,
      },
    }, [200, 201]);
    const userId = requiredEntity(user, "user").id;
    defer(cleanup, "delete user", () => cleanupAction(client, "redmine_users", {
      action: "delete",
      user_id: String(userId),
    }));
    await callAction(client, coveredTools, coveredActions, "redmine_users", "list", {
      query: { name: userLogin },
      limit: 5,
      max_pages: 1,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_users", "get", {
      user_id: String(userId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_users", "update", {
      user_id: String(userId),
      user: { lastname: "E2EUpdated" },
    });

    const group = await callAction(client, coveredTools, coveredActions, "redmine_groups", "create", {
      group: { name: groupName },
    }, [200, 201]);
    const groupId = requiredEntity(group, "group").id;
    defer(cleanup, "delete group", () => cleanupAction(client, "redmine_groups", {
      action: "delete",
      group_id: String(groupId),
    }));
    await callAction(client, coveredTools, coveredActions, "redmine_groups", "list", {
      query: { name: groupName },
      limit: 5,
      max_pages: 1,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_groups", "get", {
      group_id: String(groupId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_groups", "update", {
      group_id: String(groupId),
      group: { name: `${groupName} updated`.slice(0, 255) },
    });
    await callAction(client, coveredTools, coveredActions, "redmine_groups", "add_user", {
      group_id: String(groupId),
      user_id: String(userId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_groups", "remove_user", {
      group_id: String(groupId),
      user_id: String(userId),
    });

    const membership = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_memberships",
      "create",
      {
        project_id: projectIdentifier,
        membership: {
          user_id: String(userId),
          role_ids: [String(role.id)],
        },
      },
      [200, 201]
    );
    const membershipId = requiredEntity(membership, "membership").id;
    defer(cleanup, "delete membership", () => cleanupAction(client, "redmine_memberships", {
      action: "delete",
      membership_id: String(membershipId),
    }));
    await callAction(client, coveredTools, coveredActions, "redmine_memberships", "list", {
      project_id: projectIdentifier,
      limit: 10,
      max_pages: 1,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_memberships", "get", {
      membership_id: String(membershipId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_memberships", "update", {
      membership_id: String(membershipId),
      membership: { role_ids: [String(role.id)] },
    });

    const version = await callAction(client, coveredTools, coveredActions, "redmine_versions", "create", {
      project_id: projectIdentifier,
      version: { name: `v-${suffix}`, status: "open" },
    }, [200, 201]);
    const versionId = requiredEntity(version, "version").id;
    defer(cleanup, "delete version", () => cleanupAction(client, "redmine_versions", {
      action: "delete",
      version_id: String(versionId),
    }));
    await callAction(client, coveredTools, coveredActions, "redmine_versions", "list", {
      project_id: projectIdentifier,
      limit: 10,
      max_pages: 1,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_versions", "get", {
      version_id: String(versionId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_versions", "update", {
      version_id: String(versionId),
      version: { name: `v-${suffix}-updated` },
    });

    const category = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_issue_categories",
      "create",
      {
        project_id: projectIdentifier,
        issue_category: { name: `category ${suffix}` },
      },
      [200, 201]
    );
    const categoryId = requiredEntity(category, "issue_category").id;
    defer(cleanup, "delete issue category", () => cleanupAction(client, "redmine_issue_categories", {
      action: "delete",
      category_id: String(categoryId),
    }));
    await callAction(client, coveredTools, coveredActions, "redmine_issue_categories", "list", {
      project_id: projectIdentifier,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_issue_categories", "get", {
      category_id: String(categoryId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_issue_categories", "update", {
      category_id: String(categoryId),
      issue_category: { name: `category ${suffix} updated` },
    });

    const issueOne = await createIssue(client, coveredTools, coveredActions, {
      projectIdentifier,
      trackerId: tracker.id,
      priorityId: priority.id,
      subject: `redmine-mcp e2e issue one ${suffix}`,
    });
    const issueOneId = requiredEntity(issueOne, "issue").id;
    defer(cleanup, "delete issue one", () => cleanupAction(client, "redmine_issues", {
      action: "delete",
      issue_id: String(issueOneId),
    }));

    const issueTwo = await createIssue(client, coveredTools, coveredActions, {
      projectIdentifier,
      trackerId: tracker.id,
      priorityId: priority.id,
      subject: `redmine-mcp e2e issue two ${suffix}`,
    });
    const issueTwoId = requiredEntity(issueTwo, "issue").id;
    defer(cleanup, "delete issue two", () => cleanupAction(client, "redmine_issues", {
      action: "delete",
      issue_id: String(issueTwoId),
    }));

    await callAction(client, coveredTools, coveredActions, "redmine_issues", "list", {
      query: { project_id: projectIdentifier, status_id: "*" },
      limit: 10,
      max_pages: 1,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_issues", "get", {
      issue_id: String(issueOneId),
      include: ["journals", "attachments", "relations", "watchers"],
    });
    await callAction(client, coveredTools, coveredActions, "redmine_issues", "update", {
      issue_id: String(issueOneId),
      issue: { subject: `redmine-mcp e2e issue one updated ${suffix}` },
    });
    const originalNote = `Temporary note from redmine-mcp e2e test ${suffix}.`;
    const updatedNote = `Updated temporary note from redmine-mcp e2e test ${suffix}.`;
    await callAction(client, coveredTools, coveredActions, "redmine_issues", "add_note", {
      issue_id: String(issueOneId),
      notes: originalNote,
    });
    const issueWithOriginalNote = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_issues",
      "get",
      {
        issue_id: String(issueOneId),
        include: ["journals"],
      }
    );
    const journalId = String(findJournalByNotes(issueWithOriginalNote, originalNote).id);
    const journalUpdate = await callAction(client, coveredTools, coveredActions, "redmine_issue_journals", "update", {
      journal_id: journalId,
      notes: updatedNote,
    });
    assert.ok(
      journalUpdate.status === 200 || journalUpdate.status === 204,
      `redmine_issue_journals.update must succeed; got ${journalUpdate.status}`
    );
    const issueWithUpdatedNote = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_issues",
      "get",
      {
        issue_id: String(issueOneId),
        include: ["journals"],
      }
    );
    findJournalByNotes(issueWithUpdatedNote, updatedNote);
    const journalDelete = await callAction(client, coveredTools, coveredActions, "redmine_issue_journals", "delete", {
      journal_id: journalId,
    });
    assert.ok(
      journalDelete.status === 200 || journalDelete.status === 204,
      `redmine_issue_journals.delete must succeed; got ${journalDelete.status}`
    );
    const issueWithoutDeletedNote = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_issues",
      "get",
      {
        issue_id: String(issueOneId),
        include: ["journals"],
      }
    );
    assert.equal(findOptionalJournalByNotes(issueWithoutDeletedNote, updatedNote), undefined);
    assert.equal(findOptionalJournalByNotes(issueWithoutDeletedNote, originalNote), undefined);

    await callAction(client, coveredTools, coveredActions, "redmine_issue_relations", "list", {
      issue_id: String(issueOneId),
    });
    const relation = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_issue_relations",
      "create",
      {
        issue_id: String(issueOneId),
        relation: {
          issue_to_id: String(issueTwoId),
          relation_type: "relates",
        },
      },
      [200, 201]
    );
    const relationId = requiredEntity(relation, "relation").id;
    defer(cleanup, "delete issue relation", () => cleanupAction(client, "redmine_issue_relations", {
      action: "delete",
      relation_id: String(relationId),
    }));

    await callAction(client, coveredTools, coveredActions, "redmine_issue_watchers", "add", {
      issue_id: String(issueOneId),
      user_id: String(userId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_issue_watchers", "remove", {
      issue_id: String(issueOneId),
      user_id: String(userId),
    });

    const timeEntry = await callAction(
      client,
      coveredTools,
      coveredActions,
      "redmine_time_entries",
      "create",
      {
        time_entry: {
          issue_id: String(issueOneId),
          hours: 0.25,
          activity_id: String(activity.id),
          spent_on: new Date().toISOString().slice(0, 10),
          comments: `redmine-mcp e2e ${suffix}`,
        },
      },
      [200, 201]
    );
    const timeEntryId = requiredEntity(timeEntry, "time_entry").id;
    defer(cleanup, "delete time entry", () => cleanupAction(client, "redmine_time_entries", {
      action: "delete",
      time_entry_id: String(timeEntryId),
    }));
    await callAction(client, coveredTools, coveredActions, "redmine_time_entries", "list", {
      query: { project_id: projectIdentifier },
      limit: 10,
      max_pages: 1,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_time_entries", "get", {
      time_entry_id: String(timeEntryId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_time_entries", "update", {
      time_entry_id: String(timeEntryId),
      time_entry: { comments: `redmine-mcp e2e updated ${suffix}` },
    });

    const upload = await callTool(client, coveredTools, coveredMethods, "redmine_upload_file", {
      filename: `attachment-${suffix}.txt`,
      content_base64: Buffer.from(`redmine-mcp e2e attachment ${suffix}`).toString("base64"),
      content_type: "application/octet-stream",
    }, [200, 201]);
    const uploadToken = requiredEntity(upload, "upload").token;
    await callAction(client, coveredTools, coveredActions, "redmine_issues", "update", {
      issue_id: String(issueOneId),
      issue: {
        uploads: [{
          token: uploadToken,
          filename: `attachment-${suffix}.txt`,
          content_type: "text/plain",
        }],
      },
    });
    const issueWithAttachment = await callAction(client, coveredTools, coveredActions, "redmine_issues", "get", {
      issue_id: String(issueOneId),
      include: ["attachments"],
    });
    const attachment = findByFilename(
      requiredEntity(issueWithAttachment, "issue").attachments,
      `attachment-${suffix}.txt`
    );
    defer(cleanup, "delete attachment", () => cleanupAction(client, "redmine_attachments", {
      action: "delete",
      attachment_id: String(attachment.id),
    }));
    await callAction(client, coveredTools, coveredActions, "redmine_attachments", "get", {
      attachment_id: String(attachment.id),
    });

    await callAction(client, coveredTools, coveredActions, "redmine_documents", "list", {
      project_id: projectIdentifier,
      limit: 10,
      max_pages: 1,
    }, [200, 401, 403, 404]);
    const document = await callAction(client, coveredTools, coveredActions, "redmine_documents", "create", {
      project_id: projectIdentifier,
      document: {
        title: `redmine-mcp e2e document ${suffix}`,
        category_id: String(documentCategory.id),
        description: "Temporary document from redmine-mcp e2e test.",
      },
    }, [200, 201, 401, 403, 404]);
    const documentId = document.status === 200 || document.status === 201
      ? requiredEntity(document, "document").id
      : "0";
    if (documentId !== "0") {
      defer(cleanup, "delete document", () => cleanupAction(client, "redmine_documents", {
        action: "delete",
        document_id: String(documentId),
      }));
    }
    await callAction(client, coveredTools, coveredActions, "redmine_documents", "get", {
      document_id: String(documentId),
    }, documentId === "0" ? [401, 403, 404] : undefined);

    const fileUpload = await callTool(client, coveredTools, coveredMethods, "redmine_upload_file", {
      filename: `file-${suffix}.txt`,
      content_base64: Buffer.from(`redmine-mcp e2e file ${suffix}`).toString("base64"),
      content_type: "application/octet-stream",
    }, [200, 201]);
    await callAction(client, coveredTools, coveredActions, "redmine_files", "create", {
      project_id: projectIdentifier,
      file: {
        token: requiredEntity(fileUpload, "upload").token,
        filename: `file-${suffix}.txt`,
        description: "Temporary project file from redmine-mcp e2e test.",
        version_id: String(versionId),
      },
    }, [200, 201, 403, 404]);
    await callAction(client, coveredTools, coveredActions, "redmine_files", "list", {
      project_id: projectIdentifier,
    }, [200, 401, 403, 404]);

    const wikiTitle = `E2E ${suffix}`;
    await callAction(client, coveredTools, coveredActions, "redmine_wiki", "update", {
      project_id: projectIdentifier,
      title: wikiTitle,
      wiki_page: {
        text: `Temporary wiki page from redmine-mcp e2e ${suffix}`,
        comments: "create temporary page",
      },
    });
    defer(cleanup, "delete wiki page", () => cleanupAction(client, "redmine_wiki", {
      action: "delete",
      project_id: projectIdentifier,
      title: wikiTitle,
    }));
    await callAction(client, coveredTools, coveredActions, "redmine_wiki", "list", {
      project_id: projectIdentifier,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_wiki", "get", {
      project_id: projectIdentifier,
      title: wikiTitle,
    });

    await callAction(client, coveredTools, coveredActions, "redmine_attachments", "delete", {
      attachment_id: String(attachment.id),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_wiki", "delete", {
      project_id: projectIdentifier,
      title: wikiTitle,
    });
    await callAction(client, coveredTools, coveredActions, "redmine_documents", "delete", {
      document_id: String(documentId),
    }, documentId === "0" ? [401, 403, 404] : undefined);
    await callAction(client, coveredTools, coveredActions, "redmine_issue_relations", "delete", {
      relation_id: String(relationId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_time_entries", "delete", {
      time_entry_id: String(timeEntryId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_issues", "delete", {
      issue_id: String(issueTwoId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_issues", "delete", {
      issue_id: String(issueOneId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_issue_categories", "delete", {
      category_id: String(categoryId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_versions", "delete", {
      version_id: String(versionId),
    });
    await callTool(client, coveredTools, coveredMethods, "redmine_api_request", {
      method: "DELETE",
      path: `/issue_categories/${apiCategoryId}.json`,
    }, [200, 204, 403, 404]);
    await callAction(client, coveredTools, coveredActions, "redmine_memberships", "delete", {
      membership_id: String(membershipId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_projects", "delete", {
      project_id: projectIdentifier,
    });
    projectWasCreated = false;

    await callAction(client, coveredTools, coveredActions, "redmine_groups", "delete", {
      group_id: String(groupId),
    });
    await callAction(client, coveredTools, coveredActions, "redmine_users", "delete", {
      user_id: String(userId),
    });

    await assertProjectIsGone(client, coveredTools, coveredMethods, projectIdentifier);
    assertCoverage(toolList.tools, coveredTools, coveredActions, coveredMethods);
    assert.ok(currentUserId, "current user id should be present");
    assert.ok(projectId, "project create response should contain an id");
  } finally {
    const cleanupErrors = await runCleanup(cleanup);
    if (projectWasCreated) {
      await assertProjectIsGoneBestEffort(
        client,
        coveredTools,
        coveredMethods,
        projectIdentifier,
        cleanupErrors
      );
    }
    await client.close();
    assert.deepEqual(cleanupErrors, []);
  }
});

async function createIssue(client, coveredTools, coveredActions, {
  projectIdentifier,
  trackerId,
  priorityId,
  subject,
}) {
  return callAction(client, coveredTools, coveredActions, "redmine_issues", "create", {
    issue: {
      project_id: projectIdentifier,
      tracker_id: String(trackerId),
      priority_id: String(priorityId),
      subject,
    },
  }, [200, 201]);
}

async function callAction(client, coveredTools, coveredActions, tool, action, args = {}, okStatuses) {
  markAction(coveredActions, tool, action);
  return callTool(client, coveredTools, undefined, tool, { action, ...args }, okStatuses);
}

async function callTool(client, coveredTools, coveredMethods, tool, args, okStatuses = [200, 201, 204]) {
  coveredTools.add(tool);
  if (coveredMethods && typeof args.method === "string") {
    markOperation(coveredMethods, tool, args.method.toUpperCase());
  }
  const result = await client.callTool(tool, args);
  assertStatus(result, okStatuses, `${tool} ${JSON.stringify(args)}`);
  return result;
}

async function cleanupAction(client, tool, args) {
  const result = await client.callTool(tool, args);
  assertStatus(result, [200, 201, 204, 404], `cleanup ${tool} ${JSON.stringify(args)}`);
}

function defer(cleanup, label, fn) {
  cleanup.push({ label, fn });
}

async function runCleanup(cleanup) {
  const errors = [];
  for (const entry of cleanup.reverse()) {
    try {
      await entry.fn();
    } catch (error) {
      errors.push(`${entry.label}: ${error.message}`);
    }
  }
  return errors;
}

async function assertProjectIsGone(client, coveredTools, coveredMethods, projectIdentifier) {
  let lastResult;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    coveredTools.add("redmine_api_request");
    markOperation(coveredMethods, "redmine_api_request", "GET");
    lastResult = await client.callTool("redmine_api_request", {
      method: "GET",
      path: `/projects/${projectIdentifier}.json`,
    });
    if (lastResult.status === 404) return;
    await sleep(1000);
  }
  assertStatus(lastResult, [404], `verify project cleanup ${projectIdentifier}`);
}

async function assertProjectIsGoneBestEffort(
  client,
  coveredTools,
  coveredMethods,
  projectIdentifier,
  cleanupErrors
) {
  try {
    await assertProjectIsGone(client, coveredTools, coveredMethods, projectIdentifier);
  } catch (error) {
    cleanupErrors.push(`verify project cleanup: ${error.message}`);
  }
}

function assertStatus(result, okStatuses, label) {
  assert.ok(
    okStatuses.includes(result.status),
    `${label} returned ${result.status}: ${JSON.stringify(result.body)}`
  );
}

function requiredEntity(result, key) {
  assert.ok(result.body && typeof result.body === "object", `response body must contain ${key}`);
  assert.ok(result.body[key], `response body must contain ${key}`);
  return result.body[key];
}

function firstBodyItem(result, key, label) {
  const items = result.body?.[key];
  assert.ok(Array.isArray(items) && items.length > 0, `Redmine must have at least one ${label}`);
  return items[0];
}

function firstOptionalId(result, key) {
  const items = result.body?.[key];
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items[0].id;
}

function findByFilename(items, filename) {
  assert.ok(Array.isArray(items), `expected attachments array to contain ${filename}`);
  const item = items.find((candidate) => candidate.filename === filename);
  assert.ok(item, `expected attachment ${filename} to exist`);
  return item;
}

function findJournalByNotes(result, notes) {
  const journal = findOptionalJournalByNotes(result, notes);
  assert.ok(journal, `expected issue journal note to exist: ${notes}`);
  return journal;
}

function findOptionalJournalByNotes(result, notes) {
  const journals = result.body?.issue?.journals;
  assert.ok(Array.isArray(journals), "expected issue journals array");
  return journals.find((journal) => journal.notes === notes);
}

function markAction(coveredActions, tool, action) {
  markOperation(coveredActions, tool, action);
}

function markOperation(coveredActions, tool, action) {
  const actions = coveredActions.get(tool) || new Set();
  actions.add(action);
  coveredActions.set(tool, actions);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertCoverage(tools, coveredTools, coveredActions, coveredMethods) {
  const missingTools = [];
  const missingActions = [];
  const missingMethods = [];

  for (const tool of tools) {
    if (!coveredTools.has(tool.name)) missingTools.push(tool.name);

    const actions = tool.inputSchema?.properties?.action?.enum;
    if (Array.isArray(actions)) {
      const covered = coveredActions.get(tool.name) || new Set();
      for (const action of actions) {
        if (!covered.has(action)) missingActions.push(`${tool.name}.${action}`);
      }
    }

    const methods = tool.inputSchema?.properties?.method?.enum;
    if (!Array.isArray(methods)) continue;

    const covered = coveredMethods.get(tool.name) || new Set();
    for (const method of methods) {
      if (!covered.has(method)) missingMethods.push(`${tool.name}.${method}`);
    }
  }

  assert.deepEqual(missingTools, [], "live e2e must call every listed tool");
  assert.deepEqual(missingActions, [], "live e2e must call every listed tool action");
  assert.deepEqual(missingMethods, [], "live e2e must call every listed tool method");
}
