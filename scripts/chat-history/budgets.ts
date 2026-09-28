// Engineering targets, not measured guarantees. Timings require a controlled runner.
export const historyBudgets = {
  warmReadBytes: 0,
  duplicateMessages: 0,
  unchangedRowsRecreated: 0,
  findMountedRows: 100,
  pageBytes: 256 * 1024,
  coldReaderP95Ms: 500,
  warmReaderP95Ms: 50,
  coldHttpP95Ms: 750,
  warmHttpP95Ms: 150,
  browserOpenP95Ms: 1000,
  browserFindP95Ms: 500,
  frameP95Ms: 32,
  maxLongTaskMs: 200,
  walkJumpPx: 2,
  // Per older-history step on the bursts fixture, both scroll modes: at most 1 and 9 measured (2026-09-27).
  rerenderedRowsPerStep: 2,
  commitsPerStep: 12,
  serverHeapGrowthBytes: 64 * 1024 * 1024,
  browserHeapGrowthBytes: 128 * 1024 * 1024,
} as const;
