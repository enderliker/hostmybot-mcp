import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PterodactylClient } from "../client.js";
import {
  type ActivityLogAttributes,
  formatBytes,
  summarizeActivity,
  withToolHandler,
} from "../format.js";

interface PterodactylListResponse<T> {
  data: Array<{ attributes: T }>;
  meta?: {
    pagination?: {
      total: number;
      count: number;
      per_page: number;
      current_page: number;
      total_pages: number;
    };
  };
}

interface ServerAttributes {
  identifier: string;
  uuid: string;
  name: string;
  description?: string;
  node: string;
  server_owner: boolean;
  status: string | null;
  is_suspended: boolean;
  is_installing: boolean;
  is_transferring?: boolean;
  sftp_details?: { ip: string; port: number };
  limits: {
    memory: number;
    swap: number;
    disk: number;
    io: number;
    cpu: number;
  };
  feature_limits?: {
    databases: number;
    allocations: number;
    backups: number;
  };
  docker_image?: string;
  relationships?: {
    allocations?: {
      data: Array<{
        attributes: {
          id: number;
          ip: string;
          ip_alias?: string | null;
          port: number;
          notes?: string | null;
          is_default: boolean;
        };
      }>;
    };
    egg?: {
      attributes?: { uuid: string; name: string };
    };
    variables?: {
      data: Array<{
        attributes: {
          name: string;
          env_variable: string;
          default_value: string;
          server_value: string | null;
          is_editable: boolean;
        };
      }>;
    };
  };
}

interface ResourcesResponse {
  attributes: {
    current_state: string;
    is_suspended: boolean;
    resources: {
      memory_bytes: number;
      cpu_absolute: number;
      disk_bytes: number;
      network_rx_bytes: number;
      network_tx_bytes: number;
      uptime: number;
    };
  };
}

function summarizeServer(attr: ServerAttributes) {
  const allocations = attr.relationships?.allocations?.data.map((a) => ({
    id: a.attributes.id,
    address: `${a.attributes.ip_alias || a.attributes.ip}:${a.attributes.port}`,
    is_default: a.attributes.is_default,
  }));
  const primary = allocations?.find((a) => a.is_default)?.address ?? allocations?.[0]?.address;

  return {
    identifier: attr.identifier,
    name: attr.name,
    node: attr.node,
    status: attr.status ?? "unknown",
    is_suspended: attr.is_suspended,
    is_installing: attr.is_installing,
    primary_address: primary,
    sftp: attr.sftp_details ? `${attr.sftp_details.ip}:${attr.sftp_details.port}` : undefined,
    limits: {
      memory_mb: attr.limits.memory,
      disk_mb: attr.limits.disk,
      cpu_percent: attr.limits.cpu,
    },
    egg: attr.relationships?.egg?.attributes?.name,
  };
}

