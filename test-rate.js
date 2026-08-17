import { fetchUsdNgnRate } from './src/providers/fx.provider.js';
import { saveRateSnapshot } from './src/services/rates.service.js';

const snapshot = await fetchUsdNgnRate();

console.log('[TEST] Provider returned:', snapshot);

const savedRate = await saveRateSnapshot(snapshot);

console.log('[TEST] Rate saved:', savedRate);