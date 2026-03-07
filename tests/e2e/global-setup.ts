import { seedMailFixture } from "./mail-fixture";

async function globalSetup() {
  await seedMailFixture();
}

export default globalSetup;
