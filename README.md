# Email Validator (Scalable Starter)

Monorepo starter for a scalable email validation platform with:

- Frontend app for submitting emails and viewing status/results
- API service that accepts validation jobs and queues them
- Worker service that performs deep validation (syntax + DNS + SMTP handshake)
- Shared package with core validation logic
- Redis-backed queue via BullMQ

## Project Structure

```txt
apps/
  api/         # HTTP API + job status endpoints
  worker/      # BullMQ worker doing deep email checks
  frontend/    # Vite + React UI
packages/
  shared/      # Shared validation logic and types
```

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy env file:

```bash
cp .env.example .env
```

3. Start Redis (Docker):

```bash
docker compose up -d redis
```

4. Run all apps:

```bash
npm run dev
```

5. Open frontend:

```txt
http://localhost:5173
```

## API Endpoints

- `POST /api/v1/validations`
  - body: `{ "email": "name@example.com" }`
  - returns: `{ "jobId": "...", "status": "queued", "statusUrl": "/api/v1/validations/:jobId" }`

- `GET /api/v1/validations/:jobId`
  - returns status and result when completed

## Notes About SMTP Validation

- SMTP handshakes are included (`EHLO`, optional `STARTTLS`, `MAIL FROM`, `RCPT TO`).
- Results can still be `unknown` due to provider protections, temporary failures, or anti-probing behavior.
- This starter includes optional catch-all probing and conservative status scoring.

## Docker Compose

`docker-compose.yml` includes `redis`, `api`, and `worker`.
Run all infra services:

```bash
docker compose up --build
```
