import { describe, expect, test } from "bun:test";
import { analyzeForkLedger, parseLedgerCommitHashes, type ForkCommit } from "./check-fork-ledger";

const ledger = (rows: string) => `# Portless Fork Notes

## Fork-Only Commit Ledger

Current fork-owned commits and what they protect:

| Commit | Purpose |
| ------ | ------- |
${rows}

## Fork-Owned Invariants

The rest of the file can mention \`1234567\` without affecting the ledger.
`;

const commit = (
  hash: string,
  subject = "feat(proxy): add behavior",
  files: string[] = ["packages/portless/src/proxy.ts"]
): ForkCommit => ({ hash, subject, files });

describe("parseLedgerCommitHashes", () => {
  test("reads commit hashes only from the fork-only commit ledger table", () => {
    expect(
      parseLedgerCommitHashes(
        ledger(
          [
            "| `abc1234` | Added one fork behavior. |",
            "| `def5678` | Added another fork behavior. |",
          ].join("\n")
        )
      )
    ).toEqual(new Set(["abc1234", "def5678"]));
  });
});

describe("analyzeForkLedger", () => {
  test("reports fork commits missing from FORK.md", () => {
    const result = analyzeForkLedger({
      forkCommits: [commit("abc1234"), commit("def5678")],
      ledgerHashes: new Set(["abc1234"]),
      headHash: "def5678",
    });

    expect(result.missing).toEqual([commit("def5678")]);
    expect(result.unexpected).toEqual([]);
  });

  test("allows the current HEAD to be absent when it is a ledger-maintenance commit touching FORK.md", () => {
    const result = analyzeForkLedger({
      forkCommits: [
        commit("abc1234"),
        commit("def5678", "docs(fork): update fork-only ledger", ["FORK.md"]),
      ],
      ledgerHashes: new Set(["abc1234"]),
      headHash: "def5678",
    });

    expect(result.missing).toEqual([]);
    expect(result.allowedMissingHead?.hash).toBe("def5678");
  });

  test("does not exempt non-ledger HEAD commits", () => {
    const result = analyzeForkLedger({
      forkCommits: [commit("abc1234", "feat(proxy): add route guard", ["FORK.md"])],
      ledgerHashes: new Set(),
      headHash: "abc1234",
    });

    expect(result.missing).toEqual([
      commit("abc1234", "feat(proxy): add route guard", ["FORK.md"]),
    ]);
    expect(result.allowedMissingHead).toBeUndefined();
  });

  test("reports ledger hashes that are not in fork-only history", () => {
    const result = analyzeForkLedger({
      forkCommits: [commit("abc1234")],
      ledgerHashes: new Set(["abc1234", "def5678"]),
      headHash: "abc1234",
    });

    expect(result.missing).toEqual([]);
    expect(result.unexpected).toEqual(["def5678"]);
  });
});
