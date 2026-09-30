# Request Priority Model (#602)

## Scheduling contract

| Tier | Requests | Reserved concurrency | Maximum queue wait |
|---|---|---:|---:|
| `CRITICAL` | `POST /vote`, `/vote/commit`, `/vote/batch` | 16 | 5 seconds |
| `LOW` | All `POST /comment` and `POST /comments` actions | 4 | 30 seconds |

The same classifier runs before the unversioned, `/api/v1`, and `/api/v2`
mounts. API prefixes are removed before matching, so the public aliases cannot
bypass scheduling.

`backend/src/priority/priorityQueue.ts` uses separate worker pools. A comment
burst can fill only the low-priority pool; it cannot occupy a vote worker or
sit in front of a vote in the same FIFO. Requests outside the vote/comment
write paths do not enter this queue and keep their existing route-specific
rate limits.

The global slowdown middleware skips critical vote requests because those
requests already pass through the wallet and vote limiters. This prevents 100
comments from consuming a shared IP slowdown budget before a time-sensitive
vote arrives.

## Monitoring

`zkvote_priority_starvation_total{priority,route}` increments whenever a
queued request waits at least one second before starting. Any increase for
`priority="CRITICAL"` triggers the `ZKVotePriorityStarvation` alert and is
shown on the relayer Grafana dashboard.

## Regression test

`backend/test/priority-preemption.test.ts` enqueues 100 comments before a vote
and proves that the vote starts before the comment backlog drains. A separate
known-answer test deliberately saturates the critical pool and verifies that
the starvation metric increments.
