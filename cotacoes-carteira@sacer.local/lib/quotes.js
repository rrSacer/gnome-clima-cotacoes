import {getJson, postJson} from './http.js';

const num = v => Number(v);

// Dólar em reais. Fonte principal: Yahoo Finance (câmbio em tempo quase real).
export async function fetchUsdBrl(cancellable = null) {
  try {
    const data = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/BRL=X?interval=1d&range=5d', cancellable);
    const r = data.chart.result[0];
    const price = r.meta.regularMarketPrice;
    const closes = (r.indicators.quote[0].close ?? []).filter(c => c != null);
    // O último fechamento da série é o preço atual; o penúltimo é o fechamento do dia anterior.
    const prev = closes.length >= 2 ? closes[closes.length - 2] : r.meta.chartPreviousClose;
    return {
      price, prev,
      change: price - prev,
      pct: (price / prev - 1) * 100,
      high: r.meta.regularMarketDayHigh,
      low: r.meta.regularMarketDayLow,
      source: 'Yahoo Finance',
    };
  } catch (e) {
    console.warn(`[cotacoes] Yahoo falhou: ${e.message}`);
  }
  try {
    const d = await getJson('https://api.binance.com/api/v3/ticker/24hr?symbol=USDTBRL', cancellable);
    return {
      price: num(d.lastPrice), prev: num(d.prevClosePrice),
      change: num(d.priceChange), pct: num(d.priceChangePercent),
      high: num(d.highPrice), low: num(d.lowPrice), source: 'Binance (USDT/BRL)',
    };
  } catch (e) {
    console.warn(`[cotacoes] Binance USDT/BRL falhou: ${e.message}`);
  }
  const d = await getJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL', cancellable);
  return {price: d.rates.BRL, prev: null, change: null, pct: null, high: null, low: null, source: 'Frankfurter (BCE)'};
}

// Bitcoin em dólares, com variação das últimas 24 horas.
export async function fetchBtcUsd(cancellable = null) {
  try {
    const d = await getJson('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', cancellable);
    return {
      price: num(d.lastPrice), change: num(d.priceChange), pct: num(d.priceChangePercent),
      high: num(d.highPrice), low: num(d.lowPrice), source: 'Binance',
    };
  } catch (e) {
    console.warn(`[cotacoes] Binance BTC falhou: ${e.message}`);
  }
  try {
    const [d] = await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&price_change_percentage=24h', cancellable);
    return {
      price: d.current_price, change: d.price_change_24h, pct: d.price_change_percentage_24h,
      high: d.high_24h, low: d.low_24h, source: 'CoinGecko',
    };
  } catch (e) {
    console.warn(`[cotacoes] CoinGecko falhou: ${e.message}`);
  }
  const d = await getJson('https://api.coinbase.com/v2/prices/BTC-USD/spot', cancellable);
  return {price: num(d.data.amount), change: null, pct: null, high: null, low: null, source: 'Coinbase'};
}

// ---------- Carteira (somente leitura, usa só endereços públicos) ----------

export const BTC_ADDRESS_RE = /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

async function nativeBtcBalance(address, cancellable) {
  const sources = [
    `https://mempool.space/api/address/${address}`,
    `https://blockstream.info/api/address/${address}`,
  ];
  let lastError;
  for (const url of sources) {
    try {
      const d = await getJson(url, cancellable);
      const c = d.chain_stats, m = d.mempool_stats;
      const sats = c.funded_txo_sum - c.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum;
      return sats / 1e8;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Tokens que representam 1 BTC em redes compatíveis com a MetaMask (todos com 8 casas decimais).
const CBBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
export const WRAPPED_BTC = [
  {chain: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', symbol: 'WBTC', token: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'},
  {chain: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', symbol: 'cbBTC', token: CBBTC},
  {chain: 'Base', rpc: 'https://base-rpc.publicnode.com', symbol: 'cbBTC', token: CBBTC},
  {chain: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', symbol: 'WBTC', token: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f'},
  {chain: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', symbol: 'WBTC', token: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'},
  {chain: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com', symbol: 'WBTC', token: '0x68f180fcCe6836688e9084f035309E29Bf0A2095'},
];

async function erc20Balance(entry, owner, cancellable) {
  const data = `0x70a08231${owner.slice(2).toLowerCase().padStart(64, '0')}`;
  const res = await postJson(entry.rpc, {
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{to: entry.token, data}, 'latest'],
  }, cancellable);
  if (res.error) throw new Error(res.error.message);
  return Number(BigInt(res.result)) / 1e8;
}

/**
 * Soma o BTC das fontes configuradas. Devolve {total, parts:[{label, amount}], errors:[...]}
 * `btcAddresses` = lista de endereços Bitcoin; `evmAddress` = endereço 0x da MetaMask ('' para ignorar).
 */
export async function fetchWallet({btcAddresses, evmAddress, scanWrapped}, cancellable = null) {
  const jobs = [];
  for (const addr of btcAddresses) {
    jobs.push({label: `Bitcoin (${addr.slice(0, 6)}…${addr.slice(-4)})`, run: () => nativeBtcBalance(addr, cancellable)});
  }
  if (evmAddress && scanWrapped) {
    for (const entry of WRAPPED_BTC)
      jobs.push({label: `${entry.symbol} na ${entry.chain}`, run: () => erc20Balance(entry, evmAddress, cancellable)});
  }
  const settled = await Promise.allSettled(jobs.map(j => j.run()));
  const parts = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') parts.push({label: jobs[i].label, amount: r.value});
    else errors.push(`${jobs[i].label}: ${r.reason?.message ?? r.reason}`);
  });
  const total = parts.reduce((s, p) => s + p.amount, 0);
  return {total, parts, errors};
}
