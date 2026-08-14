import { describe, expect, test } from "bun:test";
import {
  analyzeUpstreamDrift,
  formatDriftReport,
  parseGhPullRequests,
  parseRecordedUpstreamBase,
  parseUpstreamPullRequestTable,
  type UpstreamCommit,
} from "./check-upstream-drift";

const forkWithoutStamps = `
# Portless Fork Notes

## Fork-Only Commit Ledger

| Commit | Purpose |
| ------ | ------- |
| \`e3c746e\` | Merged upstream v0.15.5 at \`326e893\`. |

## Upstream Open PR Triage

### Full Open Upstream PR State on 2026-06-18

| PR | State | Fork decision |
| --- | --- | --- |
| [#101 First change](https://github.com/vercel-labs/portless/pull/101) | implemented | Kept. |
| [#202 Second change](https://github.com/vercel-labs/portless/pull/202) | implemented differently | Adapted. |

## Sync Checklist

The next section is not part of the PR table.
`;

const forkWithStamps = `
## Fork-Only Commit Ledger

| Commit | Purpose |
| ------ | ------- |
| \`e3c746e\` | Merged upstream v0.15.5 at \`326e893\`. |

## Upstream Open PR Triage

### Full Open Upstream PR State on 2026-06-18

| PR | State | Fork decision | Triage date | Upstream head SHA |
| --- | --- | --- | --- | --- |
| [#101 First change](https://github.com/vercel-labs/portless/pull/101) | implemented | Kept. | 2026-06-18 | \`aaa1111\` |
| [#202 Second change](https://github.com/vercel-labs/portless/pull/202) | implemented differently | Adapted. | 2026-06-18 | \`bbb2222\` |
| [#404 Closed change](https://github.com/vercel-labs/portless/pull/404) | implemented | Kept. | 2026-06-18 | \`ccc3333\` |

## Sync Checklist
`;

const forkWithAlternateStampHeaders = `
### Full Open Upstream PR State on 2026-06-18

| PR | State | Fork decision | Triaged | Upstream head |
| --- | --- | --- | --- | --- |
| [#101 First change](https://github.com/vercel-labs/portless/pull/101) | implemented | Kept. | 2026-06-18 | \`aaa1111\` |
`;

describe("parseRecordedUpstreamBase", () => {
  test("reads the upstream merge base recorded in the fork ledger", () => {
    expect(parseRecordedUpstreamBase(forkWithoutStamps)).toBe("326e893");
  });
});

describe("parseUpstreamPullRequestTable", () => {
  test("reads PR numbers and tolerates a table without stamp columns", () => {
    const result = parseUpstreamPullRequestTable(forkWithoutStamps);

    expect([...result.pullRequests.keys()]).toEqual([101, 202]);
    expect(result.stampColumns).toEqual({ triageDate: null, headSha: null });
  });

  test("reads triage stamps when the columns are present", () => {
    const result = parseUpstreamPullRequestTable(forkWithStamps);

    expect(result.pullRequests.get(101)).toEqual({
      number: 101,
      triageDate: "2026-06-18",
      recordedHeadSha: "aaa1111",
    });
    expect(result.stampColumns).toEqual({ triageDate: 3, headSha: 4 });
  });

  test("accepts concise stamp headers used by later ledger revisions", () => {
    const result = parseUpstreamPullRequestTable(forkWithAlternateStampHeaders);

    expect(result.pullRequests.get(101)).toEqual({
      number: 101,
      triageDate: "2026-06-18",
      recordedHeadSha: "aaa1111",
    });
    expect(result.stampColumns).toEqual({ triageDate: 3, headSha: 4 });
  });
});

describe("parseGhPullRequests", () => {
  test("parses the open PR numbers and head SHAs returned by gh", () => {
    expect(
      parseGhPullRequests(
        JSON.stringify([
          { number: 101, headRefOid: "aaa1111abcdef" },
          { number: 202, headRefOid: "bbb9999abcdef" },
        ])
      )
    ).toEqual([
      { number: 101, headSha: "aaa1111abcdef" },
      { number: 202, headSha: "bbb9999abcdef" },
    ]);
  });
});

describe("analyzeUpstreamDrift", () => {
  test("reports base, open-PR set, and changed-head drift independently", () => {
    const upstreamCommits: UpstreamCommit[] = [{ hash: "feed123", subject: "Upstream change" }];

    const result = analyzeUpstreamDrift({
      recordedBase: "326e893",
      upstreamCommits,
      livePullRequests: [
        { number: 101, headSha: "aaa1111abcdef" },
        { number: 202, headSha: "bbb9999abcdef" },
        { number: 303, headSha: "ddd4444abcdef" },
      ],
      ledger: parseUpstreamPullRequestTable(forkWithStamps),
    });

    expect(result.baseCommits).toEqual(upstreamCommits);
    expect(result.missingFromLedger).toEqual([303]);
    expect(result.noLongerOpen).toEqual([404]);
    expect(result.stampDrift).toEqual([
      {
        number: 202,
        recordedHeadSha: "bbb2222",
        currentHeadSha: "bbb9999abcdef",
      },
    ]);
    expect(result.unstamped).toEqual([]);
  });

  test("reports missing stamps without making them fatal", () => {
    const result = analyzeUpstreamDrift({
      recordedBase: "326e893",
      upstreamCommits: [],
      livePullRequests: [
        { number: 101, headSha: "aaa1111abcdef" },
        { number: 202, headSha: "bbb2222abcdef" },
      ],
      ledger: parseUpstreamPullRequestTable(forkWithoutStamps),
    });

    expect(result.stampColumnsPresent).toBe(false);
    expect(result.stampDrift).toEqual([]);
    expect(result.unstamped).toEqual([101, 202]);

    const report = formatDriftReport(result);
    expect(report).toContain("No upstream drift detected.");
    expect(report).toContain("stamp drift was not checked");
    expect(report).toContain("#101");
  });
});
