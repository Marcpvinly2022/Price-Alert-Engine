import prisma from "../config/database.js";
import { Prisma } from "@prisma/client";
import prismaDirect from "../config/database.direct.js";

export const createNewUserAlert = async (userId, userEmail, alertData) => {
  const { currencyPair, targetRate, condition } = alertData;
  const existingAlert = await prisma.alert.findFirst({
    where: {
        userId,
        currencyPair,
        targetRate: new Prisma.Decimal(targetRate),
        condition,
        status: 'PENDING',
    },
  });

  if(existingAlert) {
    const error = new Error('A similar active alert already exists');
    error.statusCode = 409;
    throw error;
  }

  return prisma.alert.create({
    data:{
        userId,
        userEmail,
        currencyPair,
        targetRate: new Prisma.Decimal(targetRate),
        condition,
    }
  })
 
};


export const fetchPaginatedUserAlerts = async (
  userId,
  page = 1,
  limit = 10
) => {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const skip = (safePage - 1) * safeLimit;

  const [alerts, totalCount] = await prismaDirect.$transaction([
    prismaDirect.alert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: safeLimit,
    }),

    prismaDirect.alert.count({
      where: { userId },
    }),
  ]);

  return {
    alerts,
    meta: {
      id:userId.id,
      totalCount,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(totalCount / safeLimit),
    },
  };
};

export const removeUserAlert = async (id, userId) => {
    const alert = await prisma.alert.findFirst({ where: {id, userId} });
    if(!alert) return null;

    await prisma.alert.delete({ where: { id } });
    return true;
}


