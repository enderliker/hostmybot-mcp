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
  maxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;

function decodeWsMessage(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) {
    return Buffer.concat(
      raw.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer))),
    ).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
  }
  return String(raw);
}

async function readTextLimited(res: Response, maxBytes?: number): Promise<string> {
  if (maxBytes === undefined || !res.body) {
    return res.text();
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const chunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - totalBytes;
      if (value.byteLength >= remaining) {
        chunks.push(decoder.decode(value.subarray(0, remaining), { stream: true }));
        await reader.cancel().catch(() => {});
        break;
      }
      totalBytes += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    chunks.push(decoder.decode());
  }
  return chunks.join("");
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
        const json = JSON.parse(text) as {
          errors?: PterodactylApiErrorItem[];
          message?: string;
          error?: string;
        };
        if (Array.isArray(json.errors) && json.errors.length > 0) {
          parsedErrors = json.errors;
        } else if (json.error) {
          return new PterodactylError(`HTTP ${res.status}: ${json.error}`, res.status);
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
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw await this.parseError(res);
    }

    const isEmptyBody = res.status === 204 || res.headers.get("content-length") === "0";

    if (options.responseType === "text") {
      if (isEmptyBody) {
        return "" as T;
      }
      return (await readTextLimited(res, options.maxBytes)) as T;
    }

    if (isEmptyBody) {
      return undefined as T;
    }

    const rawText = await res.text();
    if (!rawText) {
      return undefined as T;
    }

    try {
      return JSON.parse(rawText) as T;
    } catch {
      throw new PterodactylError(
        `Invalid non-JSON response from API (HTTP ${res.status}): ${rawText.slice(0, 200)}`,
        res.status,
        "InvalidJsonResponse",
      );
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
    const byteView =
      fileBytes.byteOffset === 0 && fileBytes.byteLength === fileBytes.buffer.byteLength
        ? fileBytes
        : fileBytes.subarray(0);
    formData.append("files", new Blob([byteView as BlobPart]), fileName);

    const res = await this.fetchImpl(targetUrl.toString(), {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(DEFAULT_UPLOAD_TIMEOUT_MS),
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
          try {
            ws.send(JSON.stringify({ event: "auth", args: [token] }));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            finish(new PterodactylError(`WebSocket send failed: ${message}`, 502, "WebSocketError"));
          }
        });

        ws.on("message", (raw: unknown) => {
          try {
            const text = decodeWsMessage(raw);
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
              if (collected.length > maxLines * 2) {
                collected.splice(0, collected.length - maxLines);
              }
              bumpIdle();
            } else if (msg.event === "daemon error") {
              const detail = Array.isArray(msg.args) ? msg.args.join(" ") : "Daemon error";
              finish(new PterodactylError(`Wings daemon error: ${detail}`, 502, "DaemonError"));
            } else if (msg.event === "jwt error" || msg.event === "token expired") {
              finish(new PterodactylError(`WebSocket auth failed: ${msg.event}`, 401, msg.event));
            }
          } catch (err) {
            if (err instanceof PterodactylError) {
              finish(err);
            }
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
