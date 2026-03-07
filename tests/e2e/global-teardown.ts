import { cleanupMailFixture } from "./mail-fixture";

async function globalTeardown() {
  await cleanupMailFixture();
}

export default globalTeardown;
