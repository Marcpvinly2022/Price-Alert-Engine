import prisma from './src/config/database.js';
import { evaluateAlertsForRate } from './src/services/trigger.service.js';

const result = await evaluateAlertsForRate({
  currencyPair: 'USD_NGN',
  rate: 1600,
});

console.log('[TEST] Triggered alerts:', result);

await prisma.$disconnect();