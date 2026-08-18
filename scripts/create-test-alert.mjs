// Seed one PENDING alert that will trigger on the next price cycle, so you can
// watch the BullMQ delivery pipeline end-to-end.
//   node scripts/create-test-alert.mjs you@example.com
import { prisma, disconnect } from "../src/config/database.js";
import { Prisma } from "@prisma/client";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/create-test-alert.mjs <your-email>");
  process.exit(1);
}

// Simulated rate is ~1540–1559. Condition ABOVE + target 1500 = "fire when
// rate >= 1500", which is always true → triggers on the very next tick.
const alert = await prisma.alert.create({
  data: {
    userId: "test-seed",
    userEmail: email,
    currencyPair: "USD_NGN",
    targetRate: new Prisma.Decimal(1500),
    condition: "ABOVE", // status defaults to PENDING
  },
});

console.log(`Seeded PENDING alert ${alert.id} -> ${email}`);
console.log("Watch server logs for [TRIGGER] enqueued then [WORKER] delivered (~60s).");
await disconnect();
process.exit(0);
