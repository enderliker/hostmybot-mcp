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

describe("account and subuser tools", () => {
  it("get_account returns compact user details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          attributes: {
            id: 42,
            admin: false,
            username: "ender",
            email: "ender@example.com",
            first_name: "Ender",
            last_name: "Dev",
            language: "en",
          },
        }),
        { status: 200 },
      ),
    );
    const { mcpClient } = await setupClient(fetchMock);
    const res = await mcpClient.callTool({ name: "get_account", arguments: {} });
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text)).toMatchObject({
      id: 42,
      username: "ender",
      email: "ender@example.com",
    });
  });

  it("list_subusers, create_subuser, and delete_subuser manage server subusers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                attributes: {
                  uuid: "usr-1",
                  username: "helper",
                  email: "helper@example.com",
                  "2fa_enabled": true,
                  created_at: "2026-01-01",
                  permissions: ["control.console"],
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
              uuid: "usr-2",
              username: "dev2",
              email: "dev2@example.com",
              permissions: ["file.read"],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { mcpClient } = await setupClient(fetchMock);
    const listRes = await mcpClient.callTool({
      name: "list_subusers",
      arguments: { server_id: "00000000" },
    });
    expect(JSON.parse((listRes.content as Array<{ text: string }>)[0].text).users[0]).toMatchObject({
      uuid: "usr-1",
      two_factor_enabled: true,
    });

    const createRes = await mcpClient.callTool({
      name: "create_subuser",
      arguments: { server_id: "00000000", email: "dev2@example.com", permissions: ["file.read"] },
    });
    expect(JSON.parse((createRes.content as Array<{ text: string }>)[0].text).uuid).toBe("usr-2");

    const delRes = await mcpClient.callTool({
      name: "delete_subuser",
      arguments: { server_id: "00000000", user_uuid: "usr-2" },
    });
    expect(JSON.parse((delRes.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      removed_user_uuid: "usr-2",
    });
  });
});
