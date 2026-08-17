import {prisma} from "../config/database.js";
import { Prisma } from "@prisma/client";

export const saveRateSnapshot = async ({
    currencyPair,
    rate,
    source,
}) => {
    return prisma.fxRate.create({
        data: {
            currencyPair,
            rate: new Prisma.Decimal(rate),
            source,
        },
    });
};


export const getLatestRate = async (currencyPair) => {
    return prisma.fxRate.findFirst({
        where: {
            currencyPair,
        },

        orderBy: {
            fetchedAt: 'desc',
        },
    });
};


