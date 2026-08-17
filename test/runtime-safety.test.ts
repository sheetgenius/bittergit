import { describe, expect, test } from "bun:test";
import { isLoopbackHost, validateRuntimeSafety } from "../src/runtime-safety";

describe("public runtime safety", () => {
  test("recognizes loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  test("allows the documented loopback-only development defaults", () => {
    expect(() => validateRuntimeSafety({
      host: "127.0.0.1",
      devToken: "dev-token",
      assertionSecret: "dev-token",
      demoUiEnabled: true,
      artifactImportRoot: null
    })).not.toThrow();
  });

  test("rejects known credentials and the demo UI on a network bind", () => {
    expect(() => validateRuntimeSafety({
      host: "0.0.0.0",
      devToken: "dev-token",
      assertionSecret: "dev-token",
      demoUiEnabled: true,
      artifactImportRoot: null
    })).toThrow("unsafe non-loopback BitterGit configuration");
  });

  test("rejects long public placeholders on a network bind", () => {
    expect(() => validateRuntimeSafety({
      host: "0.0.0.0",
      devToken: "replace-with-a-random-value-at-least-32-characters",
      assertionSecret: "replace-with-a-different-random-value-at-least-32-characters",
      demoUiEnabled: false,
      artifactImportRoot: "/srv/bittergit/imports"
    })).toThrow("non-placeholder value");
  });

  test("accepts a fail-closed network configuration", () => {
    const devToken = ["unit", "dev", "0123456789abcdef".repeat(3)].join("-");
    const assertionSecret = ["unit", "assertion", "fedcba9876543210".repeat(3)].join("-");
    expect(() => validateRuntimeSafety({
      host: "0.0.0.0",
      devToken,
      assertionSecret,
      demoUiEnabled: false,
      artifactImportRoot: "/srv/bittergit/imports"
    })).not.toThrow();
  });
});
