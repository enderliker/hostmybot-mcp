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

describe("settings tools", () => {
  it("get_startup_variables and update_startup_variable format compact variable summaries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            meta: { startup_command: "node index.js", docker_images: { "Node 22": "ghcr.io/parkervcp/yolks:nodejs_22" } },
            data: [
              {
                attributes: {
                  name: "Main file",
                  env_variable: "MAIN_FILE",
                  default_value: "index.js",
                  server_value: "bot.js",
                  is_editable: true,
                  rules: "required|string",
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
              env_variable: "MAIN_FILE",
              default_value: "index.js",
              server_value: "app.js",
              is_editable: true,
            },
          }),
          { status: 200 },
        ),
      );

    const { mcpClient } = await setupClient(fetchMock);
    const listRes = await mcpClient.callTool({
      name: "get_startup_variables",
      arguments: { server_id: "00000000" },
    });
    const listJson = JSON.parse((listRes.content as Array<{ text: string }>)[0].text);
    expect(listJson.variables[0]).toMatchObject({ key: "MAIN_FILE", value: "bot.js" });

    const updateRes = await mcpClient.callTool({
      name: "update_startup_variable",
      arguments: { server_id: "00000000", key: "MAIN_FILE", value: "app.js" },
    });
    expect(JSON.parse((updateRes.content as Array<{ text: string }>)[0].text)).toEqual({
      key: "MAIN_FILE",
      value: "app.js",
      default_value: "index.js",
      is_editable: true,
    });
  });

  it("reinstall_server requires confirm=true and posts to settings/reinstall", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const { mcpClient } = await setupClient(fetchMock);

    const rejected = await mcpClient.callTool({
      name: "reinstall_server",
      arguments: { server_id: "00000000", confirm: false },
    });
    expect(rejected.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const ok = await mcpClient.callTool({
      name: "reinstall_server",
      arguments: { server_id: "00000000", confirm: true },
    });
    expect(JSON.parse((ok.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      server_id: "00000000",
      status: "reinstalling",
    });
  });

  it("list_allocations returns compact allocation list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ attributes: { id: 101, ip: "192.0.2.10", ip_alias: null, port: 3000, notes: null, is_default: true } }],
        }),
        { status: 200 },
      ),
    );
    const { mcpClient } = await setupClient(fetchMock);
    const res = await mcpClient.callTool({
      name: "list_allocations",
      arguments: { server_id: "00000000" },
    });
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text)).toEqual({
      allocations: [{ id: 101, ip: "192.0.2.10", port: 3000, is_default: true }],
    });
  });

  it("creates, updates notes, sets primary, and deletes allocations", async () => {
    const alloc = { attributes: { id: 102, ip: "192.0.2.10", ip_alias: null, port: 3001, notes: "api", is_default: true } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(alloc), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(alloc), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(alloc), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { mcpClient } = await setupClient(fetchMock);
    const created = await mcpClient.callTool({
      name: "create_allocation",
      arguments: { server_id: "00000000" },
    });
    expect(JSON.parse((created.content as Array<{ text: string }>)[0].text).id).toBe(102);

    const noted = await mcpClient.callTool({
      name: "update_allocation_notes",
      arguments: { server_id: "00000000", allocation_id: 102, notes: "api" },
    });
    expect(JSON.parse((noted.content as Array<{ text: string }>)[0].text).notes).toBe("api");

    const primary = await mcpClient.callTool({
      name: "set_primary_allocation",
      arguments: { server_id: "00000000", allocation_id: 102 },
    });
    expect(JSON.parse((primary.content as Array<{ text: string }>)[0].text).is_default).toBe(true);

    const deleted = await mcpClient.callTool({
      name: "delete_allocation",
      arguments: { server_id: "00000000", allocation_id: 102 },
    });
    expect(JSON.parse((deleted.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      deleted_allocation_id: 102,
    });
  });
});
