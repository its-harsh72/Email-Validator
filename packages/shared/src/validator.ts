import { validateDns } from "./validators/dns.js";
import { validateSmtp } from "./validators/smtp.js";
import { validateSyntax } from "./validators/syntax.js";
import type { EmailValidationResult, ValidationOptions, ValidationStatus } from "./types.js";

function scoreForStatus(status: ValidationStatus, catchAllLikely: boolean): number {
  if (status === "invalid") {
    return 5;
  }
  if (status === "unknown") {
    return 50;
  }
  if (status === "risky") {
    return catchAllLikely ? 65 : 70;
  }
  return catchAllLikely ? 75 : 95;
}

export async function validateEmailAddress(
  input: string,
  options: ValidationOptions = {}
): Promise<EmailValidationResult> {
  const start = Date.now();
  const reasons: string[] = [];

  const syntax = validateSyntax(input);
  if (!syntax.isValid) {
    reasons.push(syntax.reason ?? "Invalid email syntax.");
    return {
      input,
      normalizedEmail: syntax.normalizedEmail,
      status: "invalid",
      score: 0,
      checks: {
        syntax,
        dns: {
          hasMx: false,
          hasFallbackIp: false,
          mxRecords: [],
          reason: "Skipped due to syntax failure."
        },
        smtp: {
          status: "unknown",
          acceptedRecipient: false,
          usedStartTls: false,
          catchAllLikely: false,
          reason: "Skipped due to syntax failure."
        }
      },
      reasons,
      timingMs: Date.now() - start
    };
  }

  const [, domain] = syntax.normalizedEmail.split("@");
  const dns = await validateDns(domain);
  if (dns.reason) {
    reasons.push(dns.reason);
  }

  if (!dns.hasMx && !dns.hasFallbackIp) {
    return {
      input,
      normalizedEmail: syntax.normalizedEmail,
      status: "invalid",
      score: 5,
      checks: {
        syntax,
        dns,
        smtp: {
          status: "unknown",
          acceptedRecipient: false,
          usedStartTls: false,
          catchAllLikely: false,
          reason: "Skipped SMTP because domain is not deliverable."
        }
      },
      reasons: [...reasons, "Domain does not appear deliverable."],
      timingMs: Date.now() - start
    };
  }

  const smtp = await validateSmtp({
    email: syntax.normalizedEmail,
    domain,
    mxHosts: dns.mxRecords.map((record) => record.exchange),
    timeoutMs: options.smtpTimeoutMs ?? 10000,
    useStartTls: options.smtpUseStartTls ?? true,
    senderEmail: options.senderEmail ?? "validator@localhost",
    catchAllProbe: options.catchAllProbe ?? true
  });

  if (smtp.reason) {
    reasons.push(smtp.reason);
  }

  const status = smtp.status;
  return {
    input,
    normalizedEmail: syntax.normalizedEmail,
    status,
    score: scoreForStatus(status, smtp.catchAllLikely),
    checks: {
      syntax,
      dns,
      smtp
    },
    reasons,
    timingMs: Date.now() - start
  };
}
