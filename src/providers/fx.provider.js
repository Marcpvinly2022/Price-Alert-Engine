import 'dotenv/config';
import CircuitBreaker from 'opossum';

// Fallback Routine: Failover safety shield
const fetchSimulatedFallback = async () => {
    const base = 1550;
    const drift = Math.floor(Math.random() * 20) - 10;

    return {
        currencyPair: 'USD_NGN',
        rate: base + drift,
        source: 'SIMULATE_PROVIDER',
    };
};

// Core Worker Action: Outbound live integration
const fetchLiveExchangeRate = async () => {
    const apiKey = process.env.EXCHANGERATE_API_KEY;

    if (!apiKey) {
        throw new Error("EXCHANGERATE_API_KEY is undefined in environment registry");
    }

   
    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`;
    
    console.log(`[FX API] 🌐 Executing outbound HTTP fetch to live provider...`);
    
    // Set an explicit timeout on the fetch call itself to prevent socket hangs
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });

    if (!response.ok) {
        throw new Error(`HTTP Error Status Exception: ${response.status}`);
    }

    const data = await response.json();

    if (data.result !== 'success') {
        throw new Error(`ExchangeRate-API payload failure: ${data['error-type'] || 'Unknown'}`);
    }

    const ngnRate = data.conversion_rates?.NGN;

    if (!ngnRate) {
        throw new Error("Target conversion currency NGN is missing from returned payload");
    }

    return {
        currencyPair: 'USD_NGN',
        rate: Number(ngnRate),
        source: 'LIVE_EXCHANGERATE_API',
    };
};

// Circuit Breaker Options
const breakerOptions = {
    timeout: 5000,                // Open breaker if external API hangs > 5s
    errorThresholdPercentage: 50, // Trip breaker if half of recent requests fail
    resetTimeout: 30000,          // Wait 30s in OPEN state before testing via HALF_OPEN
};

const fxBreaker = new CircuitBreaker(fetchLiveExchangeRate, breakerOptions);

// Safe fallback mapping
fxBreaker.fallback(async (err) => {
    console.warn(`⚠️ [CIRCUIT BREAKER DETECTED TRIPPED/OPEN] Reason: ${err.message}. Routing execution to Simulator Fallback...`);
    return fetchSimulatedFallback();
});

export const fetchUsdNgnRate = async () => {
    return fxBreaker.fire();
};

// Orchestration Event Hook Telemetry
fxBreaker.on('open', () => console.log('🚨 [CIRCUIT BREAKER STATE SHIFT] 🔴 OPEN — Live API isolated due to persistent downstream exceptions.'));
fxBreaker.on('halfOpen', () => console.log('🚨 [CIRCUIT BREAKER STATE SHIFT] 🟡 HALF_OPEN — Testing live API connection via pilot request stream.'));
fxBreaker.on('close', () => console.log('🚨 [CIRCUIT BREAKER STATE SHIFT] 🟢 CLOSED — Live API connectivity normalized. Traffic restored.'));
