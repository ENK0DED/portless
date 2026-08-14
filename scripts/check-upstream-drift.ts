import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type UpstreamCommit = {
  hash: string;
  subject: string;
};

export type UpstreamPullRequest = {
  number: number;
  headSha: string;
};

export type LedgerPullRequest = {
  number: number;
  triageDate?: string;
  recordedHeadSha?: string;
};

export type StampColumns = {
  triageDate: number | null;
  headSha: number | null;
};

export type ParsedUpstreamPullRequestTable = {
  pullRequests: Map<number, LedgerPullRequest>;
  stampColumns: StampColumns;
};

export type StampDrift = {
  number: number;
  recordedHeadSha: string;
  currentHeadSha: string;
};

export type UpstreamDriftAnalysis = {
  recordedBase: string;
  baseCommits: UpstreamCommit[];
  missingFromLedger: number[];
  noLongerOpen: number[];
  stampDrift: StampDrift[];
  unstamped: number[];
  stampColumnsPresent: boolean;
};

export function parseRecordedUpstreamBase(markdown: string): string {
  const matches = [...markdown.matchAll(/Merged upstream\b[^\r\n]*?\bat\s+`([0-9a-f]{7,40})`/gi)];

  const recordedBase = matches.at(-1)?.[1];
  if (!recordedBase) {
    throw new Error(
      "Unable to find the recorded upstream base in FORK.md. Add the upstream merge base to the fork ledger."
    );
  }

  return recordedBase;
}

export function parseGitLog(output: string): UpstreamCommit[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, subject = ""] = line.split("\0");
      return { hash, subject };
    });
}

export function parseUpstreamPullRequestTable(markdown: string): ParsedUpstreamPullRequestTable {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) =>
    /^###\s+Full Open Upstream PR State\b/i.test(line.trim())
  );

  if (headingIndex === -1) {
    throw new Error("Unable to find FORK.md's Full Open Upstream PR State table.");
  }

  const tableEnd = lines.findIndex(
    (line, index) => index > headingIndex && /^#{1,3}\s/.test(line.trim())
  );
  const sectionLines = lines.slice(headingIndex + 1, tableEnd === -1 ? lines.length : tableEnd);
  const headerIndex = sectionLines.findIndex((line) => {
    const cells = splitTableRow(line);
    return cells[0]?.toLowerCase() === "pr";
  });

  if (headerIndex === -1) {
    throw new Error(
      "Unable to find the header row in FORK.md's Full Open Upstream PR State table."
    );
  }

  const header = splitTableRow(sectionLines[headerIndex]);
  const stampColumns = findStampColumns(header);
  const pullRequests = new Map<number, LedgerPullRequest>();

  for (const line of sectionLines.slice(headerIndex + 1)) {
    if (!line.trim().startsWith("|")) {
      break;
    }

    const cells = splitTableRow(line);
    const numberMatch = cells[0]?.match(/\[#(\d+)\b/);
    if (!numberMatch || isTableSeparator(cells)) {
      continue;
    }

    const number = Number(numberMatch[1]);
    const entry: LedgerPullRequest = { number };

    if (stampColumns.triageDate !== null) {
      const triageDate = parseDate(cells[stampColumns.triageDate] ?? "");
      if (triageDate) {
        entry.triageDate = triageDate;
      }
    }

    if (stampColumns.headSha !== null) {
      const recordedHeadSha = parseSha(cells[stampColumns.headSha] ?? "");
      if (recordedHeadSha) {
        entry.recordedHeadSha = recordedHeadSha;
      }
    }

    pullRequests.set(number, entry);
  }

  return { pullRequests, stampColumns };
}

export function parseGhPullRequests(output: string): UpstreamPullRequest[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error("GitHub CLI returned invalid JSON for the open PR list.", {
      cause: error,
    });
  }

  if (!Array.isArray(parsed)) {
    throw new Error("GitHub CLI returned an unexpected open PR list.");
  }

  return parsed.map((item, index) => {
    if (!isRecord(item) || !Number.isInteger(item.number)) {
      throw new Error(`GitHub CLI returned an invalid PR at index ${index}.`);
    }

    if (typeof item.headRefOid !== "string" || !parseSha(item.headRefOid)) {
      throw new Error(`GitHub CLI returned an invalid head SHA for PR #${item.number}.`);
    }

    return { number: item.number, headSha: item.headRefOid };
  });
}

