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
  serverHeapGrowthBytes: 64 * 1024 * 1024,
  browserHeapGrowthBytes: 128 * 1024 * 1024,
} as const;
