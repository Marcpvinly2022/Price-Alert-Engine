import prisma from "../config/database.js";

export const evaluateAlertsForRate = async ({ currencyPair, rate }) => {
  const currentRate = Number(rate);

  // 1. Find alerts that should be triggered
  const triggeredAlerts = await prisma.alert.findMany({
    where: {
      currencyPair,
      status: "PENDING",

      OR: [
        {
          condition: "ABOVE",
          targetRate: {
            lte: currentRate,
          },
        },
        {
          condition: "BELOW",
          targetRate: {
            gte: currentRate,
          },
        },
      ],
    },

    select: {
      id: true,
    },
  });

  if (triggeredAlerts.length === 0) {
    return [];
  }

  const alertIds = triggeredAlerts.map((alert) => alert.id);

  // 2. Atomically claim the alerts
  const claimedAlertIds = await prisma.$transaction(async (tx) => {
    const claimedAlerts = await tx.alert.updateManyAndReturn({
      where: {
        id: {
          in: alertIds,
        },

        status: "PENDING",
      },

      data: {
        status: "TRIGGERED",
        triggeredAt: new Date(),
      },

      select: {
        id: true,
      },
    });

    const claimedIds = claimedAlerts.map((alert) => alert.id);

    if (claimedIds.length === 0) {
      return [];
    }

    // 3. Create EMAIL notifications
    await tx.alertNotification.createMany({
      data: claimedIds.map((id) => ({
        alertId: id,
        channel: "EMAIL",
        dedupeKey: `${id}:email:triggered`,
      })),

      skipDuplicates: true,
    });

    return claimedIds;
  });

  return claimedAlertIds;
};