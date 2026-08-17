import {pino} from "pino";

export const logger = pino({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    base: {service: 'price-alert-engine'},
    timestamp: pino.stdTimeFunctions.isoTime
});


