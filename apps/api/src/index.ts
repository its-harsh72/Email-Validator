import "dotenv/config";

import cors from "cors";
import express from "express";
import { z } from "zod";

import { validationQueue } from "./queue.js";

const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const createValidationSchema = z.object({
  email: z.string().email()
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api" });
});

app.post("/api/v1/validations", async (req, res) => {
  const parsed = createValidationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid payload.",
      details: parsed.error.flatten()
    });
    return;
  }

  const { email } = parsed.data;
  const job = await validationQueue.add("validate-email", { email });

  res.status(202).json({
    jobId: job.id,
    status: "queued",
    statusUrl: `/api/v1/validations/${job.id}`
  });
});

app.get("/api/v1/validations/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const job = await validationQueue.getJob(jobId);

  if (!job) {
    res.status(404).json({ error: "Validation job not found." });
    return;
  }

  const state = await job.getState();

  if (state === "completed") {
    res.json({
      jobId,
      state,
      result: job.returnvalue
    });
    return;
  }

  if (state === "failed") {
    res.status(200).json({
      jobId,
      state,
      error: job.failedReason ?? "Validation failed."
    });
    return;
  }

  res.json({
    jobId,
    state
  });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
