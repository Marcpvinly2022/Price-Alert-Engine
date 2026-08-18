import prisma from "./src/config/database.js";

const alert = await prisma.alert.create({
  data: {
    userId: "test-user-001",
    userEmail: "test@example.com",
    currencyPair: "USD_NGN",
    targetRate: 1600,
    condition: "ABOVE",
    status: "PENDING",
  },
});

console.log("[TEST] Alert created:", alert);

await prisma.$disconnect();