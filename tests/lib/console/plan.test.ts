import { describe, expect, it } from 'vitest'
import { parsePlan, planWarnings } from '#/lib/console/plan'

/** A plan as Postgres hands it over: `EXPLAIN (FORMAT JSON)` returns an array
 *  of one object whose `Plan` is the root node. */
const seqScan = {
  'Node Type': 'Seq Scan',
  'Relation Name': 'orders',
  Alias: 'o',
  'Startup Cost': 0,
  'Total Cost': 1850.5,
  'Plan Rows': 12,
  'Plan Width': 44,
  Filter: '(status = \'open\'::text)',
}

const analyzed = {
  Plan: {
    'Node Type': 'Nested Loop',
    'Total Cost': 2000,
    'Plan Rows': 10,
    'Actual Total Time': 120,
    'Actual Rows': 9,
    'Actual Loops': 1,
    Plans: [
      {
        ...seqScan,
        'Actual Total Time': 100,
        'Actual Rows': 9,
        'Actual Loops': 1,
        'Rows Removed by Filter': 400_000,
      },
      {
        'Node Type': 'Index Scan',
        'Relation Name': 'customers',
        'Index Name': 'customers_pkey',
        'Total Cost': 8,
        'Plan Rows': 1,
        'Actual Total Time': 1,
        'Actual Rows': 1,
        'Actual Loops': 9,
      },
    ],
  },
  'Planning Time': 0.4,
  'Execution Time': 121.2,
}

describe('parsePlan', () => {
  it('reads a lone node', () => {
    const plan = parsePlan([{ Plan: seqScan }])
    expect(plan?.root).toMatchObject({
      nodeType: 'Seq Scan',
      relation: 'orders',
      alias: 'o',
      totalCost: 1850.5,
      planRows: 12,
      condition: "(status = 'open'::text)",
    })
    expect(plan?.root.children).toEqual([])
  })

  it('reads the tree and the timings around it', () => {
    const plan = parsePlan([analyzed])
    expect(plan?.planningMs).toBe(0.4)
    expect(plan?.executionMs).toBe(121.2)
    expect(plan?.analyzed).toBe(true)
    expect(plan?.root.children.map((c) => c.nodeType)).toEqual(['Seq Scan', 'Index Scan'])
  })

  it('knows a plan that was never run', () => {
    const plan = parsePlan([{ Plan: seqScan }])
    expect(plan?.analyzed).toBe(false)
    expect(plan?.root.actualRows).toBeNull()
  })

  /**
   * The number people misread. A child's `Actual Total Time` is the average of
   * one loop, so its share of the wall clock is that times its loop count — and
   * a node's own cost is what is left after its children are taken off.
   */
  it('multiplies a looped child by its loops before subtracting it', () => {
    const plan = parsePlan([analyzed])!
    const [scan, index] = plan.root.children
    expect(index.totalMs).toBe(9) // 1ms × 9 loops
    expect(scan.totalMs).toBe(100)
    // 120 total, less 100 and 9 spent below it.
    expect(plan.root.selfMs).toBeCloseTo(11)
  })

  it('names the node that actually costs the time', () => {
    const plan = parsePlan([analyzed])!
    expect(plan.hottest?.nodeType).toBe('Seq Scan')
  })

  it('falls back to cost for the hottest node when nothing was measured', () => {
    const plan = parsePlan([
      {
        Plan: {
          'Node Type': 'Hash Join',
          'Total Cost': 100,
          'Plan Rows': 1,
          Plans: [seqScan],
        },
      },
    ])!
    expect(plan.hottest?.nodeType).toBe('Seq Scan')
  })

  it('gives every node an id, so a tree can be drawn and keyed', () => {
    const plan = parsePlan([analyzed])!
    const ids = [plan.root.id, ...plan.root.children.map((c) => c.id)]
    expect(new Set(ids).size).toBe(3)
  })

  it('has nothing to say about a shape that is not a plan', () => {
    expect(parsePlan(null)).toBeNull()
    expect(parsePlan([])).toBeNull()
    expect(parsePlan([{ nope: 1 }])).toBeNull()
  })
})

describe('planWarnings', () => {
  it('calls out a sequential scan that threw away most of what it read', () => {
    const plan = parsePlan([analyzed])!
    const found = planWarnings(plan)
    expect(found.map((w) => w.kind)).toContain('seq-scan-filtered')
    expect(found.find((w) => w.kind === 'seq-scan-filtered')?.node.relation).toBe('orders')
  })

  it('calls out an estimate the planner got badly wrong', () => {
    const plan = parsePlan([
      {
        Plan: {
          'Node Type': 'Seq Scan',
          'Relation Name': 'orders',
          'Total Cost': 10,
          'Plan Rows': 1,
          'Actual Rows': 5000,
          'Actual Loops': 1,
          'Actual Total Time': 5,
        },
      },
    ])!
    expect(planWarnings(plan).map((w) => w.kind)).toContain('estimate-off')
  })

  it('calls out a sort that had to go to disk', () => {
    const plan = parsePlan([
      {
        Plan: {
          'Node Type': 'Sort',
          'Total Cost': 10,
          'Plan Rows': 1,
          'Sort Method': 'external merge',
          'Sort Space Used': 24_000,
          'Sort Space Type': 'Disk',
        },
      },
    ])!
    expect(planWarnings(plan).map((w) => w.kind)).toContain('sort-spilled')
  })

  it('says nothing about a plan with nothing wrong with it', () => {
    const plan = parsePlan([
      {
        Plan: {
          'Node Type': 'Index Scan',
          'Relation Name': 'orders',
          'Index Name': 'orders_pkey',
          'Total Cost': 8,
          'Plan Rows': 1,
          'Actual Rows': 1,
          'Actual Loops': 1,
          'Actual Total Time': 0.1,
        },
      },
    ])!
    expect(planWarnings(plan)).toEqual([])
  })

  it('does not accuse a small table of needing an index', () => {
    const plan = parsePlan([
      {
        Plan: {
          'Node Type': 'Seq Scan',
          'Relation Name': 'countries',
          'Total Cost': 3,
          'Plan Rows': 200,
          'Actual Rows': 200,
          'Actual Loops': 1,
          'Actual Total Time': 0.2,
          Filter: '(code = 1)',
          'Rows Removed by Filter': 40,
        },
      },
    ])!
    expect(planWarnings(plan)).toEqual([])
  })
})

