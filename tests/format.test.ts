import { describe, expect, it } from "vitest";
import {
  compactValue,
  formatBytes,
  stripAnsiCodes,
  toolError,
  toolSuccess,
  withToolHandler,
} from "../src/format.js";

describe("format helpers", () => {
  it("compactValue strips null/undefined while keeping empty strings, 0, false, and empty objects", () => {
    expect(
      compactValue({
        a: null,
        b: undefined,
        c: "",
        d: 0,
        e: false,
        f: {},
        g: [null, "ok", "", undefined],
      }),
    ).toEqual({
      c: "",
      d: 0,
      e: false,
      f: {},
      g: ["ok", ""],
    });
  });

  it("formatBytes formats B, KB, MB, GB cleanly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15.0 MB");
  });

  it("stripAnsiCodes strips CSI/OSC sequences safely without ReDoS or swallowing text", () => {
    expect(stripAnsiCodes("\x1b[32mOK\x1b[0m \x1b]0;Title\x07done")).toBe("OK done");
    expect(stripAnsiCodes("\x1b]0;A\x1b\\keep this\x07")).toBe("keep this\x07");

    const start = performance.now();
    const adversarial = "\x1b]".repeat(10000);
    expect(stripAnsiCodes(adversarial)).toBe(adversarial);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("toolSuccess, toolError, and withToolHandler produce valid MCP responses", async () => {
    expect(toolSuccess("hello")).toEqual({ content: [{ type: "text", text: "hello" }] });
    expect(toolError(new Error("boom"))).toEqual({
      isError: true,
      content: [{ type: "text", text: "boom" }],
    });

    const wrapped = withToolHandler(async () => {
      throw new Error("failed");
    });
    expect(await wrapped({})).toEqual({
      isError: true,
      content: [{ type: "text", text: "failed" }],
    });
  });
});
