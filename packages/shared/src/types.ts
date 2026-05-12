export type ValidationStatus = "valid" | "invalid" | "risky" | "unknown";

export interface SyntaxCheckResult {
  isValid: boolean;
  normalizedEmail: string;
  reason?: string;
}

export interface DnsMxRecord {
  exchange: string;
  priority: number;
}

export interface DnsCheckResult {
  hasMx: boolean;
  hasFallbackIp: boolean;
  mxRecords: DnsMxRecord[];
  reason?: string;
}

export interface SmtpCheckResult {
  status: ValidationStatus;
  acceptedRecipient: boolean;
  responseCode?: number;
  responseMessage?: string;
  hostTried?: string;
  usedStartTls: boolean;
  catchAllLikely: boolean;
  reason?: string;
}

export interface EmailValidationChecks {
  syntax: SyntaxCheckResult;
  dns: DnsCheckResult;
  smtp: SmtpCheckResult;
}

export interface EmailValidationResult {
  input: string;
  normalizedEmail: string;
  status: ValidationStatus;
  score: number;
  checks: EmailValidationChecks;
  reasons: string[];
  timingMs: number;
}

export interface ValidationOptions {
  smtpTimeoutMs?: number;
  smtpUseStartTls?: boolean;
  catchAllProbe?: boolean;
  senderEmail?: string;
}
