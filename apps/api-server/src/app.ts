import cors from "@fastify/cors";
import Fastify from "fastify";

import { getEnv } from "@smart-email/core";

import { registerAuthRoutes } from "./routes/auth";
import { registerMailRoutes } from "./routes/mail";
import { registerThreadRoutes } from "./routes/threads";

export function buildApp() {
  const env = getEnv();
  const app = Fastify({
    logger: true
  });

  app.register(cors, {
    origin: [env.DASHBOARD_URL]
  });

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  app.register(registerAuthRoutes);
  app.register(registerMailRoutes);
  app.register(registerThreadRoutes);

  return app;
}
