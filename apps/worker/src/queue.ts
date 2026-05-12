import { type Job, QueueEvents, Worker } from "bullmq";
import Redis from "ioredis";

export const EMAIL_VALIDATION_QUEUE = "email-validation";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null
});

export const queueEvents = new QueueEvents(EMAIL_VALIDATION_QUEUE, {
  connection: redisConnection
});

export function createValidationWorker(
  processor: (job: Job<{ email: string }>) => Promise<unknown>
) {
  return new Worker<{ email: string }>(EMAIL_VALIDATION_QUEUE, processor, {
    connection: redisConnection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10)
  });
}
