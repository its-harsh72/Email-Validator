import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

import type { SmtpCheckResult, ValidationStatus } from "../types.js";

interface SmtpValidationInput {
  email: string;
  domain: string;
  mxHosts: string[];
  timeoutMs: number;
  senderEmail: string;
  useStartTls: boolean;
  catchAllProbe: boolean;
}

interface SmtpReply {
  code: number;
  message: string;
  lines: string[];
}

const SMTP_PORT = 25;
const TEMP_FAILURE_CODES = new Set([421, 450, 451, 452]);
const HARD_FAILURE_CODES = new Set([550, 551, 552, 553, 554]);

function isSuccessCode(code: number): boolean {
  return code >= 200 && code < 300;
}

function createLineReader(socket: net.Socket | tls.TLSSocket) {
  let buffer = "";
  const queuedLines: string[] = [];
  const lineWaiters: Array<(line: string) => void> = [];

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }

      const line = buffer.slice(0, newlineIndex + 1).replace(/\r?\n$/, "");
      buffer = buffer.slice(newlineIndex + 1);

      const waiter = lineWaiters.shift();
      if (waiter) {
        waiter(line);
      } else {
        queuedLines.push(line);
      }
    }
  });

  const readLine = (timeoutMs: number): Promise<string> =>
    new Promise((resolve, reject) => {
      const queued = queuedLines.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }

      let settled = false;
      const waiter = (line: string) => {
        if (settled) {
          return;
        }
        clearTimeout(timer);
        settled = true;
        resolve(line);
      };

      const timer = setTimeout(() => {
        const waiterIndex = lineWaiters.indexOf(waiter);
        if (waiterIndex >= 0) {
          lineWaiters.splice(waiterIndex, 1);
        }
        settled = true;
        reject(new Error("SMTP read timeout"));
      }, timeoutMs);

      lineWaiters.push(waiter);
    });

  const readReply = async (timeoutMs: number): Promise<SmtpReply> => {
    const lines: string[] = [];
    let fallbackCode: number | null = null;

    while (true) {
      const line = await readLine(timeoutMs);
      lines.push(line);

      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) {
        continue;
      }

      const code = Number(match[1]);
      const separator = match[2];
      fallbackCode = code;

      if (separator === " ") {
        return {
          code,
          message: lines.join(" | "),
          lines
        };
      }
    }

    return {
      code: fallbackCode ?? 0,
      message: lines.join(" | "),
      lines
    };
  };

  return { readReply };
}

function connectPlainSocket(host: string, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: SMTP_PORT });
    socket.setTimeout(timeoutMs);

    socket.once("connect", () => resolve(socket));
    socket.once("timeout", () => reject(new Error("SMTP connection timeout")));
    socket.once("error", (error) => reject(error));
  });
}

function upgradeToTlsSocket(
  socket: net.Socket,
  host: string,
  timeoutMs: number
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: host,
      rejectUnauthorized: false
    });

    secureSocket.setTimeout(timeoutMs);
    secureSocket.once("secureConnect", () => resolve(secureSocket));
    secureSocket.once("timeout", () => reject(new Error("STARTTLS timeout")));
    secureSocket.once("error", (error) => reject(error));
  });
}

