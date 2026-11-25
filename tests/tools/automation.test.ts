import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { PterodactylClient } from "../../src/client.js";
import { createHostMyBotServer } from "../../src/index.js";

async function setupClient(fetchMock: typeof fetch) {
  const api = new PterodactylClient(
    { apiKey: "ptlc_test", baseUrl: "https://client.hostmybot.net" },
    fetchMock,
  );
  const mcpServer = createHostMyBotServer(api);
  const mcpClient = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return { mcpClient };
}

describe("automation tools (backups & schedules)", () => {
  it("list_backups and create_backup return compact backup info", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            meta: { backup_count: 1 },
            data: [
              {
                attributes: {
                  uuid: "bkp-1",
                  name: "nightly",
                  is_successful: true,
                  is_locked: false,
                  bytes: 1048576,
                  created_at: "2026-01-01T00:00:00Z",
                  completed_at: "2026-01-01T00:01:00Z",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attributes: {
              uuid: "bkp-2",
              name: "manual",
              is_successful: false,
              is_locked: true,
              bytes: 0,
              created_at: "2026-01-02T00:00:00Z",
              completed_at: null,
            },
          }),
          { status: 200 },
        ),
      );

    const { mcpClient } = await setupClient(fetchMock);
    const listRes = await mcpClient.callTool({
      name: "list_backups",
      arguments: { server_id: "00000000" },
    });
    const listJson = JSON.parse((listRes.content as Array<{ text: string }>)[0].text);
    expect(listJson.backup_count).toBe(1);
    expect(listJson.backups[0].size).toBe("1.00 MB");

    const createRes = await mcpClient.callTool({
      name: "create_backup",
      arguments: { server_id: "00000000", name: "manual", is_locked: true },
    });
    expect(JSON.parse((createRes.content as Array<{ text: string }>)[0].text).uuid).toBe("bkp-2");
  });

  it("list_schedules, create_schedule, and execute_schedule work properly", async () => {
    const schedulePayload = {
      attributes: {
        id: 7,
        name: "Daily Restart",
        cron: { minute: "0", hour: "4", day_of_month: "*", month: "*", day_of_week: "*" },
        is_active: true,
        is_processing: false,
        only_when_online: true,
        last_run_at: null,
        next_run_at: "2026-01-02T04:00:00Z",
        relationships: { tasks: { data: [] } },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [schedulePayload] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(schedulePayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { mcpClient } = await setupClient(fetchMock);

    const listRes = await mcpClient.callTool({
      name: "list_schedules",
      arguments: { server_id: "00000000" },
    });
    expect(JSON.parse((listRes.content as Array<{ text: string }>)[0].text).schedules[0].cron).toBe(
      "0 4 * * *",
    );

    await mcpClient.callTool({
      name: "create_schedule",
      arguments: {
        server_id: "00000000",
        name: "Daily Restart",
        minute: "0",
        hour: "4",
        day_of_month: "*",
        month: "*",
        day_of_week: "*",
      },
    });
    const execRes = await mcpClient.callTool({
      name: "execute_schedule",
      arguments: { server_id: "00000000", schedule_id: 7 },
    });
    expect(JSON.parse((execRes.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      server_id: "00000000",
      schedule_id: 7,
      triggered: true,
    });
  });
});
