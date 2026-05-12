import "dotenv/config";

import { validateEmailAddress } from "@email-validator/shared";

import { createValidationWorker, queueEvents } from "./queue.js";

const smtpTimeoutMs = Number(process.env.SMTP_TIMEOUT_MS ?? 10000);
const smtpUseStartTls = String(process.env.SMTP_USE_STARTTLS ?? "true") === "true";
const catchAllProbe = String(process.env.SMTP_CATCH_ALL_PROBE ?? "true") === "true";
const senderEmail = process.env.SMTP_SENDER_EMAIL ?? "validator@localhost";

const worker = createValidationWorker(async (job) => {
  const { email } = job.data;

  const result = await validateEmailAddress(email, {
    smtpTimeoutMs,
    smtpUseStartTls,
    catchAllProbe,
    senderEmail
  });

  return result;
});

worker.on("completed", (job) => {
  // eslint-disable-next-line no-console
  console.log(`Job ${job.id} completed with status: ${job.returnvalue.status}`);
});

worker.on("failed", (job, err) => {
  // eslint-disable-next-line no-console
  console.error(`Job ${job?.id} failed:`, err.message);
});

queueEvents.on("error", (error) => {
  // eslint-disable-next-line no-console
  console.error("Queue events error:", error.message);
});

// eslint-disable-next-line no-console
console.log("Worker started and listening for email-validation jobs.");