export function analyzeUpstreamDrift(input: {
  recordedBase: string;
  upstreamCommits: UpstreamCommit[];
  livePullRequests: UpstreamPullRequest[];
  ledger: ParsedUpstreamPullRequestTable;
}): UpstreamDriftAnalysis {
  const liveNumbers = new Set(input.livePullRequests.map((pullRequest) => pullRequest.number));
  const ledgerNumbers = new Set(input.ledger.pullRequests.keys());
  const missingFromLedger = input.livePullRequests
    .filter((pullRequest) => !ledgerNumbers.has(pullRequest.number))
    .map((pullRequest) => pullRequest.number)
    .sort((left, right) => left - right);
  const noLongerOpen = [...ledgerNumbers]
    .filter((number) => !liveNumbers.has(number))
    .sort((left, right) => left - right);
  const stampDrift: StampDrift[] = [];
  const unstamped: number[] = [];

  for (const pullRequest of input.livePullRequests) {
    const ledgerEntry = input.ledger.pullRequests.get(pullRequest.number);
    if (!ledgerEntry) {
      continue;
    }

    if (!ledgerEntry.recordedHeadSha) {
      unstamped.push(pullRequest.number);
      continue;
    }

    if (sameSha(ledgerEntry.recordedHeadSha, pullRequest.headSha)) {
      continue;
    }

    stampDrift.push({
      number: pullRequest.number,
      recordedHeadSha: ledgerEntry.recordedHeadSha,
      currentHeadSha: pullRequest.headSha,
    });
  }

  unstamped.sort((left, right) => left - right);
  stampDrift.sort((left, right) => left.number - right.number);

  return {
    recordedBase: input.recordedBase,
    baseCommits: input.upstreamCommits,
    missingFromLedger,
    noLongerOpen,
    stampDrift,
    unstamped,
    stampColumnsPresent:
      input.ledger.stampColumns.triageDate !== null || input.ledger.stampColumns.headSha !== null,
  };
}

export function formatDriftReport(analysis: UpstreamDriftAnalysis): string {
  const hasActionableDrift =
    analysis.baseCommits.length > 0 ||
    analysis.missingFromLedger.length > 0 ||
    analysis.noLongerOpen.length > 0 ||
    analysis.stampDrift.length > 0;
  const lines = [
    hasActionableDrift ? "Upstream drift detected." : "No upstream drift detected.",
    "",
    `Recorded upstream base: ${analysis.recordedBase}.`,
  ];

  if (analysis.baseCommits.length > 0) {
    lines.push("", "Commits in the recorded base..upstream/main range:");
    for (const commit of analysis.baseCommits) {
      lines.push(`  ${commit.hash} ${commit.subject}`);
    }
  } else {
    lines.push("No upstream commits are ahead of the recorded base.");
  }

  if (analysis.missingFromLedger.length > 0) {
    lines.push("", "Open upstream PRs missing from FORK.md:");
    for (const number of analysis.missingFromLedger) {
      lines.push(`  #${number}`);
    }
  }

  if (analysis.noLongerOpen.length > 0) {
    lines.push("", "FORK.md PR entries that are no longer open upstream:");
    for (const number of analysis.noLongerOpen) {
      lines.push(`  #${number}`);
    }
  }

  if (analysis.stampDrift.length > 0) {
    lines.push("", "Triaged PRs whose upstream head SHA changed:");
    for (const drift of analysis.stampDrift) {
      lines.push(
        `  #${drift.number}: recorded ${drift.recordedHeadSha}, current ${drift.currentHeadSha}`
      );
    }
  }

  if (!analysis.stampColumnsPresent) {
    lines.push("", "Warning: FORK.md has no triage stamp columns; stamp drift was not checked.");
    if (analysis.unstamped.length > 0) {
      lines.push("Unstamped open PRs:");
      for (const number of analysis.unstamped) {
        lines.push(`  #${number}`);
      }
    }
  } else if (analysis.unstamped.length > 0) {
    lines.push("", "Warning: these open PRs have no usable triage head stamp:");
    for (const number of analysis.unstamped) {
      lines.push(`  #${number}`);
    }
  }

  return lines.join("\n");
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) {
    return [];
  }

  const withoutOuterPipes = trimmed.slice(1).replace(/\|\s*$/, "");
  return withoutOuterPipes.split("|").map((cell) => cell.trim());
}