async function writeCommand(
  socket: net.Socket | tls.TLSSocket,
  command: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${command}\r\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function classifyRcptCode(code: number): ValidationStatus {
  if (isSuccessCode(code)) {
    return "valid";
  }
  if (HARD_FAILURE_CODES.has(code)) {
    return "invalid";
  }
  if (TEMP_FAILURE_CODES.has(code)) {
    return "unknown";
  }
  return "risky";
}

function randomMailbox(domain: string): string {
  const token = crypto.randomBytes(6).toString("hex");
  return `probe-${token}@${domain}`;
}

async function closeSocketQuietly(socket: net.Socket | tls.TLSSocket): Promise<void> {
  await new Promise<void>((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once("close", () => resolve());
    socket.end();
    setTimeout(() => {
      if (!socket.destroyed) {
        socket.destroy();
      }
      resolve();
    }, 1000);
  });
}

async function tryHost(input: SmtpValidationInput, host: string): Promise<SmtpCheckResult> {
  let socket: net.Socket | tls.TLSSocket | null = null;
  let readReply: ((timeoutMs: number) => Promise<SmtpReply>) | null = null;
  let usedStartTls = false;

  try {
    socket = await connectPlainSocket(host, input.timeoutMs);
    ({ readReply } = createLineReader(socket));

    const banner = await readReply(input.timeoutMs);
    if (banner.code !== 220) {
      return {
        status: "unknown",
        acceptedRecipient: false,
        responseCode: banner.code,
        responseMessage: banner.message,
        hostTried: host,
        usedStartTls: false,
        catchAllLikely: false,
        reason: "SMTP server did not return a 220 banner."
      };
    }

    await writeCommand(socket, "EHLO validator.local");
    let ehloReply = await readReply(input.timeoutMs);
    if (!isSuccessCode(ehloReply.code)) {
      return {
        status: "unknown",
        acceptedRecipient: false,
        responseCode: ehloReply.code,
        responseMessage: ehloReply.message,
        hostTried: host,
        usedStartTls: false,
        catchAllLikely: false,
        reason: "EHLO failed."
      };
    }

    const supportsStartTls = ehloReply.lines.some((line) =>
      line.toUpperCase().includes("STARTTLS")
    );

    if (input.useStartTls && supportsStartTls && socket instanceof net.Socket) {
      await writeCommand(socket, "STARTTLS");
      const startTlsReply = await readReply(input.timeoutMs);
      if (startTlsReply.code === 220) {
        socket = await upgradeToTlsSocket(socket, host, input.timeoutMs);
        ({ readReply } = createLineReader(socket));
        usedStartTls = true;

        await writeCommand(socket, "EHLO validator.local");
        ehloReply = await readReply(input.timeoutMs);
        if (!isSuccessCode(ehloReply.code)) {
          return {
            status: "unknown",
            acceptedRecipient: false,
            responseCode: ehloReply.code,
            responseMessage: ehloReply.message,
            hostTried: host,
            usedStartTls,
            catchAllLikely: false,
            reason: "EHLO after STARTTLS failed."
          };
        }
      }
    }

    await writeCommand(socket, `MAIL FROM:<${input.senderEmail}>`);
    const mailFromReply = await readReply(input.timeoutMs);
    if (!isSuccessCode(mailFromReply.code)) {
      return {
        status: "unknown",
        acceptedRecipient: false,
        responseCode: mailFromReply.code,
        responseMessage: mailFromReply.message,
        hostTried: host,
        usedStartTls,
        catchAllLikely: false,
        reason: "MAIL FROM rejected."
      };
    }

    await writeCommand(socket, `RCPT TO:<${input.email}>`);
    const rcptReply = await readReply(input.timeoutMs);
    const rcptStatus = classifyRcptCode(rcptReply.code);

    if (rcptStatus !== "valid") {
      return {
        status: rcptStatus,
        acceptedRecipient: false,
        responseCode: rcptReply.code,
        responseMessage: rcptReply.message,
        hostTried: host,
        usedStartTls,
        catchAllLikely: false,
        reason: "Recipient not accepted."
      };
    }

    let catchAllLikely = false;
    if (input.catchAllProbe) {
      const probeEmail = randomMailbox(input.domain);
      await writeCommand(socket, `RCPT TO:<${probeEmail}>`);
      const probeReply = await readReply(input.timeoutMs);
      if (isSuccessCode(probeReply.code)) {
        catchAllLikely = true;
      }
    }

    return {
      status: catchAllLikely ? "risky" : "valid",
      acceptedRecipient: true,
      responseCode: rcptReply.code,
      responseMessage: rcptReply.message,
      hostTried: host,
      usedStartTls,
      catchAllLikely,
      reason: catchAllLikely
        ? "Server appears to accept random recipients (possible catch-all)."
        : "Recipient accepted by SMTP server."
    };
  } catch (error) {
    return {
      status: "unknown",
      acceptedRecipient: false,
      responseMessage: error instanceof Error ? error.message : "Unknown SMTP error",
      hostTried: host,
      usedStartTls,
      catchAllLikely: false,
      reason: "SMTP probe failed due to network/server behavior."
    };
  } finally {
    if (socket) {
      try {
        await writeCommand(socket, "QUIT");
      } catch {
        // Ignore QUIT failures.
      }
      await closeSocketQuietly(socket);
    }
  }
}

export async function validateSmtp(input: SmtpValidationInput): Promise<SmtpCheckResult> {
  if (input.mxHosts.length === 0) {
    return {
      status: "unknown",
      acceptedRecipient: false,
      usedStartTls: false,
      catchAllLikely: false,
      reason: "No MX hosts available for SMTP probing."
    };
  }

  let latestUnknown: SmtpCheckResult | null = null;

  for (const host of input.mxHosts.slice(0, 3)) {
    const result = await tryHost(input, host);
    if (result.status === "valid" || result.status === "invalid" || result.status === "risky") {
      return result;
    }
    latestUnknown = result;
  }

  return (
    latestUnknown ?? {
      status: "unknown",
      acceptedRecipient: false,
      usedStartTls: false,
      catchAllLikely: false,
      reason: "SMTP status unknown."
    }
  );
}
