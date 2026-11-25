import { describe, expect, it, vi } from "vitest";
import { PterodactylClient, PterodactylError } from "../src/client.js";

describe("PterodactylClient", () => {
  const baseConfig = {
    apiKey: "ptlc_secret",
    baseUrl: "https://client.hostmybot.net",
  };

  it("attaches auth header, query params, and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = new PterodactylClient(baseConfig, fetchMock);
    const result = await client.request("GET", "/api/client/servers/00000000/files/list", {
      query: { directory: "/src", unused: undefined },
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://client.hostmybot.net/api/client/servers/00000000/files/list?directory=%2Fsrc");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer ptlc_secret");
  });

  it("returns undefined on 204 No Content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new PterodactylClient(baseConfig, fetchMock);

    const result = await client.request("POST", "/api/client/servers/00000000/power", {
      body: { signal: "restart" },
    });
    expect(result).toBeUndefined();
  });

  it("formats Pterodactyl error payloads clearly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ code: "HttpException", status: "403", detail: "Forbidden action." }],
        }),
        { status: 403 },
      ),
    );
    const client = new PterodactylClient(baseConfig, fetchMock);

    await expect(client.request("GET", "/api/client")).rejects.toMatchObject({
      name: "PterodactylError",
      status: 403,
      code: "HttpException",
      message: expect.stringContaining("Forbidden action."),
    });
  });

  it("handles 429 rate limit with Retry-After", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("", { status: 429, headers: { "retry-after": "15" } }),
    );
    const client = new PterodactylClient(baseConfig, fetchMock);

    try {
      await client.request("GET", "/api/client");
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PterodactylError);
      expect((err as PterodactylError).message).toContain("Retry after 15s");
    }
  });

  it("uploads file bytes as FormData to signed URL with optional directory", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new PterodactylClient(baseConfig, fetchMock);

    await client.uploadFileToSignedUrl(
      "https://node1.example.com:8080/upload/file?token=abc",
      "bot.js",
      new TextEncoder().encode("console.log('hi')"),
      "/plugins",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [uploadUrl, init] = fetchMock.mock.calls[0];
    expect(uploadUrl).toBe("https://node1.example.com:8080/upload/file?token=abc&directory=%2Fplugins");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const uploaded = (init?.body as FormData).get("files") as File;
    expect(uploaded).toBeTruthy();
    expect(uploaded.name).toBe("bot.js");
  });
});
