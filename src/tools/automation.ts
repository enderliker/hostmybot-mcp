import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PterodactylClient } from "../client.js";
import { formatBytes, withToolHandler } from "../format.js";

interface BackupAttributes {
  uuid: string;
  name: string;
  is_successful: boolean;
  is_locked: boolean;
  bytes: number;
  created_at: string;
  completed_at: string | null;
}

interface ScheduleTaskAttributes {
  id: number;
  sequence_id: number;
  action: string;
  payload: string;
  time_offset: number;
  continue_on_failure: boolean;
}

interface ScheduleAttributes {
  id: number;
  name: string;
  cron: {
    minute: string;
    hour: string;
    day_of_month: string;
    month: string;
    day_of_week: string;
  };
  is_active: boolean;
  is_processing: boolean;
  only_when_online: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  relationships?: {
    tasks?: { data: Array<{ attributes: ScheduleTaskAttributes }> };
  };
}

function summarizeBackup(b: BackupAttributes) {
  return {
    uuid: b.uuid,
    name: b.name,
    is_successful: b.is_successful,
    is_locked: b.is_locked,
    size: formatBytes(b.bytes),
    bytes: b.bytes,
    created_at: b.created_at,
    completed_at: b.completed_at,
  };
}

function summarizeSchedule(s: ScheduleAttributes) {
  return {
    id: s.id,
    name: s.name,
    cron: `${s.cron.minute} ${s.cron.hour} ${s.cron.day_of_month} ${s.cron.month} ${s.cron.day_of_week}`,
    is_active: s.is_active,
    is_processing: s.is_processing,
    only_when_online: s.only_when_online,
    last_run_at: s.last_run_at,
    next_run_at: s.next_run_at,
    tasks: s.relationships?.tasks?.data.map((t) => ({
      id: t.attributes.id,
      sequence_id: t.attributes.sequence_id,
      action: t.attributes.action,
      payload: t.attributes.payload,
      time_offset: t.attributes.time_offset,
    })),
  };
}

