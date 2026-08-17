import { describe, expect, test } from "bun:test";
import { analyzeCharter } from "../src/charter-first-runs";
import { blankAppMd } from "../src/blank-app";

describe("charter-first analysis", () => {
  test("placeholder charter is not sufficient", () => {
    const analysis = analyzeCharter(blankAppMd());
    expect(analysis.sufficient).toBe(false);
    expect(analysis.status).toBe("placeholder");
    expect(analysis.has_verification_gates).toBe(false);
    expect(analysis.missing).toContain("verification_gates");
  });

  test("completed charter with required axes and gates is sufficient", () => {
    const analysis = analyzeCharter(sufficientCharter());
    expect(analysis.sufficient).toBe(true);
    expect(analysis.status).toBe("sufficient");
    expect(analysis.sufficient_axis_count).toBeGreaterThanOrEqual(9);
    expect(analysis.verification_gate_count).toBeGreaterThanOrEqual(2);
  });
});

function sufficientCharter(): string {
  const axes = [
    "User Value",
    "First Encounter",
    "Workflow Fit",
    "UX",
    "Correctness",
    "Performance",
    "Security",
    "Ecosystem Awareness",
    "Verification"
  ];

  return `# App Charter

## Purpose

Help coaches publish a small registration page with clear session details.

## User

Independent youth sports coaches who need a simple public page.

## First Useful Version

A single-page site with schedule, registration copy, and contact details.

## Core Workflow

Visitor reads the offer, checks the schedule, and sends a registration request.

## Constraints

Keep the first version static, accessible, and easy to deploy.

## Axes Of Excellence

${axes.map((axis) => `### ${axis}

- Intent: Make ${axis.toLowerCase()} explicit enough to guide agent work.
- Verification: Review the shipped page against the ${axis.toLowerCase()} standard.`).join("\n\n")}

## Verification Gates

- Cold user can explain the offer and next action in under one minute.
- Static page loads locally without console errors.

## Non-Goals

No payment processing or account system in the first version.
`;
}
