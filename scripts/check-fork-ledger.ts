import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type ForkCommit = {
  hash: string;
  subject: string;
  files?: string[];
};

export type LedgerAnalysis = {
  missing: ForkCommit[];
  unexpected: string[];
  allowedMissingHead?: ForkCommit;
};

export function parseLedgerCommitHashes(markdown: string): Set<string> {
  const hashes = new Set<string>();
  let inLedger = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim() === "## Fork-Only Commit Ledger") {
      inLedger = true;
      continue;
    }

    if (inLedger && line.startsWith("## ")) {
      break;
    }

    if (!inLedger) {
      continue;
    }

    const match = line.match(/^\|\s*`([0-9a-f]{7,40})`\s*\|/i);
    if (match) {
      hashes.add(match[1]);
    }
  }

  return hashes;
}

export function parseGitLog(output: string): ForkCommit[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, subject = ""] = line.split("\0");
      return { hash, subject };
    });
}

export function analyzeForkLedger(input: {
  forkCommits: ForkCommit[];
  ledgerHashes: Set<string>;
  headHash: string;
}): LedgerAnalysis {
  const forkHashes = new Set(input.forkCommits.map((commit) => commit.hash));
  const result: LedgerAnalysis = {
    missing: [],
    unexpected: [],
  };

  for (const commit of input.forkCommits) {
    if (input.ledgerHashes.has(commit.hash)) {
      continue;
    }

    if (isAllowedMissingHead(commit, input.headHash)) {
      result.allowedMissingHead = commit;
      continue;
    }

    result.missing.push(commit);
  }

  for (const hash of input.ledgerHashes) {
    if (!forkHashes.has(hash)) {
      result.unexpected.push(hash);
    }
  }

  return result;
}

function isAllowedMissingHead(commit: ForkCommit, headHash: string): boolean {
  return (
    commit.hash === headHash &&
    commit.subject.startsWith("docs(fork):") &&
    /\bledger\b/i.test(commit.subject) &&
    commit.files?.some((file) => file === "FORK.md")
  );
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readForkCommits(): ForkCommit[] {
  try {
    return parseGitLog(git(["log", "--format=%h%x00%s", "upstream/main..HEAD"]));
  } catch (error) {
    throw new Error(
      [
        "Unable to read fork-only history from upstream/main..HEAD.",
        "Fetch upstream first:",
        "  git fetch upstream main:refs/remotes/upstream/main",
      ].join("\n"),
      { cause: error }
    );
  }
}

function formatFailure(analysis: LedgerAnalysis): string {
  const lines = ["Fork-only commit ledger is out of date."];

  if (analysis.missing.length > 0) {
    lines.push("", "Missing from FORK.md:");
    for (const commit of analysis.missing) {
      lines.push(`  ${commit.hash} ${commit.subject}`);
    }
  }

  if (analysis.unexpected.length > 0) {
    lines.push("", "Unexpected in FORK.md:");
    for (const hash of analysis.unexpected) {
      lines.push(`  ${hash}`);
    }
  }

  lines.push("", "Update the Fork-Only Commit Ledger before merging.");
  return lines.join("\n");
}

function main(): number {
  const headHash = git(["rev-parse", "--short", "HEAD"]).trim();
  const headFiles = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
    .split(/\r?\n/)
    .filter(Boolean);
  const forkCommits = readForkCommits().map((commit) =>
    commit.hash === headHash ? { ...commit, files: headFiles } : commit
  );
  const ledgerHashes = parseLedgerCommitHashes(readFileSync("FORK.md", "utf8"));
  const analysis = analyzeForkLedger({ forkCommits, ledgerHashes, headHash });

  if (analysis.missing.length > 0 || analysis.unexpected.length > 0) {
    console.error(formatFailure(analysis));
    return 1;
  }

  console.log(`Fork-only commit ledger is current. ${forkCommits.length} fork commits checked.`);
  if (analysis.allowedMissingHead) {
    console.log(
      `Current HEAD ${analysis.allowedMissingHead.hash} is a ledger-maintenance commit and may be added by the next ledger sweep.`
    );
  }

  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
