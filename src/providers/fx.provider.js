export const fetchUsdNgnRate = async () => {
    const base = 1550;
    const drift = Math.floor(Math.random() * 20 ) - 10;

    return {
        currencyPair: 'USD_NGN',
        rate: base + drift,
        source: 'SIMULATE_PROVIDER',
    };
};

