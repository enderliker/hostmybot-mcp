import { describe, expect, it } from "vitest";
import { DEFAULT_HOSTMYBOT_URL, isHelpRequested, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads API key and default URL from env", () => {
    const config = loadConfig({ HOSTMYBOT_API_KEY: "ptlc_test_key" }, []);
    expect(config).toEqual({
      apiKey: "ptlc_test_key",
      baseUrl: DEFAULT_HOSTMYBOT_URL,
    });
  });

  it("prefers CLI flags over env vars and strips trailing slashes", () => {
    const config = loadConfig(
      {
        HOSTMYBOT_API_KEY: "ptlc_env",
        HOSTMYBOT_URL: "https://env.example.com/",
      },
      ["--api-key", "ptlc_cli", "--url=https://panel.example.com///"],
    );
    expect(config).toEqual({
      apiKey: "ptlc_cli",
      baseUrl: "https://panel.example.com",
    });
  });

  it("throws descriptive error when API key is missing", () => {
    expect(() => loadConfig({}, [])).toThrow(/HOSTMYBOT_API_KEY/);
  });

  it("rejects invalid URLs", () => {
    expect(() =>
      loadConfig({ HOSTMYBOT_API_KEY: "ptlc_ok", HOSTMYBOT_URL: "ftp://bad.host" }, []),
    ).toThrow(/protocol/i);
  });

  it("detects --help and -h flags", () => {
    expect(isHelpRequested(["--help"])).toBe(true);
    expect(isHelpRequested(["-h"])).toBe(true);
    expect(isHelpRequested(["--api-key", "abc"])).toBe(false);
  });
});
