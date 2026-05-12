import { Queue } from "bullmq";
import Redis from "ioredis";

export const EMAIL_VALIDATION_QUEUE = "email-validation";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null
});

export const validationQueue = new Queue<{ email: string }>(EMAIL_VALIDATION_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: {
      age: 60 * 60 * 2,
      count: 10000
    },
    removeOnFail: {
      age: 60 * 60 * 6,
      count: 20000
    }
  }
});
