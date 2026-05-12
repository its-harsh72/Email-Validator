import { FormEvent, useMemo, useState } from "react";

type JobState =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed"
  | "paused"
  | "prioritized"
  | "unknown";

interface ApiJobResponse {
  jobId: string;
  state: JobState;
  result?: unknown;
  error?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function App() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobState | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const statusClass = useMemo(() => {
    if (!jobState) {
      return "chip chip-neutral";
    }
    if (jobState === "completed") {
      return "chip chip-success";
    }
    if (jobState === "failed") {
      return "chip chip-danger";
    }
    return "chip chip-neutral";
  }, [jobState]);

  async function pollJobStatus(nextJobId: string) {
    for (let i = 0; i < 30; i += 1) {
      const response = await fetch(`${API_BASE_URL}/api/v1/validations/${nextJobId}`);
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Failed to fetch job status.");
      }

      const body = (await response.json()) as ApiJobResponse;
      setJobState(body.state);

      if (body.state === "completed") {
        setResult(body.result ?? null);
        return;
      }

      if (body.state === "failed") {
        setError(body.error ?? "Validation failed.");
        return;
      }

      await sleep(1500);
    }

    setError("Validation timed out. Please try again.");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    setJobId(null);
    setJobState(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/validations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to queue validation.");
      }

      const queuedJobId = String(body.jobId);
      setJobId(queuedJobId);
      setJobState("waiting");
      await pollJobStatus(queuedJobId);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unexpected error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <h1>Email Validator</h1>
        <p className="subtitle">Syntax + DNS + SMTP handshake validation</p>

        <form onSubmit={onSubmit} className="form">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            required
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "Validating..." : "Validate Email"}
          </button>
        </form>

        {jobId && (
          <div className="statusRow">
            <span>Job: {jobId}</span>
            <span className={statusClass}>{jobState}</span>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {result && (
          <div className="result">
            <h2>Result</h2>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </section>
    </main>
  );
}