/**
 * A `Limit` is charged only for the rows it pulls, so its total cost is lower
 * than the totals of the nodes it sits above. Anything that treats the root's
 * total as "the whole" is wrong for every query with a LIMIT in it — which is
 * most of the ones anybody explains.
 */
describe('what a node’s share is a share of', () => {
  const limited = [
    {
      Plan: {
        'Node Type': 'Limit',
        'Total Cost': 3414,
        'Plan Rows': 100,
        Plans: [
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'data_activity',
            'Total Cost': 14186,
            'Plan Rows': 69728,
          },
        ],
      },
    },
  ]

  it('adds up what each node costs on its own', () => {
    const plan = parsePlan(limited)!
    // The Limit is charged less than its child, so it has no self cost left.
    expect(plan.root.selfCost).toBe(0)
    expect(plan.totalSelfCost).toBe(14186)
  })

  it('never lets a node’s share of the total exceed the total', () => {
    const plan = parsePlan(limited)!
    for (const node of [plan.root, ...plan.root.children]) {
      expect(node.selfCost).toBeLessThanOrEqual(plan.totalSelfCost)
    }
  })

  it('measures the same way for a plan that was run', () => {
    const plan = parsePlan([analyzed])!
    // Self times partition the wall clock, so they add back up to it.
    expect(plan.totalSelfMs).toBeCloseTo(plan.root.totalMs!)
  })
})

/**
 * The plan a real query produced, reduced: `LIMIT 100` over a scan the planner
 * expected 69,728 rows from. Every node reports 100 actual rows because the
 * Limit stopped them, and warning about that on all four was the bug this
 * fixture exists to prevent.
 */
const limitedRun = [
  {
    Plan: {
      'Node Type': 'Limit',
      'Total Cost': 3414,
      'Plan Rows': 100,
      'Actual Rows': 100,
      'Actual Loops': 1,
      'Actual Total Time': 1.5,
      Plans: [
        {
          'Node Type': 'Nested Loop',
          'Total Cost': 5185,
          'Plan Rows': 69_728,
          'Actual Rows': 100,
          'Actual Loops': 1,
          'Actual Total Time': 1.4,
          Plans: [
            {
              'Node Type': 'Index Scan',
              'Relation Name': 'data_activity',
              'Index Name': 'data_useractivity_pkey',
              'Total Cost': 14_186,
              'Plan Rows': 69_728,
              'Actual Rows': 100,
              'Actual Loops': 1,
              'Actual Total Time': 0.3,
              Filter: '(parent_activity_id IS NULL)',
            },
          ],
        },
      ],
    },
    'Planning Time': 1.4,
    'Execution Time': 1.5,
  },
]

describe('a plan cut short by a LIMIT', () => {
  it('does not call the planner wrong for rows a LIMIT stopped', () => {
    const plan = parsePlan(limitedRun)!
    expect(planWarnings(plan)).toEqual([])
  })

  it('still reports an estimate the planner under-called', () => {
    // Same shape, but the scan produced far more than predicted — which no
    // Limit above it can explain.
    const over = JSON.parse(JSON.stringify(limitedRun))
    const scan = over[0].Plan.Plans[0].Plans[0]
    scan['Plan Rows'] = 5
    scan['Actual Rows'] = 40_000
    const plan = parsePlan(over)!
    expect(planWarnings(plan).map((w) => w.kind)).toEqual(['estimate-off'])
  })

  it('warns about a short estimate when no LIMIT explains it', () => {
    const bare = JSON.parse(JSON.stringify(limitedRun))[0].Plan.Plans[0]
    const plan = parsePlan([{ Plan: bare }])!
    expect(planWarnings(plan).map((w) => w.kind)).toContain('estimate-off')
  })

  it('still reports a sort that spilled, LIMIT or not', () => {
    const spilling = JSON.parse(JSON.stringify(limitedRun))
    spilling[0].Plan.Plans[0].Plans[0]['Sort Space Type'] = 'Disk'
    spilling[0].Plan.Plans[0].Plans[0]['Sort Method'] = 'external merge'
    expect(planWarnings(parsePlan(spilling)!).map((w) => w.kind)).toEqual(['sort-spilled'])
  })
})
