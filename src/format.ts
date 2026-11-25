export interface McpToolResponse {
  [key: string]: unknown;
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

/**
 * Recursively removes undefined and null fields from objects
 * so MCP responses stay concise without dropping meaningful empty values like "" or 0.
 */
export function compactValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(compactValue).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = compactValue(v);
      if (cleaned !== undefined) {
        out[k] = cleaned;
      }
    }
    return out;
  }
  return value;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} B`;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIdx]}`;
}

const ANSI_ESCAPE_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

export function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

export interface ActivityLogAttributes {
  id: string;
  event: string;
  is_api: boolean;
  ip?: string;
  description?: string | null;
  properties?: Record<string, unknown>;
  timestamp: string;
}

export function summarizeActivity(item: ActivityLogAttributes) {
  return {
    id: item.id,
    event: item.event,
    is_api: item.is_api,
    ip: item.ip,
    description: item.description,
    properties: item.properties,
    timestamp: item.timestamp,
  };
}

export function toolSuccess(data: unknown): McpToolResponse {
  const text =
    typeof data === "string"
      ? data
      : JSON.stringify(compactValue(data) ?? {});
  return {
    content: [{ type: "text", text }],
  };
}

export function toolError(error: unknown): McpToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

export function withToolHandler<TArgs>(
  handler: (args: TArgs) => Promise<unknown>,
): (args: TArgs) => Promise<McpToolResponse> {
  return async (args: TArgs) => {
    try {
      const result = await handler(args);
      return toolSuccess(result);
    } catch (error) {
      return toolError(error);
    }
  };
}
