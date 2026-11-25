import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

describe("file tools", () => {
  it("list_files sorts directories first and formats file sizes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { attributes: { name: "index.js", mode: "-rw-r--r--", size: 2048, is_file: true, is_symlink: false, modified_at: "2026-01-01" } },
            { attributes: { name: "src", mode: "drwxr-xr-x", size: 4096, is_file: false, is_symlink: false, modified_at: "2026-01-01" } },
          ],
        }),
        { status: 200 },
      ),
    );
    const { mcpClient } = await setupClient(fetchMock);
    const res = await mcpClient.callTool({
      name: "list_files",
      arguments: { server_id: "00000000", directory: "/" },
    });
    const parsed = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    expect(parsed.entries.map((e: { name: string }) => e.name)).toEqual(["src", "index.js"]);
    expect(parsed.entries[0].type).toBe("dir");
    expect(parsed.entries[1].size).toBe("2.00 KB");
  });

  it("read_file_contents returns raw text and truncates when exceeding max_chars", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("A".repeat(250), { status: 200 }));
    const { mcpClient } = await setupClient(fetchMock);

    const res = await mcpClient.callTool({
      name: "read_file_contents",
      arguments: { server_id: "00000000", file: "/big.log", max_chars: 100 },
    });
    const text = (res.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("A".repeat(100));
    expect(text).toContain("[Truncated at 100 of 250 chars]");
  });

  it("write_file posts raw body to files/write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const { mcpClient } = await setupClient(fetchMock);

    const res = await mcpClient.callTool({
      name: "write_file",
      arguments: { server_id: "00000000", file: "/hello.txt", content: "hola" },
    });
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      server_id: "00000000",
      file: "/hello.txt",
      bytes: 4,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://client.hostmybot.net/api/client/servers/00000000/files/write?file=%2Fhello.txt",
    );
    expect(fetchMock.mock.calls[0][1]?.body).toBe("hola");
  });

  it("upload_file reads local file, gets signed URL, and uploads multipart FormData", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "hostmybot-upload-"));
    const localFile = path.join(tmpDir, "config.json");
    await writeFile(localFile, '{"port":3000}', "utf8");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ attributes: { url: "https://node1.example.com:8080/upload/file?token=xyz" } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    try {
      const { mcpClient } = await setupClient(fetchMock);
      const res = await mcpClient.callTool({
        name: "upload_file",
        arguments: {
          server_id: "00000000",
          local_path: localFile,
          directory: "/app",
        },
      });
      const parsed = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(parsed).toMatchObject({
        ok: true,
        server_id: "00000000",
        directory: "/app",
        filename: "config.json",
        size_bytes: 13,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(
        "https://node1.example.com:8080/upload/file?token=xyz&directory=%2Fapp",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("delete_files, compress_files, and get_download_url hit correct endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attributes: { name: "archive.tar.gz", mode: "-rw-r--r--", size: 512, is_file: true, is_symlink: false, modified_at: "2026-01-01" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ attributes: { url: "https://dl.example.com/file" } }), { status: 200 }),
      );

    const { mcpClient } = await setupClient(fetchMock);

    await mcpClient.callTool({
      name: "delete_files",
      arguments: { server_id: "00000000", files: ["old.log"] },
    });
    const comp = await mcpClient.callTool({
      name: "compress_files",
      arguments: { server_id: "00000000", files: ["src"] },
    });
    const dl = await mcpClient.callTool({
      name: "get_download_url",
      arguments: { server_id: "00000000", file: "/archive.tar.gz" },
    });

    expect(JSON.parse((comp.content as Array<{ text: string }>)[0].text).name).toBe("archive.tar.gz");
    expect(JSON.parse((dl.content as Array<{ text: string }>)[0].text).download_url).toBe(
      "https://dl.example.com/file",
    );
  });

  it("pull_remote_file posts url and destination directory", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const { mcpClient } = await setupClient(fetchMock);

    const res = await mcpClient.callTool({
      name: "pull_remote_file",
      arguments: {
        server_id: "00000000",
        url: "https://example.com/plugin.jar",
        directory: "/plugins",
        filename: "plugin.jar",
      },
    });
    expect(JSON.parse((res.content as Array<{ text: string }>)[0].text)).toEqual({
      ok: true,
      server_id: "00000000",
      url: "https://example.com/plugin.jar",
      directory: "/plugins",
      filename: "plugin.jar",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://client.hostmybot.net/api/client/servers/00000000/files/pull",
    );
  });
});
