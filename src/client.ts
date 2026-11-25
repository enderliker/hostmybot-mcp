import WebSocket from "ws";
import type { HostMyBotConfig } from "./config.js";
import { stripAnsiCodes } from "./format.js";

export interface ConsoleSocketLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string, origin: string) => ConsoleSocketLike;

const defaultWebSocketFactory: WebSocketFactory = (url, origin) =>
  new WebSocket(url, { headers: { Origin: origin } });

export interface PterodactylApiErrorItem {
  code?: string;
  status?: string;
  detail?: string;
}

export class PterodactylError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "PterodactylError";
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  rawBody?: string | Uint8Array;
  contentType?: string;
  responseType?: "json" | "text";
}

export class PterodactylClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly wsFactory: WebSocketFactory;

  constructor(
    config: HostMyBotConfig,
    fetchImpl: typeof fetch = fetch,
    wsFactory: WebSocketFactory = defaultWebSocketFactory,
  ) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.fetchImpl = fetchImpl;
    this.wsFactory = wsFactory;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async parseError(res: Response): Promise<PterodactylError> {
    const retryAfter = res.headers.get("retry-after");
    const text = await res.text().catch(() => "");
    let parsedErrors: PterodactylApiErrorItem[] | undefined;

    if (text) {
      try {
        const json = JSON.parse(text) as { errors?: PterodactylApiErrorItem[]; message?: string };
        if (Array.isArray(json.errors) && json.errors.length > 0) {
          parsedErrors = json.errors;
        } else if (json.message) {
          return new PterodactylError(`HTTP ${res.status}: ${json.message}`, res.status);
        }
      } catch {
        // Not JSON; fall back to raw response text below
      }
    }

    if (parsedErrors) {
      const first = parsedErrors[0];
      const details = parsedErrors
        .map((e) => e.detail ?? e.code ?? "Unknown error")
        .join("; ");
      return new PterodactylError(
        `Pterodactyl API error (${res.status}${first.code ? ` ${first.code}` : ""}): ${details}`,
        res.status,
        first.code,
      );
    }

    if (res.status === 429) {
      const waitHint = retryAfter ? ` Retry after ${retryAfter}s.` : "";
      return new PterodactylError(`Rate limit exceeded (HTTP 429).${waitHint}`, 429, "RateLimit");
    }

    const snippet = text ? `: ${text.slice(0, 300)}` : "";
    return new PterodactylError(`HTTP ${res.status} ${res.statusText}${snippet}`, res.status);
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };

    let body: BodyInit | undefined;
    if (options.rawBody !== undefined) {
      headers["Content-Type"] = options.contentType ?? "text/plain; charset=utf-8";
      body = options.rawBody as BodyInit;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body,
    });

    if (!res.ok) {
      throw await this.parseError(res);
    }

    if (res.status === 204 || res.headers.get("content-length") === "0") {
      return undefined as T;
    }

    if (options.responseType === "text") {
      return (await res.text()) as T;
    }

    const rawText = await res.text();
    if (!rawText) {
      return undefined as T;
    }

    try {
      return JSON.parse(rawText) as T;
    } catch {
      return rawText as T;
    }
  }

  async uploadFileToSignedUrl(
    signedUrl: string,
    fileName: string,
    fileBytes: Uint8Array,
    directory?: string,
  ): Promise<void> {
    const targetUrl = new URL(signedUrl);
    if (directory && directory !== "/") {
      targetUrl.searchParams.set("directory", directory);
    }

    const formData = new FormData();
    const arrayBuffer = fileBytes.buffer.slice(
      fileBytes.byteOffset,
      fileBytes.byteOffset + fileBytes.byteLength,
    ) as ArrayBuffer;
    formData.append("files", new Blob([arrayBuffer]), fileName);

    const res = await this.fetchImpl(targetUrl.toString(), {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw await this.parseError(res);
    }
  }

  async getWebsocketCredentials(serverId: string): Promise<{ token: string; socket: string }> {
    const res = await this.request<{ data: { token: string; socket: string } }>(
      "GET",
      `/api/client/servers/${encodeURIComponent(serverId)}/websocket`,
    );
    return res.data;
  }

  async readConsoleLogs(
    serverId: string,
    options: { maxLines?: number; timeoutMs?: number; stripAnsi?: boolean; idleMs?: number } = {},
  ): Promise<{ status?: string; line_count: number; lines: string[] }> {
    const maxLines = options.maxLines ?? 100;
    const timeoutMs = options.timeoutMs ?? 2500;
    const idleMs = options.idleMs ?? 450;
    const shouldStripAnsi = options.stripAnsi ?? true;

    const { token, socket } = await this.getWebsocketCredentials(serverId);
    const ws = this.wsFactory(socket, this.baseUrl);
    const collected: string[] = [];
    let latestStatus: string | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const maxTimer = setTimeout(() => finish(), timeoutMs);

        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(maxTimer);
          if (idleTimer) clearTimeout(idleTimer);
          if (err) reject(err);
          else resolve();
        };

        const bumpIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => finish(), idleMs);
        };

        ws.on("open", () => {
          ws.send(JSON.stringify({ event: "auth", args: [token] }));
        });

        ws.on("message", (raw: unknown) => {
          try {
            const text = typeof raw === "string" ? raw : String(raw);
            const msg = JSON.parse(text) as { event?: string; args?: unknown[] };
            if (msg.event === "auth success") {
              ws.send(JSON.stringify({ event: "send logs", args: [null] }));
              bumpIdle();
            } else if (msg.event === "status" && Array.isArray(msg.args) && msg.args[0]) {
              latestStatus = String(msg.args[0]);
            } else if (msg.event === "console output" && Array.isArray(msg.args)) {
              for (const chunk of msg.args) {
                const rawLine = String(chunk);
                const normalized = shouldStripAnsi ? stripAnsiCodes(rawLine) : rawLine;
                for (const line of normalized.split(/\r?\n/)) {
                  if (line.length > 0) collected.push(line);
                }
              }
              bumpIdle();
            } else if (msg.event === "jwt error" || msg.event === "token expired") {
              finish(new PterodactylError(`WebSocket auth failed: ${msg.event}`, 401, msg.event));
            }
          } catch {
            // Ignore malformed or non-JSON frames from Wings
          }
        });

        ws.on("error", (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          finish(new PterodactylError(`WebSocket error: ${message}`, 502, "WebSocketError"));
        });

        ws.on("close", () => finish());
      });
    } finally {
      try {
        ws.close();
      } catch {
        // Ignore close errors if socket never opened
      }
    }

    const lines = collected.slice(-maxLines);
    return {
      status: latestStatus,
      line_count: lines.length,
      lines,
    };
  }
}