export function registerServerTools(server: McpServer, client: PterodactylClient): void {
  server.registerTool(
    "list_servers",
    {
      description:
        "List all HostMyBot/Pterodactyl servers accessible by the configured API key, returning compact server summaries and identifiers.",
      inputSchema: {
        page: z.number().int().min(1).optional().describe("Page number for pagination (default 1)"),
        per_page: z.number().int().min(1).max(100).optional().describe("Results per page (1-100)"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ page, per_page }) => {
      const res = await client.request<PterodactylListResponse<ServerAttributes>>("GET", "/api/client", {
        query: { page, per_page },
      });
      return {
        servers: res.data.map((item) => summarizeServer(item.attributes)),
        pagination: res.meta?.pagination,
      };
    }),
  );

  server.registerTool(
    "get_server",
    {
      description:
        "Get detailed configuration, allocations, limits, and SFTP details for a specific server identifier.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier (e.g. '00000000')"),
        include_variables: z
          .boolean()
          .optional()
          .describe("Include startup egg variables in response (default false to save tokens)"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, include_variables }) => {
      const res = await client.request<{ attributes: ServerAttributes }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}`,
      );
      const attr = res.attributes;
      return {
        ...summarizeServer(attr),
        uuid: attr.uuid,
        description: attr.description,
        is_owner: attr.server_owner,
        docker_image: attr.docker_image,
        feature_limits: attr.feature_limits,
        allocations: attr.relationships?.allocations?.data.map((a) => a.attributes),
        variables: include_variables
          ? attr.relationships?.variables?.data.map((v) => ({
              key: v.attributes.env_variable,
              name: v.attributes.name,
              value: v.attributes.server_value ?? v.attributes.default_value,
              is_editable: v.attributes.is_editable,
            }))
          : undefined,
      };
    }),
  );

  server.registerTool(
    "get_server_resources",
    {
      description:
        "Check live server state (running/offline/starting/stopping) and current CPU, memory, disk, network, and uptime usage.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier (e.g. '00000000')"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id }) => {
      const res = await client.request<ResourcesResponse>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/resources`,
      );
      const { current_state, is_suspended, resources } = res.attributes;
      return {
        state: current_state,
        is_suspended,
        cpu_percent: Number(resources.cpu_absolute.toFixed(2)),
        memory: formatBytes(resources.memory_bytes),
        memory_bytes: resources.memory_bytes,
        disk: formatBytes(resources.disk_bytes),
        disk_bytes: resources.disk_bytes,
        network_rx: formatBytes(resources.network_rx_bytes),
        network_tx: formatBytes(resources.network_tx_bytes),
        uptime_seconds: Math.floor(resources.uptime / 1000),
      };
    }),
  );

  server.registerTool(
    "send_power_signal",
    {
      description:
        "Send a power signal ('start', 'stop', 'restart', or 'kill') to a server. Note: 'kill' forcefully terminates the process.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        signal: z.enum(["start", "stop", "restart", "kill"]).describe("Power signal to send"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id, signal }) => {
      await client.request("POST", `/api/client/servers/${encodeURIComponent(server_id)}/power`, {
        body: { signal },
      });
      return { ok: true, server_id, signal };
    }),
  );

  server.registerTool(
    "send_console_command",
    {
      description: "Send a console command to a running server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        command: z.string().min(1).describe("Command string to execute in the server console"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, command }) => {
      await client.request("POST", `/api/client/servers/${encodeURIComponent(server_id)}/command`, {
        body: { command },
      });
      return { ok: true, server_id, command };
    }),
  );

  server.registerTool(
    "get_websocket_credentials",
    {
      description: "Get the Wings WebSocket URL and JWT token for live console streaming.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id }) => client.getWebsocketCredentials(server_id)),
  );

  server.registerTool(
    "get_console_logs",
    {
      description:
        "Connect briefly to the server WebSocket console, retrieve recent console output lines, and disconnect cleanly.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        max_lines: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Maximum number of trailing log lines to return (default 100)"),
        timeout_ms: z
          .number()
          .int()
          .min(300)
          .max(15000)
          .optional()
          .describe("Maximum wait window in ms before disconnecting (default 2500)"),
        strip_ansi: z
          .boolean()
          .optional()
          .describe("Strip ANSI terminal color sequences to reduce token usage (default true)"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, max_lines, timeout_ms, strip_ansi }) =>
      client.readConsoleLogs(server_id, {
        maxLines: max_lines,
        timeoutMs: timeout_ms,
        stripAnsi: strip_ansi,
      }),
    ),
  );

  server.registerTool(
    "get_server_activity",
    {
      description: "Get recent activity audit logs for a specific server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        page: z.number().int().min(1).optional().describe("Pagination page (default 1)"),
        per_page: z.number().int().min(1).max(100).optional().describe("Entries per page"),
        event: z.string().optional().describe("Optional event filter (e.g. 'server:file.write')"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, page, per_page, event }) => {
      const res = await client.request<PterodactylListResponse<ActivityLogAttributes>>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/activity`,
        {
          query: {
            page,
            per_page,
            "filter[event]": event,
          },
        },
      );
      return {
        events: res.data.map((item) => summarizeActivity(item.attributes)),
        pagination: res.meta?.pagination,
      };
    }),
  );
}
