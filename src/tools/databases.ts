import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PterodactylClient } from "../client.js";
import { withToolHandler } from "../format.js";

interface DatabaseAttributes {
  id: string;
  name: string;
  username: string;
  connections_from: string;
  max_connections: number;
  host?: { address: string; port: number };
  relationships?: {
    password?: { attributes?: { password?: string } };
  };
}

function summarizeDatabase(db: DatabaseAttributes, includePassword: boolean) {
  return {
    id: db.id,
    name: db.name,
    username: db.username,
    host: db.host ? `${db.host.address}:${db.host.port}` : undefined,
    connections_from: db.connections_from,
    max_connections: db.max_connections,
    password: includePassword ? db.relationships?.password?.attributes?.password : undefined,
  };
}

export function registerDatabaseTools(server: McpServer, client: PterodactylClient): void {
  server.registerTool(
    "list_databases",
    {
      description:
        "List MySQL/MariaDB databases provisioned on a server. Pass include_password=true only when credentials are needed.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        include_password: z
          .boolean()
          .optional()
          .describe("Include database passwords in response (default false)"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, include_password = false }) => {
      const res = await client.request<{ data: Array<{ attributes: DatabaseAttributes }> }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/databases`,
        { query: include_password ? { include: "password" } : undefined },
      );
      return {
        databases: res.data.map((d) => summarizeDatabase(d.attributes, include_password)),
      };
    }),
  );

  server.registerTool(
    "create_database",
    {
      description: "Create a new database on a server (subject to server database limits).",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        database: z.string().min(1).describe("Database name suffix"),
        remote: z
          .string()
          .optional()
          .describe("Allowed remote connection host wildcard (default '%')"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, database, remote = "%" }) => {
      const res = await client.request<{ attributes: DatabaseAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/databases`,
        { body: { database, remote } },
      );
      return summarizeDatabase(res.attributes, true);
    }),
  );

  server.registerTool(
    "rotate_database_password",
    {
      description: "Rotate the password for an existing server database and return the new password.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        database_id: z.string().min(1).describe("Database ID"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, database_id }) => {
      const res = await client.request<{ attributes: DatabaseAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/databases/${encodeURIComponent(database_id)}/rotate-password`,
      );
      return summarizeDatabase(res.attributes, true);
    }),
  );

  server.registerTool(
    "delete_database",
    {
      description: "DESTRUCTIVE: Permanently delete a database and all of its data.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        database_id: z.string().min(1).describe("Database ID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id, database_id }) => {
      await client.request(
        "DELETE",
        `/api/client/servers/${encodeURIComponent(server_id)}/databases/${encodeURIComponent(database_id)}`,
      );
      return { ok: true, deleted_database_id: database_id };
    }),
  );
}
