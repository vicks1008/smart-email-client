import { ImportFormat, prisma } from "@smart-email/core";
import type { FastifyInstance } from "fastify";
import type { Multipart, MultipartFile } from "@fastify/multipart";
import { z } from "zod";

import { importArchive } from "../archive-import";

function parseOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function fieldValue(
  fields: MultipartFile["fields"],
  key: string
) {
  const entry = fields[key] as Multipart | Multipart[] | undefined;
  const candidate = Array.isArray(entry) ? entry[0] : entry;
  return candidate && "value" in candidate ? candidate.value : undefined;
}

export async function registerImportRoutes(app: FastifyInstance) {
  app.get("/v1/imports", async (request) => {
    const query = z
      .object({
        mailboxId: z.string().cuid().optional(),
        accountId: z.string().cuid().optional()
      })
      .parse(request.query);

    const jobs = await prisma.importJob.findMany({
      where: {
        mailboxId: query.mailboxId,
        accountId: query.accountId
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 20,
      include: {
        mailbox: true,
        account: true
      }
    });

    return {
      imports: jobs
    };
  });

  app.post("/v1/imports", async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.status(400).send({
        error: "A .eml or .olm file is required."
      });
    }

    const fileName = file.filename || "upload.eml";
    const extension = fileName.toLowerCase().endsWith(".olm")
      ? ImportFormat.OLM
      : fileName.toLowerCase().endsWith(".eml")
        ? ImportFormat.EML
        : null;

    if (!extension) {
      return reply.status(400).send({
        error: "Only .eml and .olm files are supported."
      });
    }

    try {
      const imported = await importArchive({
        accountId: parseOptionalString(fieldValue(file.fields, "accountId")),
        mailboxId: parseOptionalString(fieldValue(file.fields, "mailboxId")),
        mailboxEmail: parseOptionalString(fieldValue(file.fields, "mailboxEmail")),
        mailboxDisplayName: parseOptionalString(fieldValue(file.fields, "mailboxDisplayName")),
        fileName,
        format: extension,
        buffer: await file.toBuffer()
      });

      return reply.status(201).send({
        importJob: imported
      });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Archive import failed."
      });
    }
  });
}
