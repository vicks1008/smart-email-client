import { getEnv } from "@smart-email/core";

import { buildApp as createApp } from "./app";

async function main() {
  const env = getEnv();
  const app = createApp();
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({
    port,
    host
  });

  app.log.info(`API server listening on ${env.API_BASE_URL}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
