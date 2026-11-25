export const DEFAULT_HOSTMYBOT_URL = "https://client.hostmybot.net";

export interface HostMyBotConfig {
  apiKey: string;
  baseUrl: string;
}

export function isHelpRequested(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function readFlag(argv: string[], flagName: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flagName && i + 1 < argv.length) {
      return argv[i + 1];
    }
    if (arg.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
  }
  return undefined;
}

export function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid HOSTMYBOT_URL: "${rawUrl}". Expected an http:// or https:// URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid HOSTMYBOT_URL protocol "${parsed.protocol}". Expected http: or https:.`);
  }
  return trimmed;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): HostMyBotConfig {
  const rawApiKey =
    readFlag(argv, "--api-key") ??
    env.HOSTMYBOT_API_KEY ??
    env.PTERODACTYL_API_KEY;

  const apiKey = rawApiKey?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing HostMyBot API key. Set HOSTMYBOT_API_KEY in your MCP client env config or pass --api-key <ptlc_...>.",
    );
  }

  const rawUrl =
    readFlag(argv, "--url") ??
    env.HOSTMYBOT_URL ??
    env.PTERODACTYL_URL ??
    DEFAULT_HOSTMYBOT_URL;

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(rawUrl),
  };
}
