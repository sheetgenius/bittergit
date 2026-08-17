import { spawnSync } from "node:child_process";

const secretPatterns: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["stripe live key", /sk_live_[A-Za-z0-9]{12,}/],
  ["github token", /ghp_[A-Za-z0-9]{20,}/],
  ["slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ["aws access key", /AKIA[0-9A-Z]{16}/]
];

export function scanUnsafeSource(gitDir: string, commitSha: string): void {
  const files = gitOutput(["--git-dir", gitDir, "ls-tree", "-r", "--name-only", commitSha])
    .split("\n")
    .filter((line) => line.length > 0);

  for (const file of files) {
    const basename = file.split("/").pop() ?? file;
    if ((basename === ".env" || basename.startsWith(".env.")) && basename !== ".env.example") {
      throw new Error(`blocked unsafe source path ${file}`);
    }
  }

  for (const file of files) {
    const content = gitShow(gitDir, commitSha, file);
    if (content === undefined) continue;

    for (const [label, pattern] of secretPatterns) {
      if (pattern.test(content)) {
        throw new Error(`blocked high-confidence secret (${label}) in ${file}`);
      }
    }
  }
}

export function assertSafeTextForStorage(label: string, value: string): void {
  for (const [patternLabel, pattern] of secretPatterns) {
    if (pattern.test(value)) {
      throw new Error(`blocked high-confidence secret (${patternLabel}) in ${label}`);
    }
  }
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function gitShow(gitDir: string, commitSha: string, file: string): string | undefined {
  const result = spawnSync("git", ["--git-dir", gitDir, "show", `${commitSha}:${file}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });

  if (result.status !== 0) return undefined;
  return result.stdout;
}
