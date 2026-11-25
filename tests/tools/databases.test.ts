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

describe("database tools", () => {
  it("list_databases hides passwords unless include_password=true", async () => {
    const payload = {
      data: [
        {
          attributes: {
            id: "db-1",
            name: "s1_main",
            username: "u1_main",
            connections_from: "%",
            max_connections: 10,
            host: { address: "192.0.2.20", port: 3306 },
            relationships: { password: { attributes: { password: "secret" } } },
          },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

    const { mcpClient } = await setupClient(fetchMock);
    const hidden = await mcpClient.callTool({
      name: "list_databases",
      arguments: { server_id: "00000000" },
    });
    expect(JSON.parse((hidden.content as Array<{ text: string }>)[0].text).databases[0]).not.toHaveProperty(
      "password",
    );

    const shown = await mcpClient.callTool({
      name: "list_databases",
      arguments: { server_id: "00000000", include_password: true },
    });
    expect(JSON.parse((shown.content as Array<{ text: string }>)[0].text).databases[0].password).toBe(
      "secret",
    );
  });

  it("create_database, rotate_database_password, and delete_database hit expected endpoints", async () => {
    const dbAttr = {
      attributes: {
        id: "db-2",
        name: "s1_app",
        username: "u1_app",
        connections_from: "%",
        max_connections: 0,
        host: { address: "192.0.2.20", port: 3306 },
        relationships: { password: { attributes: { password: "rotated" } } },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(dbAttr), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(dbAttr), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { mcpClient } = await setupClient(fetchMock);

    const created = await mcpClient.callTool({
      name: "create_database",
      arguments: { server_id: "00000000", database: "app" },
    });
    expect(JSON.parse((created.content as Array<{ text: string }>)[0].text).id).toBe("db-2");

    const rotated = await mcpClient.callTool({
      name: "rotate_database_password",
      arguments: { server_id: "00000000", database_id: "db-2" },
    });
    expect(JSON.parse((rotated.content as Array<{ text: string }>)[0].text).password).toBe("rotated");

    const deleted = await mcpClient.callTool({
      name: "delete_database",
      arguments: { server_id: "00000000", database_id: "db-2" },
    });
    expect(JSON.parse((deleted.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      deleted_database_id: "db-2",
    });
  });
});
