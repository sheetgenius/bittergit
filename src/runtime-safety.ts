export type RuntimeSafetyInput = {
  host: string;
  devToken: string;
  assertionSecret: string;
  demoUiEnabled: boolean;
  artifactImportRoot: string | null;
};

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

export function validateRuntimeSafety(input: RuntimeSafetyInput): void {
  if (isLoopbackHost(input.host)) return;

  const failures: string[] = [];
  if (unsafeNetworkCredential(input.devToken)) {
    failures.push("BITTERGIT_DEV_TOKEN must be a non-placeholder value of at least 32 characters");
  }
  if (unsafeNetworkCredential(input.assertionSecret)) {
    failures.push("BITTERGIT_ASSERTION_SECRET must be a non-placeholder value of at least 32 characters");
  }
  if (input.assertionSecret === input.devToken) {
    failures.push("BITTERGIT_ASSERTION_SECRET must differ from BITTERGIT_DEV_TOKEN");
  }
  if (input.demoUiEnabled) {
    failures.push("the unauthenticated demo UI is restricted to loopback hosts");
  }
  if (!input.artifactImportRoot) {
    failures.push("BITTERGIT_ARTIFACT_IMPORT_ROOT must restrict server-local artifact reads");
  }

  if (failures.length > 0) {
    throw new Error(`unsafe non-loopback BitterGit configuration: ${failures.join("; ")}`);
  }
}

function unsafeNetworkCredential(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (value.length < 32 || normalized === "dev-token") return true;
  if (/replace|change.?me|placeholder|example|sample|insert.*here|your.*(token|secret)/.test(normalized)) return true;
  return new Set(value).size < 4;
}
