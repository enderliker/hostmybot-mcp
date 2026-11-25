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

  it("supports permissions, activity, subuser get/update, api keys, and ssh keys", async () => {
    const subuserPayload = {
      attributes: {
        uuid: "usr-1",
        username: "helper",
        email: "helper@example.com",
        "2fa_enabled": false,
        created_at: "2026-01-01",
        permissions: ["control.console", "file.read"],
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attributes: {
              permissions: {
                control: { description: "Control", keys: { console: "Send commands" } },
                file: { description: "Files", keys: { read: "Read files" } },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ attributes: { id: "a1", event: "auth:success", is_api: false, timestamp: "2026-01-01" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(subuserPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(subuserPayload), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ attributes: { identifier: "ptlc_abc", description: "ci", allowed_ips: [], created_at: "2026-01-01" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attributes: { identifier: "ptlc_new", description: "deploy", allowed_ips: [], created_at: "2026-01-01" },
            meta: { secret_token: "ptlc_new_secret" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ attributes: { name: "laptop", fingerprint: "SHA256:xyz", public_key: "ssh-ed25519 AAA", created_at: "2026-01-01" } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attributes: { name: "desktop", fingerprint: "SHA256:123", public_key: "ssh-ed25519 BBB", created_at: "2026-01-01" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { mcpClient } = await setupClient(fetchMock);

    const perms = await mcpClient.callTool({ name: "list_permissions", arguments: { category: "file" } });
    expect(JSON.parse((perms.content as Array<{ text: string }>)[0].text).categories).toHaveLength(1);

    const activity = await mcpClient.callTool({ name: "get_account_activity", arguments: {} });
    expect(JSON.parse((activity.content as Array<{ text: string }>)[0].text).events[0].event).toBe("auth:success");

    const gotSub = await mcpClient.callTool({
      name: "get_subuser",
      arguments: { server_id: "00000000", user_uuid: "usr-1" },
    });
    expect(JSON.parse((gotSub.content as Array<{ text: string }>)[0].text).username).toBe("helper");

    const updSub = await mcpClient.callTool({
      name: "update_subuser",
      arguments: { server_id: "00000000", user_uuid: "usr-1", permissions: ["control.console", "file.read"] },
    });
    expect(JSON.parse((updSub.content as Array<{ text: string }>)[0].text).permissions).toContain("file.read");

    const keys = await mcpClient.callTool({ name: "list_api_keys", arguments: {} });
    expect(JSON.parse((keys.content as Array<{ text: string }>)[0].text).api_keys[0].identifier).toBe("ptlc_abc");

    const createdKey = await mcpClient.callTool({
      name: "create_api_key",
      arguments: { description: "deploy" },
    });
    expect(JSON.parse((createdKey.content as Array<{ text: string }>)[0].text).secret_token).toBe("ptlc_new_secret");

    const deletedKey = await mcpClient.callTool({
      name: "delete_api_key",
      arguments: { identifier: "ptlc_new" },
    });
    expect(JSON.parse((deletedKey.content as Array<{ text: string }>)[0].text).ok).toBe(true);

    const sshList = await mcpClient.callTool({ name: "list_ssh_keys", arguments: {} });
    expect(JSON.parse((sshList.content as Array<{ text: string }>)[0].text).ssh_keys[0].name).toBe("laptop");

    const sshAdded = await mcpClient.callTool({
      name: "add_ssh_key",
      arguments: { name: "desktop", public_key: "ssh-ed25519 BBB" },
    });
    expect(JSON.parse((sshAdded.content as Array<{ text: string }>)[0].text).fingerprint).toBe("SHA256:123");

    const sshRemoved = await mcpClient.callTool({
      name: "remove_ssh_key",
      arguments: { fingerprint: "SHA256:123" },
    });
    expect(JSON.parse((sshRemoved.content as Array<{ text: string }>)[0].text).ok).toBe(true);
  });
});
