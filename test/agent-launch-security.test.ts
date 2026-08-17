import { describe, expect, test } from "bun:test";
import { isBitterGitRemote } from "../src/agent-launches";
import { cloneUrl } from "../src/config";

describe("hosted agent origin classification", () => {
  const repo = { owner: "example", name: "app" };

  test("requires the configured BitterGit origin exactly", () => {
    expect(isBitterGitRemote(cloneUrl(repo.owner, repo.name), repo)).toBe(true);
    expect(isBitterGitRemote(`${cloneUrl(repo.owner, repo.name)}?mirror=github.com`, repo)).toBe(false);
    expect(isBitterGitRemote("https://attacker.example/example/app.git", repo)).toBe(false);
    expect(isBitterGitRemote("https://github.com.attacker.example/example/app.git", repo)).toBe(false);
    expect(isBitterGitRemote("https://attacker.example/github.com/example/app.git", repo)).toBe(false);
    expect(isBitterGitRemote("http://user:password@127.0.0.1:7420/example/app.git", repo)).toBe(false);
  });
});
