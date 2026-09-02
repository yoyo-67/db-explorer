import type { PartitionEntry } from '#/lib/anatomy/types'

/**
 * A partitioned table is one relation to a query and many to the storage, and
 * the two views disagree in ways worth seeing: a default partition quietly
 * collecting rows that were meant to go elsewhere, one partition holding most of
 * the data so pruning buys nothing, or a range table with no partition covering
 * the near future — where the next insert fails.
 */

export type PartitionConcern = 'default-filling' | 'skewed' | 'empty' | null

/** A default partition holding real data means rows are missing a home. */
export const DEFAULT_PARTITION_ROWS = 1

/** One partition holding this much of the table makes pruning cosmetic. */
export const SKEW_SHARE = 0.9

export function partitionConcern(entry: PartitionEntry): PartitionConcern {
  if (entry.partitionCount === 0) return 'empty'
  const def = entry.defaultPartition
  if (def) {
    const partition = entry.partitions.find((candidate) => candidate.name === def)
    if (partition && partition.estimatedRows >= DEFAULT_PARTITION_ROWS) return 'default-filling'
  }
  const total = entry.partitions.reduce((sum, partition) => sum + partition.bytes, 0)
  if (total > 0) {
    const largest = Math.max(...entry.partitions.map((partition) => partition.bytes))
    if (largest / total >= SKEW_SHARE && entry.partitionCount > 1) return 'skewed'
  }
  return null
}

export const CONCERN_TEXT: Record<Exclude<PartitionConcern, null>, string> = {
  'default-filling':
    'The default partition holds rows. Every one of them is a row no other partition claimed — usually a missing partition rather than a deliberate catch-all.',
  skewed:
    'Nearly all the data sits in one partition, so partition pruning removes almost nothing from a scan.',
  empty: 'Partitioned, but no partitions are attached: every insert fails.',
}
