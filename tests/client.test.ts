import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { type ConsoleSocketLike, PterodactylClient, type WebSocketFactory } from "../src/client.js";
import { PterodactylError } from "../src/client.js";

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

  it("returns empty string for 0-byte or 204 text responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200, headers: { "content-length": "0" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new PterodactylClient(baseConfig, fetchMock);

    expect(
      await client.request<string>("GET", "/api/client/servers/00000000/files/contents", {
        responseType: "text",
      }),
    ).toBe("");
    expect(
      await client.request<string>("GET", "/api/client/servers/00000000/files/contents", {
        responseType: "text",
      }),
    ).toBe("");
  });

  it("streams text up to maxBytes without buffering entire large responses", async () => {
    const bigBody = new Response("0123456789ABCDEF", { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(bigBody);
    const client = new PterodactylClient(baseConfig, fetchMock);

    const text = await client.request<string>("GET", "/api/client/servers/00000000/files/contents", {
      responseType: "text",
      maxBytes: 6,
    });
    expect(text).toBe("012345");
  });

  it("throws PterodactylError on non-JSON 200 responses and Wings { error } responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>Cloudflare</html>", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "upload rejected" }), { status: 400 }));
    const client = new PterodactylClient(baseConfig, fetchMock);

    await expect(client.request("GET", "/api/client")).rejects.toMatchObject({
      code: "InvalidJsonResponse",
    });
    await expect(
      client.uploadFileToSignedUrl("https://node1.example.com/upload?token=x", "a.txt", new Uint8Array([1])),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("upload rejected"),
    });
  });

  it("readConsoleLogs handles jwt error, daemon error, Buffer frames, and stripAnsi=false", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { token: "jwt", socket: "wss://node1.example.com/ws" } }), {
          status: 200,
        }),
      ),
    );

    const makeWsFactory = (onSend: (emitter: EventEmitter, event: string) => void): WebSocketFactory => {
      return () => {
        const emitter = new EventEmitter();
        const socket: ConsoleSocketLike = {
          on: (ev, fn) => emitter.on(ev, fn),
          send: (raw) => {
            const msg = JSON.parse(raw) as { event: string };
            onSend(emitter, msg.event);
          },
          close: () => emitter.emit("close"),
        };
        queueMicrotask(() => emitter.emit("open"));
        return socket;
      };
    };

    const jwtClient = new PterodactylClient(
      baseConfig,
      fetchMock,
      makeWsFactory((emitter, ev) => {
        if (ev === "auth") emitter.emit("message", Buffer.from(JSON.stringify({ event: "jwt error" })));
      }),
    );
    await expect(jwtClient.readConsoleLogs("00000000")).rejects.toMatchObject({ code: "jwt error" });

    const daemonClient = new PterodactylClient(
      baseConfig,
      fetchMock,
      makeWsFactory((emitter, ev) => {
        if (ev === "auth") emitter.emit("message", JSON.stringify({ event: "auth success" }));
        if (ev === "send logs") {
          emitter.emit("message", JSON.stringify({ event: "daemon error", args: ["wings down"] }));
        }
      }),
    );
    await expect(daemonClient.readConsoleLogs("00000000")).rejects.toMatchObject({ code: "DaemonError" });

    const rawAnsiClient = new PterodactylClient(
      baseConfig,
      fetchMock,
      makeWsFactory((emitter, ev) => {
        if (ev === "auth") emitter.emit("message", JSON.stringify({ event: "auth success" }));
        if (ev === "send logs") {
          emitter.emit(
            "message",
            Buffer.from(JSON.stringify({ event: "console output", args: ["\x1b[31mErr\x1b[0m"] })),
          );
        }
      }),
    );
    const out = await rawAnsiClient.readConsoleLogs("00000000", { stripAnsi: false, idleMs: 30 });
    expect(out.lines).toEqual(["\x1b[31mErr\x1b[0m"]);
  });
});
