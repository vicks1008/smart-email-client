import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";

import { getEnv } from "@smart-email/core";

import { registerAuthRoutes } from "./routes/auth";
import { registerMailRoutes } from "./routes/mail";
import { registerImportRoutes } from "./routes/imports";
import { registerThunderbirdRoutes } from "./routes/thunderbird";
import { registerThreadRoutes } from "./routes/threads";

export function buildApp() {
  const env = getEnv();
  const app = Fastify({
    logger: true
  });

  app.register(cors, {
    origin: [env.DASHBOARD_URL]
  });

  app.register(multipart, {
    attachFieldsToBody: false,
    limits: {
      fileSize: 250 * 1024 * 1024
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  app.register(registerAuthRoutes);
  app.register(registerMailRoutes);
  app.register(registerImportRoutes);
  app.register(registerThunderbirdRoutes);
  app.register(registerThreadRoutes);

  return app;
}
