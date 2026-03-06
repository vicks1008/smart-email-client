import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  ImportFormat,
  ImportJobStatus,
  MailboxKind,
  ensureArchiveAccount,
  getEnv,
  ingestNormalizedMessage,
  previewFromText,
  prisma,
  registerMailbox,
  type NormalizedMessage
} from "@smart-email/core";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";

type ImportTargetInput = {
  accountId?: string;
  mailboxId?: string;
  mailboxEmail?: string;
  mailboxDisplayName?: string;
};

function normalizeAddress(address?: string | null) {
  return address?.trim().toLowerCase() ?? "";
}

function toAddressValues(value?: AddressObject | AddressObject[] | null) {
  if (!value) {
    return [];
  }

  return Array.isArray(value)
    ? value.flatMap((entry) => entry.value ?? [])
    : value.value ?? [];
}

function firstAddress(value?: AddressObject | AddressObject[] | null) {
  const first = toAddressValues(value)[0];
  if (!first?.address) {
    return {
      address: null,
      name: null
    };
  }

  return {
    address: normalizeAddress(first.address),
    name: first.name?.trim() || first.address
  };
}

function recipientList(value?: AddressObject | AddressObject[] | null) {
  return toAddressValues(value)
    .filter((recipient) => Boolean(recipient.address))
    .map((recipient) => ({
      address: normalizeAddress(recipient.address ?? ""),
      name: recipient.name?.trim() || recipient.address || ""
    }));
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function conversationKeyFromParsedMail(parsed: ParsedMail, fallbackId: string) {
  const references = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : [parsed.references]
    : [];

  if (references.length > 0) {
    return references[0];
  }

  if (parsed.inReplyTo) {
    return parsed.inReplyTo;
  }

  return parsed.messageId ?? `subject:${(parsed.subject ?? "(no subject)").trim().toLowerCase()}:${fallbackId}`;
}

function normalizedMessageFromEmlBuffer(sourceName: string, raw: Buffer) {
  return simpleParser(raw).then((parsed: ParsedMail): NormalizedMessage => {
    const syntheticId = sha256(raw);
    const from = firstAddress(parsed.from);
    const text = parsed.text?.trim() || "";
    const html = typeof parsed.html === "string" ? parsed.html : null;
    const receivedAt = parsed.date ?? new Date();

    return {
      externalMessageId: parsed.messageId ?? `${sourceName}:${syntheticId}`,
      externalConversationId: conversationKeyFromParsedMail(parsed, syntheticId),
      internetMessageId: parsed.messageId ?? null,
      subject: parsed.subject?.trim() || "(no subject)",
      fromName: from.name,
      fromAddress: from.address,
      toRecipients: recipientList(parsed.to),
      ccRecipients: recipientList(parsed.cc),
      receivedAt,
      sentAt: parsed.date ?? null,
      bodyPreview: previewFromText(text || (typeof parsed.html === "string" ? parsed.html : "")),
      bodyText: text || previewFromText(typeof parsed.html === "string" ? parsed.html : ""),
      bodyHtml: html,
      webLink: null,
      importance: null,
      isRead: true,
      hasAttachments: parsed.attachments.length > 0
    };
  });
}

async function walkForEmlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkForEmlFiles(nextPath);
      }

      return nextPath.toLowerCase().endsWith(".eml") ? [nextPath] : [];
    })
  );

  return files.flat();
}

async function extractOlmToDirectory(inputPath: string, outputDir: string) {
  const env = getEnv();
  const scriptPath = resolve(process.cwd(), "scripts/extract_olm.py");
  const python = env.OLM_CONVERTER_PYTHON || process.env.PYTHON || "python3";

  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(python, [scriptPath, inputPath, outputDir], {
      cwd: process.cwd()
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      try {
        const parsed = JSON.parse(stderr);
        rejectPromise(new Error(parsed.hint ? `${parsed.error} ${parsed.hint}` : parsed.error));
      } catch {
        rejectPromise(new Error(stderr || `OLM extraction failed with exit code ${code}.`));
      }
    });
  });
}

async function resolveTarget(input: ImportTargetInput) {
  if (input.mailboxId) {
    const mailbox = await prisma.mailbox.findUnique({
      where: { id: input.mailboxId },
      include: { account: true }
    });

    if (!mailbox) {
      throw new Error("Selected mailbox was not found.");
    }

    return mailbox;
  }

  if (input.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: input.accountId }
    });

    if (!account) {
      throw new Error("Selected account was not found.");
    }

    const emailAddress = input.mailboxEmail?.trim() || account.email;
    const mailbox = await registerMailbox(account.id, {
      emailAddress,
      displayName: input.mailboxDisplayName?.trim() || account.displayName || emailAddress,
      kind: normalizeAddress(emailAddress) === normalizeAddress(account.email) ? MailboxKind.PRIMARY : MailboxKind.SHARED
    });

    return prisma.mailbox.findUniqueOrThrow({
      where: { id: mailbox.id },
      include: { account: true }
    });
  }

  const emailAddress = input.mailboxEmail?.trim();
  if (!emailAddress) {
    throw new Error("A mailbox email address is required for import without an existing account.");
  }

  const account = await ensureArchiveAccount({
    emailAddress,
    displayName: input.mailboxDisplayName?.trim() || emailAddress
  });
  const mailbox = await registerMailbox(account.id, {
    emailAddress,
    displayName: input.mailboxDisplayName?.trim() || emailAddress,
    kind: MailboxKind.PRIMARY
  });

  return prisma.mailbox.findUniqueOrThrow({
    where: { id: mailbox.id },
    include: { account: true }
  });
}

export async function importArchive(args: ImportTargetInput & { fileName: string; format: ImportFormat; buffer: Buffer }) {
  const mailbox = await resolveTarget(args);

  const job = await prisma.importJob.create({
    data: {
      accountId: mailbox.accountId,
      mailboxId: mailbox.id,
      format: args.format,
      sourceFilename: args.fileName,
      status: ImportJobStatus.IN_PROGRESS
    }
  });

  const tempRoot = await mkdtemp(join(tmpdir(), "smart-email-import-"));

  try {
    let sources: Array<{ name: string; buffer: Buffer }> = [];

    if (args.format === ImportFormat.EML) {
      sources = [{ name: args.fileName, buffer: args.buffer }];
    } else {
      const archivePath = join(tempRoot, args.fileName);
      const outputDir = join(tempRoot, "olm-output");
      await writeFile(archivePath, args.buffer);
      await extractOlmToDirectory(archivePath, outputDir);
      const emlFiles = await walkForEmlFiles(outputDir);

      if (emlFiles.length === 0) {
        throw new Error("The OLM archive did not produce any .eml files.");
      }

      sources = await Promise.all(
        emlFiles.map(async (filePath) => ({
          name: filePath,
          buffer: await readFile(filePath)
        }))
      );
    }

    let importedMessages = 0;

    for (const source of sources) {
      const normalized = await normalizedMessageFromEmlBuffer(source.name, source.buffer);
      await ingestNormalizedMessage(mailbox, normalized);
      importedMessages += 1;
    }

    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        importedMessages,
        status: ImportJobStatus.SUCCEEDED,
        finishedAt: new Date()
      }
    });

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: null
      }
    });

    return prisma.importJob.findUniqueOrThrow({
      where: { id: job.id },
      include: {
        mailbox: true,
        account: true
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Archive import failed.";

    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: ImportJobStatus.FAILED,
        finishedAt: new Date(),
        errorText: message
      }
    });

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        lastSyncError: message
      }
    });

    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