function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function findStampColumns(header: string[]): StampColumns {
  const triageDate = header.findIndex((cell) => {
    const normalized = normalizeHeader(cell);
    return (
      (normalized.includes("triage") &&
        (normalized.includes("date") || normalized.includes("stamp"))) ||
      normalized === "triaged"
    );
  });
  const headSha = header.findIndex((cell) => {
    const normalized = normalizeHeader(cell);
    return (
      (normalized.includes("head") && (normalized.includes("sha") || normalized.includes("oid"))) ||
      normalized === "upstream head" ||
      (normalized.includes("upstream") &&
        (normalized.includes("sha") || normalized.includes("oid")))
    );
  });

  if (header.length >= 5 && triageDate === -1 && headSha === -1) {
    return { triageDate: 3, headSha: 4 };
  }

  return {
    triageDate: triageDate === -1 ? null : triageDate,
    headSha: headSha === -1 ? null : headSha,
  };
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseDate(cell: string): string | undefined {
  return cell.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
}

function parseSha(cell: string): string | undefined {
  return cell.match(/\b([0-9a-f]{7,40})\b/i)?.[1];
}

function sameSha(left: string, right: string): boolean {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    (normalizedLeft.length >= 7 && normalizedRight.startsWith(normalizedLeft)) ||
    (normalizedRight.length >= 7 && normalizedLeft.startsWith(normalizedRight))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readUpstreamCommits(recordedBase: string): UpstreamCommit[] {
  try {
    return parseGitLog(git(["log", "--format=%h%x00%s", `${recordedBase}..upstream/main`]));
  } catch (error) {
    throw new Error(
      [
        `Unable to read upstream history from ${recordedBase}..upstream/main.`,
        "Fetch upstream first:",
        "  git fetch upstream main:refs/remotes/upstream/main",
      ].join("\n"),
      { cause: error }
    );
  }
}

function readOpenPullRequests(): UpstreamPullRequest[] {
  try {
    const output = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        "vercel-labs/portless",
        "--state",
        "open",
        "--limit",
        "1000",
        "--json",
        "number,headRefOid",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return parseGhPullRequests(output);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      throw new Error(
        "Unable to query upstream open PRs: the gh CLI is not installed. Install GitHub CLI and run `gh auth login`.",
        { cause: error }
      );
    }

    const stderr =
      isRecord(error) && (typeof error.stderr === "string" || Buffer.isBuffer(error.stderr))
        ? String(error.stderr).trim()
        : "";
    throw new Error(
      [
        "Unable to query upstream open PRs: gh is unavailable or unauthenticated.",
        "Ensure GitHub CLI is installed and authenticated with `gh auth login`.",
        stderr,
      ]
        .filter(Boolean)
        .join("\n"),
      { cause: error }
    );
  }
}

function main(): number {
  const forkMarkdown = readFileSync("FORK.md", "utf8");
  const recordedBase = parseRecordedUpstreamBase(forkMarkdown);
  const ledger = parseUpstreamPullRequestTable(forkMarkdown);
  const analysis = analyzeUpstreamDrift({
    recordedBase,
    upstreamCommits: readUpstreamCommits(recordedBase),
    livePullRequests: readOpenPullRequests(),
    ledger,
  });
  const report = formatDriftReport(analysis);

  if (
    analysis.baseCommits.length > 0 ||
    analysis.missingFromLedger.length > 0 ||
    analysis.noLongerOpen.length > 0 ||
    analysis.stampDrift.length > 0
  ) {
    console.error(report);
    return 1;
  }

  console.log(report);
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
