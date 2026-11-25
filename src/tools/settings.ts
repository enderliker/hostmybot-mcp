import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PterodactylClient } from "../client.js";
import { withToolHandler } from "../format.js";

interface StartupVariableAttributes {
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  server_value: string | null;
  is_editable: boolean;
  rules: string;
}

interface StartupResponse {
  data: Array<{ attributes: StartupVariableAttributes }>;
  meta?: {
    startup_command?: string;
    raw_startup_command?: string;
    docker_images?: Record<string, string>;
  };
}

interface AllocationAttributes {
  id: number;
  ip: string;
  ip_alias: string | null;
  port: number;
  notes: string | null;
  is_default: boolean;
}

export function registerSettingsTools(server: McpServer, client: PterodactylClient): void {
  server.registerTool(
    "get_startup_variables",
    {
      description:
        "Get the server's startup command, available Docker images, and environment variables.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id }) => {
      const res = await client.request<StartupResponse>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/startup`,
      );
      return {
        startup_command: res.meta?.startup_command,
        docker_images: res.meta?.docker_images,
        variables: res.data.map((v) => ({
          key: v.attributes.env_variable,
          name: v.attributes.name,
          value: v.attributes.server_value ?? v.attributes.default_value,
          default_value: v.attributes.default_value,
          is_editable: v.attributes.is_editable,
          rules: v.attributes.rules,
        })),
      };
    }),
  );

  server.registerTool(
    "update_startup_variable",
    {
      description: "Update an editable startup environment variable (e.g. MAIN_FILE, NODE_PACKAGES).",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        key: z.string().min(1).describe("Environment variable key (e.g. 'MAIN_FILE')"),
        value: z.string().describe("New value for the variable"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    withToolHandler(async ({ server_id, key, value }) => {
      const res = await client.request<{ attributes: StartupVariableAttributes }>(
        "PUT",
        `/api/client/servers/${encodeURIComponent(server_id)}/startup/variable`,
        { body: { key, value } },
      );
      const attr = res.attributes;
      return {
        key: attr.env_variable,
        value: attr.server_value ?? attr.default_value,
        default_value: attr.default_value,
        is_editable: attr.is_editable,
      };
    }),
  );

  server.registerTool(
    "rename_server",
    {
      description: "Rename a server and optionally update its description.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        name: z.string().min(1).describe("New server name"),
        description: z.string().optional().describe("Optional new server description"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    withToolHandler(async ({ server_id, name, description }) => {
      await client.request(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/settings/rename`,
        { body: { name, description } },
      );
      return { ok: true, server_id, name, description };
    }),
  );

  server.registerTool(
    "set_docker_image",
    {
      description: "Change the server's Docker runtime image (must be one allowed by the egg).",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        docker_image: z.string().min(1).describe("Docker image string"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    withToolHandler(async ({ server_id, docker_image }) => {
      await client.request(
        "PUT",
        `/api/client/servers/${encodeURIComponent(server_id)}/settings/docker-image`,
        { body: { docker_image } },
      );
      return { ok: true, server_id, docker_image };
    }),
  );

  server.registerTool(
    "reinstall_server",
    {
      description:
        "DESTRUCTIVE: Trigger a full server reinstall script. Existing files may be overwritten. Requires confirm=true.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        confirm: z.literal(true).describe("Must be true to confirm reinstalling the server"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id }) => {
      await client.request(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/settings/reinstall`,
      );
      return { ok: true, server_id, status: "reinstalling" };
    }),
  );

  server.registerTool(
    "list_allocations",
    {
      description: "List IP and port network allocations assigned to a server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id }) => {
      const res = await client.request<{ data: Array<{ attributes: AllocationAttributes }> }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/network/allocations`,
      );
      return {
        allocations: res.data.map((a) => ({
          id: a.attributes.id,
          ip: a.attributes.ip,
          ip_alias: a.attributes.ip_alias,
          port: a.attributes.port,
          notes: a.attributes.notes,
          is_default: a.attributes.is_default,
        })),
      };
    }),
  );
}
