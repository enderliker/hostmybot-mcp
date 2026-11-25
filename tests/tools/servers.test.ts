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
  return { mcpClient, mcpServer };
}

describe("server tools", () => {
  it("list_servers returns compact server summaries without invocation noise", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              object: "server",
              attributes: {
                identifier: "00000000",
                uuid: "uuid-1",
                name: "example-bot",
                node: "Node-1",
                server_owner: true,
                status: null,
                is_suspended: false,
                is_installing: false,
                invocation: "HUGE_BASH_SCRIPT_TO_STRIP",
                sftp_details: { ip: "node1.example.com", port: 2022 },
                limits: { memory: 256, swap: 0, disk: 512, io: 500, cpu: 50 },
                relationships: {
                  allocations: {
                    data: [{ attributes: { id: 1, ip: "192.0.2.10", port: 3000, is_default: true } }],
                  },
                  egg: { attributes: { uuid: "egg-1", name: "node.js generic" } },
                },
              },
            },
          ],
          meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } },
        }),
        { status: 200 },
      ),
    );

    const { mcpClient } = await setupClient(fetchMock);
    const res = await mcpClient.callTool({ name: "list_servers", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);

    expect(text).not.toContain("HUGE_BASH_SCRIPT_TO_STRIP");
    expect(parsed.servers[0]).toEqual({
      identifier: "00000000",
      name: "example-bot",
      node: "Node-1",
      status: "unknown",
      is_suspended: false,
      is_installing: false,
      primary_address: "192.0.2.10:3000",
      sftp: "node1.example.com:2022",
      limits: { memory_mb: 256, disk_mb: 512, cpu_percent: 50 },
      egg: "node.js generic",
    });
  });

  it("get_server_resources formats bytes and uptime cleanly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          attributes: {
            current_state: "running",
            is_suspended: false,
            resources: {
              memory_bytes: 104857600,
              cpu_absolute: 12.345,
              disk_bytes: 2097152,
              network_rx_bytes: 1024,
              network_tx_bytes: 2048,
              uptime: 65000,
            },
          },
        }),
        { status: 200 },
      ),
    );

    const { mcpClient } = await setupClient(fetchMock);
    const res = await mcpClient.callTool({
      name: "get_server_resources",
      arguments: { server_id: "00000000" },
    });
    const parsed = JSON.parse((res.content as Array<{ text: string }>)[0].text);

    expect(parsed).toEqual({
      state: "running",
      is_suspended: false,
      cpu_percent: 12.35,
      memory: "100.0 MB",
      memory_bytes: 104857600,
      disk: "2.00 MB",
      disk_bytes: 2097152,
      network_rx: "1.00 KB",
      network_tx: "2.00 KB",
      uptime_seconds: 65,
    });
  });

  it("send_power_signal and send_console_command call expected endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    const { mcpClient } = await setupClient(fetchMock);

    const powerRes = await mcpClient.callTool({
      name: "send_power_signal",
      arguments: { server_id: "00000000", signal: "restart" },
    });
    expect(JSON.parse((powerRes.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      server_id: "00000000",
      signal: "restart",
    });

    const cmdRes = await mcpClient.callTool({
      name: "send_console_command",
      arguments: { server_id: "00000000", command: "say hello" },
    });
    expect(JSON.parse((cmdRes.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      server_id: "00000000",
      command: "say hello",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://client.hostmybot.net/api/client/servers/00000000/power",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://client.hostmybot.net/api/client/servers/00000000/command",
    );
  });
});
