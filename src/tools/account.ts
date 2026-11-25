import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PterodactylClient } from "../client.js";
import { withToolHandler } from "../format.js";

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
}
