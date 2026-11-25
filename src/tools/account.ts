import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PterodactylClient } from "../client.js";
import { type ActivityLogAttributes, summarizeActivity, withToolHandler } from "../format.js";

interface AccountAttributes {
  id: number;
  admin: boolean;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  language: string;
}

interface SubuserAttributes {
  uuid: string;
  username: string;
  email: string;
  "2fa_enabled": boolean;
  created_at: string;
  permissions: string[];
}

interface ApiKeyAttributes {
  identifier: string;
  description: string;
  allowed_ips: string[];
  last_used_at: string | null;
  created_at: string;
}

interface SshKeyAttributes {
  name: string;
  fingerprint: string;
  public_key: string;
  created_at: string;
}

interface PermissionsResponse {
  attributes: {
    permissions: Record<
      string,
      {
        description: string;
        keys: Record<string, string>;
      }
    >;
  };
}

function summarizeSubuser(u: SubuserAttributes) {
  return {
    uuid: u.uuid,
    username: u.username,
    email: u.email,
    two_factor_enabled: u["2fa_enabled"],
    permissions: u.permissions,
    created_at: u.created_at,
  };
}

export function registerAccountTools(server: McpServer, client: PterodactylClient): void {
  server.registerTool(
    "get_account",
    {
      description: "Get the authenticated HostMyBot/Pterodactyl account details.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async () => {
      const res = await client.request<{ attributes: AccountAttributes }>(
        "GET",
        "/api/client/account",
      );
      return res.attributes;
    }),
  );

  server.registerTool(
    "list_subusers",
    {
      description: "List subusers and their permissions on a server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id }) => {
      const res = await client.request<{ data: Array<{ attributes: SubuserAttributes }> }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/users`,
      );
      return {
        users: res.data.map((u) => ({
          uuid: u.attributes.uuid,
          username: u.attributes.username,
          email: u.attributes.email,
          two_factor_enabled: u.attributes["2fa_enabled"],
          permissions: u.attributes.permissions,
          created_at: u.attributes.created_at,
        })),
      };
    }),
  );

  server.registerTool(
    "create_subuser",
    {
      description: "Invite a subuser to a server with explicit Pterodactyl permission strings.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        email: z.string().email().describe("Email address of the subuser to invite"),
        permissions: z
          .array(z.string().min(1))
          .min(1)
          .describe("Permission nodes, e.g. ['control.console', 'file.read']"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, email, permissions }) => {
      const res = await client.request<{ attributes: SubuserAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/users`,
        { body: { email, permissions } },
      );
      return {
        uuid: res.attributes.uuid,
        username: res.attributes.username,
        email: res.attributes.email,
        permissions: res.attributes.permissions,
      };
    }),
  );

  server.registerTool(
    "delete_subuser",
    {
      description: "Remove a subuser from a server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        user_uuid: z.string().min(1).describe("Subuser UUID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id, user_uuid }) => {
      await client.request(
        "DELETE",
        `/api/client/servers/${encodeURIComponent(server_id)}/users/${encodeURIComponent(user_uuid)}`,
      );
      return { ok: true, removed_user_uuid: user_uuid };
    }),
  );

  server.registerTool(
    "get_subuser",
    {
      description: "Get details and permissions for a single server subuser.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        user_uuid: z.string().min(1).describe("Subuser UUID"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, user_uuid }) => {
      const res = await client.request<{ attributes: SubuserAttributes }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/users/${encodeURIComponent(user_uuid)}`,
      );
      return summarizeSubuser(res.attributes);
    }),
  );

  server.registerTool(
    "update_subuser",
    {
      description: "Replace the permission nodes assigned to an existing server subuser.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        user_uuid: z.string().min(1).describe("Subuser UUID"),
        permissions: z
          .array(z.string().min(1))
          .min(1)
          .describe("Full list of permission nodes (e.g. ['control.console', 'file.read'])"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    withToolHandler(async ({ server_id, user_uuid, permissions }) => {
      const res = await client.request<{ attributes: SubuserAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/users/${encodeURIComponent(user_uuid)}`,
        { body: { permissions } },
      );
      return summarizeSubuser(res.attributes);
    }),
  );

  server.registerTool(
    "list_permissions",
    {
      description:
        "List valid Pterodactyl permission nodes (useful before creating/updating subusers). Optionally filter by category.",
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe("Optional category prefix filter (e.g. 'file', 'control', 'backup', 'schedule')"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ category }) => {
      const res = await client.request<PermissionsResponse>("GET", "/api/client/permissions");
      const all = res.attributes.permissions;
      const categories = Object.entries(all)
        .filter(([cat]) => !category || cat.toLowerCase() === category.toLowerCase())
        .map(([cat, info]) => ({
          category: cat,
          description: info.description,
          nodes: Object.entries(info.keys).map(([key, desc]) => ({
            permission: `${cat}.${key}`,
            description: desc,
          })),
        }));
      return { categories };
    }),
  );

  server.registerTool(
    "get_account_activity",
    {
      description: "Get recent audit activity logs for the authenticated HostMyBot account.",
      inputSchema: {
        page: z.number().int().min(1).optional().describe("Pagination page (default 1)"),
        per_page: z.number().int().min(1).max(100).optional().describe("Entries per page"),
        event: z.string().optional().describe("Optional event filter (e.g. 'auth:success')"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ page, per_page, event }) => {
      const res = await client.request<{
        data: Array<{ attributes: ActivityLogAttributes }>;
        meta?: { pagination?: Record<string, unknown> };
      }>("GET", "/api/client/account/activity", {
        query: {
          page,
          per_page,
          "filter[event]": event,
        },
      });
      return {
        events: res.data.map((item) => summarizeActivity(item.attributes)),
        pagination: res.meta?.pagination,
      };
    }),
  );

  server.registerTool(
    "list_api_keys",
    {
      description: "List client API keys associated with the authenticated account.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async () => {
      const res = await client.request<{ data: Array<{ attributes: ApiKeyAttributes }> }>(
        "GET",
        "/api/client/account/api-keys",
      );
      return { api_keys: res.data.map((k) => k.attributes) };
    }),
  );

  server.registerTool(
    "create_api_key",
    {
      description: "Create a new client API key on the account (returns the secret token once).",
      inputSchema: {
        description: z.string().min(1).describe("Label describing what the API key is for"),
        allowed_ips: z
          .array(z.string())
          .optional()
          .describe("Optional CIDR/IP allowlist (leave empty for any IP)"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ description, allowed_ips = [] }) => {
      const res = await client.request<{
        attributes: ApiKeyAttributes;
        meta?: { secret_token?: string };
      }>("POST", "/api/client/account/api-keys", {
        body: { description, allowed_ips },
      });
      return {
        ...res.attributes,
        secret_token: res.meta?.secret_token,
      };
    }),
  );

  server.registerTool(
    "delete_api_key",
    {
      description: "DESTRUCTIVE: Revoke and delete a client API key by its identifier prefix.",
      inputSchema: {
        identifier: z.string().min(1).describe("API key identifier (e.g. 'ptlc_abc123...')"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ identifier }) => {
      await client.request(
        "DELETE",
        `/api/client/account/api-keys/${encodeURIComponent(identifier)}`,
      );
      return { ok: true, deleted_identifier: identifier };
    }),
  );

  server.registerTool(
    "list_ssh_keys",
    {
      description: "List SFTP SSH public keys registered on the account.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async () => {
      const res = await client.request<{ data: Array<{ attributes: SshKeyAttributes }> }>(
        "GET",
        "/api/client/account/ssh-keys",
      );
      return { ssh_keys: res.data.map((k) => k.attributes) };
    }),
  );

  server.registerTool(
    "add_ssh_key",
    {
      description: "Register a new SSH public key on the account for SFTP access.",
      inputSchema: {
        name: z.string().min(1).describe("Human-readable label for the SSH key"),
        public_key: z.string().min(1).describe("OpenSSH public key string"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ name, public_key }) => {
      const res = await client.request<{ attributes: SshKeyAttributes }>(
        "POST",
        "/api/client/account/ssh-keys",
        { body: { name, public_key } },
      );
      return res.attributes;
    }),
  );

  server.registerTool(
    "remove_ssh_key",
    {
      description: "DESTRUCTIVE: Remove an SSH public key from the account by fingerprint.",
      inputSchema: {
        fingerprint: z.string().min(1).describe("SHA256 fingerprint of the SSH key"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ fingerprint }) => {
      await client.request("POST", "/api/client/account/ssh-keys/remove", {
        body: { fingerprint },
      });
      return { ok: true, removed_fingerprint: fingerprint };
    }),
  );
}