export function registerAutomationTools(server: McpServer, client: PterodactylClient): void {
  server.registerTool(
    "list_backups",
    {
      description: "List existing backups for a server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        page: z.number().int().min(1).optional().describe("Pagination page (default 1)"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, page }) => {
      const res = await client.request<{
        data: Array<{ attributes: BackupAttributes }>;
        meta?: { backup_count?: number };
      }>("GET", `/api/client/servers/${encodeURIComponent(server_id)}/backups`, {
        query: { page },
      });
      return {
        backup_count: res.meta?.backup_count ?? res.data.length,
        backups: res.data.map((b) => summarizeBackup(b.attributes)),
      };
    }),
  );

  server.registerTool(
    "create_backup",
    {
      description: "Create a new backup on the server (subject to server backup limits).",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        name: z.string().optional().describe("Optional backup name"),
        ignored: z.string().optional().describe("Newline-separated files/patterns to ignore"),
        is_locked: z.boolean().optional().describe("Lock backup to prevent accidental deletion"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, name, ignored, is_locked }) => {
      const res = await client.request<{ attributes: BackupAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/backups`,
        { body: { name, ignored, is_locked } },
      );
      return summarizeBackup(res.attributes);
    }),
  );

  server.registerTool(
    "get_backup_download_url",
    {
      description: "Generate a temporary download URL for a specific backup.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        backup_uuid: z.string().min(1).describe("Backup UUID"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, backup_uuid }) => {
      const res = await client.request<{ attributes: { url: string } }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/backups/${encodeURIComponent(backup_uuid)}/download`,
      );
      return { backup_uuid, download_url: res.attributes.url };
    }),
  );

  server.registerTool(
    "restore_backup",
    {
      description:
        "Restore a server backup. Setting truncate=true wipes all existing server files before restoring.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        backup_uuid: z.string().min(1).describe("Backup UUID to restore"),
        truncate: z
          .boolean()
          .optional()
          .describe("Delete all existing files before restoring (default false)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id, backup_uuid, truncate = false }) => {
      await client.request(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/backups/${encodeURIComponent(backup_uuid)}/restore`,
        { body: { truncate } },
      );
      return { ok: true, server_id, backup_uuid, truncate };
    }),
  );

  server.registerTool(
    "delete_backup",
    {
      description: "Permanently delete a backup from the server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        backup_uuid: z.string().min(1).describe("Backup UUID to delete"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id, backup_uuid }) => {
      await client.request(
        "DELETE",
        `/api/client/servers/${encodeURIComponent(server_id)}/backups/${encodeURIComponent(backup_uuid)}`,
      );
      return { ok: true, deleted_backup_uuid: backup_uuid };
    }),
  );

  server.registerTool(
    "list_schedules",
    {
      description: "List scheduled cron tasks configured on a server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id }) => {
      const res = await client.request<{ data: Array<{ attributes: ScheduleAttributes }> }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules`,
      );
      return { schedules: res.data.map((s) => summarizeSchedule(s.attributes)) };
    }),
  );

  server.registerTool(
    "create_schedule",
    {
      description: "Create a recurring cron schedule on a server (add tasks with create_schedule_task).",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        name: z.string().min(1).describe("Schedule name"),
        minute: z.string().min(1).describe("Cron minute field (e.g. '0', '*/15', '*')"),
        hour: z.string().min(1).describe("Cron hour field (e.g. '4', '*')"),
        day_of_month: z.string().min(1).describe("Cron day of month field (e.g. '*')"),
        month: z.string().min(1).describe("Cron month field (e.g. '*')"),
        day_of_week: z.string().min(1).describe("Cron day of week field (e.g. '*')"),
        is_active: z.boolean().optional().describe("Whether schedule is enabled (default true)"),
        only_when_online: z
          .boolean()
          .optional()
          .describe("Run only when server is online (default true)"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({
      server_id,
      name,
      minute,
      hour,
      day_of_month,
      month,
      day_of_week,
      is_active = true,
      only_when_online = true,
    }) => {
      const res = await client.request<{ attributes: ScheduleAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules`,
        {
          body: {
            name,
            minute,
            hour,
            day_of_month,
            month,
            day_of_week,
            is_active,
            only_when_online,
          },
        },
      );
      return summarizeSchedule(res.attributes);
    }),
  );

  server.registerTool(
    "create_schedule_task",
    {
      description: "Add an action task ('command', 'power', or 'backup') to an existing schedule.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        schedule_id: z.number().int().min(1).describe("Numeric schedule ID"),
        action: z.enum(["command", "power", "backup"]).describe("Task action type"),
        payload: z
          .string()
          .describe("Console command, power signal ('start'|'stop'|'restart'|'kill'), or ignored files for backup"),
        time_offset: z.number().int().min(0).max(900).optional().describe("Delay in seconds (default 0)"),
        continue_on_failure: z.boolean().optional().describe("Continue next tasks if this fails (default false)"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({
      server_id,
      schedule_id,
      action,
      payload,
      time_offset = 0,
      continue_on_failure = false,
    }) => {
      const res = await client.request<{ attributes: ScheduleTaskAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules/${schedule_id}/tasks`,
        { body: { action, payload, time_offset, continue_on_failure } },
      );
      return res.attributes;
    }),
  );

  server.registerTool(
    "execute_schedule",
    {
      description: "Manually trigger a schedule immediately.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        schedule_id: z.number().int().min(1).describe("Numeric schedule ID"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, schedule_id }) => {
      await client.request(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules/${schedule_id}/execute`,
      );
      return { ok: true, server_id, schedule_id, triggered: true };
    }),
  );

  server.registerTool(
    "delete_schedule",
    {
      description: "Delete a scheduled cron task from a server.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        schedule_id: z.number().int().min(1).describe("Numeric schedule ID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id, schedule_id }) => {
      await client.request(
        "DELETE",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules/${schedule_id}`,
      );
      return { ok: true, deleted_schedule_id: schedule_id };
    }),
  );

  server.registerTool(
    "get_backup",
    {
      description: "Get metadata for a single server backup by UUID.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        backup_uuid: z.string().min(1).describe("Backup UUID"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, backup_uuid }) => {
      const res = await client.request<{ attributes: BackupAttributes }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/backups/${encodeURIComponent(backup_uuid)}`,
      );
      return summarizeBackup(res.attributes);
    }),
  );

  server.registerTool(
    "toggle_backup_lock",
    {
      description: "Toggle the lock status of a backup (locked backups cannot be deleted until unlocked).",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        backup_uuid: z.string().min(1).describe("Backup UUID"),
      },
      annotations: { readOnlyHint: false },
    },
    withToolHandler(async ({ server_id, backup_uuid }) => {
      const res = await client.request<{ attributes: BackupAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/backups/${encodeURIComponent(backup_uuid)}/lock`,
      );
      return summarizeBackup(res.attributes);
    }),
  );

  server.registerTool(
    "get_schedule",
    {
      description: "Get details and tasks for a single schedule ID.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        schedule_id: z.number().int().min(1).describe("Numeric schedule ID"),
      },
      annotations: { readOnlyHint: true },
    },
    withToolHandler(async ({ server_id, schedule_id }) => {
      const res = await client.request<{ attributes: ScheduleAttributes }>(
        "GET",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules/${schedule_id}`,
      );
      return summarizeSchedule(res.attributes);
    }),
  );

  server.registerTool(
    "update_schedule",
    {
      description: "Update an existing cron schedule's name, cron expression, or activation flags.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        schedule_id: z.number().int().min(1).describe("Numeric schedule ID"),
        name: z.string().min(1).describe("Schedule name"),
        minute: z.string().min(1).describe("Cron minute field"),
        hour: z.string().min(1).describe("Cron hour field"),
        day_of_month: z.string().min(1).describe("Cron day of month field"),
        month: z.string().min(1).describe("Cron month field"),
        day_of_week: z.string().min(1).describe("Cron day of week field"),
        is_active: z.boolean().optional().describe("Whether schedule is enabled (default true)"),
        only_when_online: z
          .boolean()
          .optional()
          .describe("Run only when server is online (default true)"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    withToolHandler(async ({
      server_id,
      schedule_id,
      name,
      minute,
      hour,
      day_of_month,
      month,
      day_of_week,
      is_active = true,
      only_when_online = true,
    }) => {
      const res = await client.request<{ attributes: ScheduleAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules/${schedule_id}`,
        {
          body: {
            name,
            minute,
            hour,
            day_of_month,
            month,
            day_of_week,
            is_active,
            only_when_online,
          },
        },
      );
      return summarizeSchedule(res.attributes);
    }),
  );

  server.registerTool(
    "update_schedule_task",
    {
      description: "Update an existing action task inside a schedule.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        schedule_id: z.number().int().min(1).describe("Numeric schedule ID"),
        task_id: z.number().int().min(1).describe("Numeric task ID"),
        action: z.enum(["command", "power", "backup"]).describe("Task action type"),
        payload: z.string().describe("Command, power signal, or ignored files for backup"),
        time_offset: z.number().int().min(0).max(900).optional().describe("Delay in seconds (default 0)"),
        continue_on_failure: z.boolean().optional().describe("Continue next tasks if this fails (default false)"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    withToolHandler(async ({
      server_id,
      schedule_id,
      task_id,
      action,
      payload,
      time_offset = 0,
      continue_on_failure = false,
    }) => {
      const res = await client.request<{ attributes: ScheduleTaskAttributes }>(
        "POST",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules/${schedule_id}/tasks/${task_id}`,
        { body: { action, payload, time_offset, continue_on_failure } },
      );
      return res.attributes;
    }),
  );

  server.registerTool(
    "delete_schedule_task",
    {
      description: "Delete a specific task from a schedule.",
      inputSchema: {
        server_id: z.string().min(1).describe("Short server identifier"),
        schedule_id: z.number().int().min(1).describe("Numeric schedule ID"),
        task_id: z.number().int().min(1).describe("Numeric task ID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    withToolHandler(async ({ server_id, schedule_id, task_id }) => {
      await client.request(
        "DELETE",
        `/api/client/servers/${encodeURIComponent(server_id)}/schedules/${schedule_id}/tasks/${task_id}`,
      );
      return { ok: true, deleted_task_id: task_id };
    }),
  );
}
