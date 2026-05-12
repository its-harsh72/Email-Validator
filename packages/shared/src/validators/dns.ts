import dns from "node:dns/promises";

import type { DnsCheckResult, DnsMxRecord } from "../types.js";

function sortMx(records: DnsMxRecord[]): DnsMxRecord[] {
  return [...records].sort((a, b) => a.priority - b.priority);
}

export async function validateDns(domain: string): Promise<DnsCheckResult> {
  try {
    const mxRecords = await dns.resolveMx(domain);
    const normalizedMxRecords = sortMx(
      mxRecords.map((record) => ({
        exchange: record.exchange,
        priority: record.priority
      }))
    );

    if (normalizedMxRecords.length > 0) {
      return {
        hasMx: true,
        hasFallbackIp: false,
        mxRecords: normalizedMxRecords
      };
    }
  } catch {
    // Continue into A/AAAA fallback checks.
  }

  try {
    const [ipv4, ipv6] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolve6(domain)
    ]);

    const hasFallbackIp =
      (ipv4.status === "fulfilled" && ipv4.value.length > 0) ||
      (ipv6.status === "fulfilled" && ipv6.value.length > 0);

    if (hasFallbackIp) {
      return {
        hasMx: false,
        hasFallbackIp: true,
        mxRecords: [],
        reason: "No MX records found; fallback A/AAAA records exist."
      };
    }
  } catch {
    // Return failure result below.
  }

  return {
    hasMx: false,
    hasFallbackIp: false,
    mxRecords: [],
    reason: "No MX or fallback A/AAAA records found."
  };
}
