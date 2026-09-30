import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { priorityStarvationTotal } from "../src/services/metrics.js";
import {
  classifyPriority,
  PriorityTier,
  type TierSettings,
} from "../src/priority/priorityConfig.js";
import { PriorityQueue } from "../src/priority/priorityQueue.js";

const settings: Record<PriorityTier, TierSettings> = {
  [PriorityTier.CRITICAL]: { concurrency: 1, maxQueueWaitMs: 1_000 },
  [PriorityTier.LOW]: { concurrency: 1, maxQueueWaitMs: 5_000 },
};

function work(ms: number, done?: () => void): () => Promise<void> {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    done?.();
  };
}

describe("priority queue", () => {
  it("classifies vote and comment writes identically on all API mounts", () => {
    for (const prefix of ["", "/api/v1", "/api/v2"]) {
      assert.equal(
        classifyPriority("POST", `${prefix}/vote`),
        PriorityTier.CRITICAL,
      );
      assert.equal(
        classifyPriority("POST", `${prefix}/comment/anonymous`),
        PriorityTier.LOW,
      );
    }
  });

  it("starts a vote before a backlog of 100 comments drains", async () => {
    const queue = new PriorityQueue({ settings });
    let completedComments = 0;
    const comments = Array.from({ length: 100 }, () =>
      queue.enqueue(
        PriorityTier.LOW,
        work(2, () => {
          completedComments += 1;
        }),
        "/comment/anonymous",
      ),
    );

    await queue.enqueue(PriorityTier.CRITICAL, work(1), "/vote");
    assert.ok(
      completedComments < 10,
      `vote should preempt the comment backlog; ${completedComments} comments completed first`,
    );
    await Promise.all(comments);
  });

  it("increments the starvation metric when critical work waits too long", async () => {
    const before = await priorityStarvationTotal.get();
    const beforeValue = before.values.reduce(
      (sum, value) => sum + value.value,
      0,
    );
    const queue = new PriorityQueue({
      settings,
      starvationThresholdMs: 1,
      onStarvation: ({ tier, route }) => {
        priorityStarvationTotal.inc({ priority: tier, route });
      },
    });

    const blocker = queue.enqueue(PriorityTier.CRITICAL, work(20), "/vote");
    const waitingVote = queue.enqueue(PriorityTier.CRITICAL, work(1), "/vote");
    await Promise.all([blocker, waitingVote]);

    const after = await priorityStarvationTotal.get();
    const afterValue = after.values.reduce(
      (sum, value) => sum + value.value,
      0,
    );
    assert.equal(afterValue, beforeValue + 1);
  });
});
