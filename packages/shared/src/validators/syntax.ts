import type { SyntaxCheckResult } from "../types.js";

const SIMPLE_EMAIL_REGEX =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function validateSyntax(input: string): SyntaxCheckResult {
  const email = input.trim();
  const normalizedEmail = email.toLowerCase();

  if (!email) {
    return {
      isValid: false,
      normalizedEmail,
      reason: "Email is empty."
    };
  }

  if (email.length > 320) {
    return {
      isValid: false,
      normalizedEmail,
      reason: "Email exceeds maximum length."
    };
  }

  const atCount = (email.match(/@/g) || []).length;
  if (atCount !== 1) {
    return {
      isValid: false,
      normalizedEmail,
      reason: "Email must contain exactly one @ symbol."
    };
  }

  if (!SIMPLE_EMAIL_REGEX.test(email)) {
    return {
      isValid: false,
      normalizedEmail,
      reason: "Email does not match basic RFC-like format."
    };
  }

  return {
    isValid: true,
    normalizedEmail
  };
}
