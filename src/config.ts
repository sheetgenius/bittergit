import { join, resolve } from "node:path";
import { isLoopbackHost } from "./runtime-safety";

const root = resolve(process.env.BITTERGIT_ROOT ?? process.cwd());
const dataRoot = resolve(process.env.BITTERGIT_DATA_ROOT ?? join(root, ".var", "bittergit"));
const publicBaseUrl = (process.env.BITTERGIT_PUBLIC_BASE_URL ?? "").trim();
const host = process.env.BITTERGIT_HOST ?? "127.0.0.1";
const loopback = isLoopbackHost(host);
const configuredArtifactImportRoot = (process.env.BITTERGIT_ARTIFACT_IMPORT_ROOT ?? "").trim();

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export const config = {
  root,
  host,
  port: Number(process.env.BITTERGIT_PORT ?? "7420"),
  publicBaseUrl,
  devToken: process.env.BITTERGIT_DEV_TOKEN ?? "dev-token",
  assertionSecret: process.env.BITTERGIT_ASSERTION_SECRET ?? process.env.BITTERGIT_DEV_TOKEN ?? "dev-token",
  assertionAudience: process.env.BITTERGIT_ASSERTION_AUDIENCE ?? "bittergit",
  maxRequestBytes: Number(process.env.BITTERGIT_MAX_REQUEST_BYTES ?? `${1024 * 1024}`),
  maxArtifactImportFileBytes: Number(process.env.BITTERGIT_ARTIFACT_IMPORT_MAX_FILE_BYTES ?? `${5 * 1024 * 1024}`),
  artifactImportRoot: configuredArtifactImportRoot
    ? resolve(configuredArtifactImportRoot)
    : loopback
      ? null
      : join(dataRoot, "imports"),
  demoUiEnabled: booleanEnv("BITTERGIT_ENABLE_DEMO_UI", loopback),
  rateLimitPerMinute: Number(process.env.BITTERGIT_RATE_LIMIT_PER_MINUTE ?? "600"),
  gridApiUrl: (process.env.BITTERGRID_API_URL ?? "").replace(/\/+$/, ""),
  gridServiceToken: process.env.BITTERGRID_SERVICE_TOKEN ?? "",
  gridHostSlug: process.env.BITTERGIT_GRID_HOST_SLUG ?? "grid-host-01",
  gridTerminalMode: process.env.BITTERGIT_GRID_TERMINAL_MODE ?? "local_adapter",
  gridTerminalPublicBaseUrl: (process.env.BITTERGIT_GRID_TERMINAL_PUBLIC_BASE_URL ?? publicBaseUrl).replace(/\/+$/, ""),
  gridWorkcellsRoot: resolve(process.env.BITTERGIT_GRID_WORKCELLS_ROOT ?? "/var/lib/bittergrid/workcells"),
  gridTerminalImageRef: process.env.BITTERGIT_GRID_TERMINAL_IMAGE_REF ?? "",
  gridTerminalImageSourceRepo: process.env.BITTERGIT_GRID_TERMINAL_IMAGE_SOURCE_REPO ?? "",
  gridTerminalImageSourceCommit: process.env.BITTERGIT_GRID_TERMINAL_IMAGE_SOURCE_COMMIT ?? "",
  gridTerminalImageSourcePath: process.env.BITTERGIT_GRID_TERMINAL_IMAGE_SOURCE_PATH ?? "docker/backstage-terminal",
  dataRoot,
  reposRoot: join(dataRoot, "repos"),
  workcellsRoot: join(dataRoot, "workcells"),
  dbPath: join(dataRoot, "dev.sqlite")
};

export function cloneUrl(owner: string, name: string): string {
  const base = config.publicBaseUrl || `http://${config.host}:${config.port}`;
  return `${base.replace(/\/+$/, "")}/${owner}/${name}.git`;
}
