import { describe, expect, test } from "bun:test";
import {
  normalizeProductionSsh,
  productionSshSessionJson,
  productionSshSupportJson
} from "../src/production-ssh";

describe("production SSH session policy", () => {
  test("defaults to read-only diagnostics with write disabled", () => {
    const policy = normalizeProductionSsh(undefined);
    expect(policy.enabled).toBe(true);
    expect(policy.mode).toBe("read_only");
    expect(policy.read_only_diagnostics_enabled).toBe(true);
    expect(policy.write_enabled).toBe(false);
    expect(policy.credential_material_returned).toBe(false);
    expect(policy.key_material_returned).toBe(false);
  });

  test("requires an explicit reason for write/operate access", () => {
    expect(() => normalizeProductionSsh({ write_enabled: true })).toThrow("write_reason");
    const policy = normalizeProductionSsh({
      mode: "operate",
      write_enabled: true,
      write_reason: "Gate proof"
    });
    expect(policy.mode).toBe("operate");
    expect(policy.write_enabled).toBe(true);
    expect(policy.write_reason_present).toBe(true);
  });

  test("support hides targets while the orchestration session retains them", () => {
    const policy = normalizeProductionSsh({
      write_enabled: true,
      write_reason: "Sensitive operational reason",
      target: { service: "web", host_ref: "grid-host-01" }
    });
    const sessionJson = productionSshSessionJson(policy, "ready");
    const supportJson = productionSshSupportJson(policy, "ready");
    const text = JSON.stringify({ sessionJson, supportJson });
    expect(text).not.toContain("Sensitive operational reason");
    expect(text).not.toContain("BEGIN OPENSSH");
    expect(text).not.toContain("bgt_");
    expect(sessionJson).toMatchObject({
      mode: "operate",
      write_enabled: true,
      write_reason_present: true,
      credential_material_returned: false,
      key_material_returned: false
    });
    expect(sessionJson).toMatchObject({ target: { service: "web", host_ref: "grid-host-01" } });
    expect(supportJson).toMatchObject({
      target: { service: null, host_ref: null },
      target_configured: true,
      target_ref_returned: false
    });
    expect(JSON.stringify(supportJson)).not.toContain("grid-host-01");
  });
});
