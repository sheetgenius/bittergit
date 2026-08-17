import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  claudePointerMd,
  geminiPointerMd,
  sourceContextFileReport,
  workcellParentAgentsMd
} from "../src/agent-context";
import { createRepository } from "../src/repos";
import { findToken, tokenScopes } from "../src/tokens";
import { createWorkcellWithToken } from "../src/workcells";

describe("agent context files", () => {
  test("reports source-owned context files without implying missing provider files were dropped", () => {
    const report = sourceContextFileReport(["AGENTS.md", "APP.md", "CLAUDE.md", "src/app.ts"], {
      added: ["AGENTS.md", "APP.md"]
    });

    expect(report.canonical_instructions).toBe("AGENTS.md");
    expect(report.files.find((file) => file.path === "AGENTS.md")?.status).toBe("added");
    expect(report.files.find((file) => file.path === "docs/BITTERGRID_DEPLOYMENT_CONTRACT.md")?.status).toBe("missing");
    expect(report.files.find((file) => file.path === "CLAUDE.md")?.status).toBe("preserved");
    expect(report.files.find((file) => file.path === "GEMINI.md")?.status).toBe("missing");
    expect(report.files.find((file) => file.path === "CLAUDE.md")?.source_owned).toBe(true);
  });

  test("keeps provider shims thin and points them at AGENTS.md", () => {
    expect(workcellParentAgentsMd()).toContain("`AGENTS.md` is the canonical shared instruction file");
    expect(workcellParentAgentsMd()).toContain("docs/BITTERGRID_DEPLOYMENT_CONTRACT.md");
    expect(claudePointerMd()).toContain("../AGENTS.md");
    expect(geminiPointerMd()).toContain("Read AGENTS.md");
  });

  test("creates parent workcell context outside the repo checkout", () => {
    const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const repo = createRepository(`agentctx-${id}`, "context-app");
    const { workcell } = createWorkcellWithToken(repo, "test:agent-context");
    const parent = dirname(workcell.checkout_path);

    expect(readFileSync(join(parent, "AGENTS.md"), "utf8")).toContain("Bitter Workcell Agent Context");
    expect(readFileSync(join(parent, "CLAUDE.md"), "utf8")).toContain("../AGENTS.md");
    expect(readFileSync(join(parent, "GEMINI.md"), "utf8")).toContain("Read AGENTS.md");
  });

  test("keeps protected main opt-in for hosted workcell tokens", () => {
    const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const repo = createRepository(`agentctx-token-${id}`, "context-app");
    const defaultToken = createWorkcellWithToken(repo, "test:default-token").token;
    const hostedToken = createWorkcellWithToken(repo, "hosted-session:test", { allowMainPush: true }).token;

    const defaultRecord = findToken(defaultToken);
    const hostedRecord = findToken(hostedToken);

    expect(defaultRecord).toBeDefined();
    expect(hostedRecord).toBeDefined();
    expect(tokenScopes(defaultRecord!)).not.toContain("ref:write:refs/heads/main");
    expect(tokenScopes(hostedRecord!)).toContain("ref:write:refs/heads/main");
  });
});
