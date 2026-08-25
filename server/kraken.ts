import crypto from "crypto";
import querystring from "querystring";

export interface KrakenTickerResult {
  pair: string;
  price: number;
  change24h: number;
  high: number;
  low: number;
  volume: number;
  timestamp: string;
}

export interface KrakenSymbolInfo {
  symbol: string;
  wsname: string;
  altname: string;
  base: string;
  quote: string;
  status: string;
  lotDecimals: number;
  pairDecimals: number;
  costDecimals?: number;
  ordermin?: string;
  costmin?: string;
  hasLeverage?: boolean;
  leverageBuy?: number[];
  leverageSell?: number[];
}

// In-memory cache of all Kraken & Kraken Pro symbols
let cachedSymbols: KrakenSymbolInfo[] = [];
let cachedSymbolsBySymbol: Map<string, KrakenSymbolInfo> = new Map();
let cachedSymbolsByAltname: Map<string, KrakenSymbolInfo> = new Map();
let cachedSymbolsByWsname: Map<string, KrakenSymbolInfo> = new Map();
let lastPairsFetchTime = 0;
const PAIRS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Popular curated pairs shown at top
export const POPULAR_KRAKEN_SYMBOLS = [
  "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD",
  "ADA/USD", "DOGE/USD", "AVAX/USD", "LINK/USD",
  "DOT/USD", "NEAR/USD", "SUI/USD", "PEPE/USD",
  "BTC/EUR", "ETH/EUR", "SOL/EUR", "XRP/EUR",
  "BTC/USDT", "ETH/USDT", "SOL/USDT", "USDT/USD"
];

export const DEFAULT_KRAKEN_SYMBOLS: KrakenSymbolInfo[] = POPULAR_KRAKEN_SYMBOLS.map(sym => {
  const [b, q] = sym.split("/");
  return {
    symbol: sym,
    wsname: `${b}/${q}`,
    altname: `${b}${q}`,
    base: b,
    quote: q,
    status: "online",
    lotDecimals: 8,
    pairDecimals: q === "USD" || q === "EUR" || q === "USDT" ? 2 : 6,
    hasLeverage: true
  };
});

// Seed mapping between user standard symbols and Kraken REST API pair identifiers
const PAIR_MAP_TO_KRAKEN: Record<string, string> = {
  "BTC/USD": "XXBTZUSD",
  "ETH/USD": "XETHZUSD",
  "SOL/USD": "SOLUSD",
  "XRP/USD": "XXRPZUSD",
  "ADA/USD": "ADAUSD",
  "DOGE/USD": "XDGUSD",
  "AVAX/USD": "AVAXUSD",
  "LINK/USD": "LINKUSD",
  "DOT/USD": "DOTUSD",
  "NEAR/USD": "NEARUSD",
  "SUI/USD": "SUIUSD",
  "PEPE/USD": "PEPEUSD",
  "BTC/EUR": "XXBTZEUR",
  "ETH/EUR": "XETHZEUR",
  "SOL/EUR": "SOLEUR",
  "XRP/EUR": "XXRPZEUR",
  "USDT/USD": "USDTZUSD"
};

const KRAKEN_PAIR_TO_STANDARD: Record<string, string> = {
  "XXBTZUSD": "BTC/USD",
  "XBTUSD": "BTC/USD",
  "XXBT": "BTC",
  "XETHZUSD": "ETH/USD",
  "ETHUSD": "ETH/USD",
  "SOLUSD": "SOL/USD",
  "XXRPZUSD": "XRP/USD",
  "XRPUSD": "XRP/USD",
  "XXBTZEUR": "BTC/EUR",
  "XETHZEUR": "ETH/EUR",
  "SOLEUR": "SOL/EUR",
  "XXRPZEUR": "XRP/EUR",
  "USDTZUSD": "USDT/USD"
};

function normalizeCurrencyCode(code: string): string {
  if (!code) return "";
  if (code === "XXBT" || code === "XBT") return "BTC";
  if (code === "XETH") return "ETH";
  if (code === "XXRP") return "XRP";
  if (code === "XXDG" || code === "XDG") return "DOGE";
  if (code === "XXLM") return "XLM";
  if (code === "XZEC") return "ZEC";
  if (code === "XMLN") return "MLN";
  if (code === "XREP") return "REP";
  if (code === "ZUSD") return "USD";
  if (code === "ZEUR") return "EUR";
  if (code === "ZGBP") return "GBP";
  if (code === "ZCAD") return "CAD";
  if (code === "ZJPY") return "JPY";
  if (code.startsWith("X") && code.length === 4) return code.substring(1);
  if (code.startsWith("Z") && code.length === 4) return code.substring(1);
  return code;
}

let krakenRateLimitedUntil = 0;

export function isKrakenRateLimited(): boolean {
  return Date.now() < krakenRateLimitedUntil;
}

/**
 * Fetches all available asset pairs and tradable symbols from Kraken and Kraken Pro.
 */
export async function fetchLiveKrakenAssetPairs(forceRefresh = false): Promise<KrakenSymbolInfo[]> {
  const now = Date.now();
  if (now < krakenRateLimitedUntil) {
    return cachedSymbols.length > 0 ? cachedSymbols : DEFAULT_KRAKEN_SYMBOLS;
  }

  if (!forceRefresh && cachedSymbols.length > 0 && (now - lastPairsFetchTime < PAIRS_CACHE_TTL)) {
    return cachedSymbols;
  }

  try {
    const url = "https://api.kraken.com/0/public/AssetPairs";
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4500),
      headers: {
        "User-Agent": "Kraken-Headless-Runner/2.0",
        "Accept": "application/json"
      }
    });

    if (res.status === 429) {
      console.warn("[Kraken API] Rate limit hit (429). Backing off for 60s.");
      krakenRateLimitedUntil = Date.now() + 60000;
      return cachedSymbols.length > 0 ? cachedSymbols : DEFAULT_KRAKEN_SYMBOLS;
    }

    if (!res.ok) {
      console.warn(`Kraken AssetPairs API returned status ${res.status}`);
      return cachedSymbols.length > 0 ? cachedSymbols : DEFAULT_KRAKEN_SYMBOLS;
    }

    const text = await res.text();
    if (!text || text.includes("Rate exceeded") || text.trim().startsWith("<")) {
      console.warn("[Kraken API] Rate exceeded or non-JSON returned.");
      krakenRateLimitedUntil = Date.now() + 60000;
      return cachedSymbols.length > 0 ? cachedSymbols : DEFAULT_KRAKEN_SYMBOLS;
    }

    let json: { error: string[]; result?: Record<string, any> };
    try {
      json = JSON.parse(text);
    } catch {
      return cachedSymbols.length > 0 ? cachedSymbols : DEFAULT_KRAKEN_SYMBOLS;
    }

    if (json.error && json.error.length > 0) {
      console.warn("Kraken AssetPairs API returned error:", json.error);
      return cachedSymbols.length > 0 ? cachedSymbols : DEFAULT_KRAKEN_SYMBOLS;
    }

    if (!json.result) {
      return cachedSymbols.length > 0 ? cachedSymbols : DEFAULT_KRAKEN_SYMBOLS;
    }

    const symbolList: KrakenSymbolInfo[] = [];
    const bySymbol = new Map<string, KrakenSymbolInfo>();
    const byAltname = new Map<string, KrakenSymbolInfo>();
    const byWsname = new Map<string, KrakenSymbolInfo>();

    for (const [key, data] of Object.entries(json.result)) {
      if (data.status === "delisted" || data.status === "cancel_only") continue;

      const altname = data.altname || key;
      let wsname = data.wsname || "";
      
      let base = normalizeCurrencyCode(data.base || "");
      let quote = normalizeCurrencyCode(data.quote || "");

      let cleanSymbol = "";
      if (wsname && wsname.includes("/")) {
        const [wsBase, wsQuote] = wsname.split("/");
        const normBase = normalizeCurrencyCode(wsBase);
        const normQuote = normalizeCurrencyCode(wsQuote);
        cleanSymbol = `${normBase}/${normQuote}`;
      } else {
        cleanSymbol = `${base}/${quote}`;
      }

      const hasLeverage = Boolean(
        (Array.isArray(data.leverage_buy) && data.leverage_buy.length > 0) ||
        (Array.isArray(data.leverage_sell) && data.leverage_sell.length > 0)
      );

      const symbolInfo: KrakenSymbolInfo = {
        symbol: cleanSymbol,
        wsname: data.wsname || cleanSymbol,
        altname,
        base,
        quote,
        status: data.status || "online",
        lotDecimals: data.lot_decimals ?? 8,
        pairDecimals: data.pair_decimals ?? 2,
        costDecimals: data.cost_decimals,
        ordermin: data.ordermin ? String(data.ordermin) : undefined,
        costmin: data.costmin ? String(data.costmin) : undefined,
        hasLeverage,
        leverageBuy: data.leverage_buy || [],
        leverageSell: data.leverage_sell || []
      };

      symbolList.push(symbolInfo);
      bySymbol.set(cleanSymbol.toUpperCase(), symbolInfo);
      byAltname.set(altname.toUpperCase(), symbolInfo);
      byAltname.set(key.toUpperCase(), symbolInfo);
      if (wsname) byWsname.set(wsname.toUpperCase(), symbolInfo);

      // Populate bidirectional mapping
      PAIR_MAP_TO_KRAKEN[cleanSymbol] = altname;
      PAIR_MAP_TO_KRAKEN[cleanSymbol.toUpperCase()] = altname;
      KRAKEN_PAIR_TO_STANDARD[altname] = cleanSymbol;
      KRAKEN_PAIR_TO_STANDARD[key] = cleanSymbol;
      if (wsname) KRAKEN_PAIR_TO_STANDARD[wsname] = cleanSymbol;
    }

    // Sort symbols alphabetically with USD, EUR, USDT pairs prioritized
    symbolList.sort((a, b) => {
      const aIsPopular = POPULAR_KRAKEN_SYMBOLS.includes(a.symbol);
      const bIsPopular = POPULAR_KRAKEN_SYMBOLS.includes(b.symbol);
      if (aIsPopular && !bIsPopular) return -1;
      if (!aIsPopular && bIsPopular) return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    cachedSymbols = symbolList;
    cachedSymbolsBySymbol = bySymbol;
    cachedSymbolsByAltname = byAltname;
    cachedSymbolsByWsname = byWsname;
    lastPairsFetchTime = now;

    console.log(`[Kraken Engine] Successfully cached ${cachedSymbols.length} active Kraken & Kraken Pro symbols.`);
    return cachedSymbols;
  } catch (err: any) {
    console.error("Failed to load Kraken asset pairs:", err.message || err);
    return cachedSymbols;
  }
}

export class ExchangeSymbolNormalizer {
  public static readonly KRAKEN_BASE_MAP: Record<string, string> = {
    BTC: "XXBT",
    XBT: "XXBT",
    ETH: "XETH",
    XRP: "XXRP",
    LTC: "XLTC",
    XLM: "XXLM",
    XMR: "XXMR",
    ETC: "XETC",
    ZEC: "XZEC",
    REP: "XREP",
    DOGE: "XDG",
    MLN: "XMLN",
    USD: "ZUSD",
    EUR: "ZEUR",
    GBP: "ZGBP",
    CAD: "ZCAD",
    JPY: "ZJPY",
    KRW: "ZKRW",
  };

  public static readonly REVERSE_KRAKEN_BASE_MAP: Record<string, string> = {
    XXBT: "BTC",
    XBT: "BTC",
    XETH: "ETH",
    XXRP: "XRP",
    XLTC: "LTC",
    XXLM: "XLM",
    XXMR: "XMR",
    XETC: "ETC",
    XZEC: "ZEC",
    XREP: "REP",
    XDG: "DOGE",
    XMLN: "MLN",
    ZUSD: "USD",
    ZEUR: "EUR",
    ZGBP: "GBP",
    ZCAD: "CAD",
    ZJPY: "JPY",
    ZKRW: "KRW",
  };

  public static readonly KNOWN_QUOTES = new Set([
    "USD", "USDT", "USDC", "EUR", "GBP", "CAD", "JPY",
    "CHF", "AUD", "DAI", "KRW", "SGD", "BUSD", "TUSD", "BTC", "ETH"
  ]);

  public static parse(rawInput: string): [string, string] {
    if (!rawInput || typeof rawInput !== "string") {
      return ["BTC", "USD"];
    }

    let clean = rawInput.trim().toUpperCase();
    clean = clean.replace(/^(KRAKEN|KRAKENPRO|KRAKEN_PRO|EXCHANGE|SPOT|FUTURES|PERP)[:_/\s]+/i, "").trim();

    if (clean.startsWith("XXBT") && clean.endsWith("ZUSD")) return ["BTC", "USD"];
    if (clean.startsWith("XXBT") && clean.endsWith("ZEUR")) return ["BTC", "EUR"];
    if (clean.startsWith("XETH") && clean.endsWith("ZUSD")) return ["ETH", "USD"];
    if (clean.startsWith("XETH") && clean.endsWith("ZEUR")) return ["ETH", "EUR"];

    clean = clean.replace(/[\s\-_\.:|]+/g, "/");

    if (clean.includes("/")) {
      const parts = clean.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const base = parts[0];
        const quote = parts[1];
        const resolvedBase = (base === "XBT" || base === "XXBT") ? "BTC" : (this.REVERSE_KRAKEN_BASE_MAP[base] || base);
        const resolvedQuote = this.REVERSE_KRAKEN_BASE_MAP[quote] || quote;
        return [resolvedBase, resolvedQuote];
      } else if (parts.length === 1) {
        clean = parts[0];
      }
    }

    const sortedQuotes = Array.from(this.KNOWN_QUOTES).sort((a, b) => b.length - a.length);
    for (const quote of sortedQuotes) {
      if (clean.endsWith(quote) && clean.length > quote.length) {
        const base = clean.slice(0, -quote.length);
        const resolvedBase = (base === "XBT" || base === "XXBT") ? "BTC" : (this.REVERSE_KRAKEN_BASE_MAP[base] || base);
        return [resolvedBase, quote];
      }
    }

    const resolvedBase = (clean === "XBT" || clean === "XXBT") ? "BTC" : (this.REVERSE_KRAKEN_BASE_MAP[clean] || clean);
    return [resolvedBase, "USD"];
  }

  public static toCanonical(rawInput: string): string {
    const [base, quote] = this.parse(rawInput);
    return `${base}/${quote}`;
  }

  public static toLakePartition(rawInput: string): string {
    const [base, quote] = this.parse(rawInput);
    return `${base}_${quote}`;
  }

  public static toKrakenSpot(rawInput: string): string {
    const [base, quote] = this.parse(rawInput);
    const kBase = this.KRAKEN_BASE_MAP[base] || base;
    const kQuote = this.KRAKEN_BASE_MAP[quote] || quote;
    return `${kBase}${kQuote}`;
  }

  public static toKrakenProFutures(rawInput: string): string {
    const [base, quote] = this.parse(rawInput);
    const fBase = (base === "BTC" || base === "XXBT") ? "XBT" : base;
    return `PF_${fBase}${quote}`;
  }

  public static resolveAll(rawInput: string) {
    const [base, quote] = this.parse(rawInput);
    return {
      rawInput,
      base,
      quote,
      canonical: `${base}/${quote}`,
      lakePartition: `${base}_${quote}`,
      krakenSpot: this.toKrakenSpot(rawInput),
      krakenProFutures: this.toKrakenProFutures(rawInput),
    };
  }
}

/**
 * Resolves any user-entered pair format into Kraken's internal REST API pair name.
 */
export function resolveKrakenPair(userPair: string): string {
  if (!userPair) return "XXBTZUSD";
  const clean = userPair.trim().toUpperCase();
  if (PAIR_MAP_TO_KRAKEN[clean]) return PAIR_MAP_TO_KRAKEN[clean];
  if (cachedSymbolsBySymbol.has(clean)) return cachedSymbolsBySymbol.get(clean)!.altname;
  if (cachedSymbolsByWsname.has(clean)) return cachedSymbolsByWsname.get(clean)!.altname;
  if (cachedSymbolsByAltname.has(clean)) return cachedSymbolsByAltname.get(clean)!.altname;

  // Use Universal ExchangeSymbolNormalizer
  return ExchangeSymbolNormalizer.toKrakenSpot(userPair);
}

/**
 * Fetches 100% authentic, real-time market tickers directly from Kraken's public REST API.
 */
export async function fetchLiveKrakenTickers(extraPairs: string[] = []): Promise<Record<string, KrakenTickerResult> | null> {
  const now = Date.now();
  if (now < krakenRateLimitedUntil) {
    return null;
  }

  try {
    // Ensure symbols cache is initialized
    if (cachedSymbols.length === 0) {
      await fetchLiveKrakenAssetPairs();
    }

    const defaultPairs = ["XBTUSD", "ETHUSD", "SOLUSD", "XRPUSD"];
    const extraKrakenPairs = extraPairs
      .map(p => resolveKrakenPair(p))
      .filter(p => Boolean(p) && !defaultPairs.includes(p));

    const allPairsQuery = [...defaultPairs, ...extraKrakenPairs].join(",");
    const url = `https://api.kraken.com/0/public/Ticker?pair=${allPairsQuery}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: {
        "User-Agent": "Kraken-Headless-Runner/2.0",
        "Accept": "application/json"
      }
    });

    if (res.status === 429) {
      console.warn("[Kraken API] Rate limit hit (429) on Ticker. Backing off for 60s.");
      krakenRateLimitedUntil = Date.now() + 60000;
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const text = await res.text();
    if (!text || text.includes("Rate exceeded") || text.trim().startsWith("<")) {
      console.warn("[Kraken API] Rate exceeded response received. Backing off for 60s.");
      krakenRateLimitedUntil = Date.now() + 60000;
      return null;
    }

    let json: { error: string[]; result?: Record<string, any> };
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }

    if (json.error && json.error.length > 0) {
      if (json.error.some(e => e.includes("Too many requests") || e.includes("Rate limit"))) {
        krakenRateLimitedUntil = Date.now() + 60000;
      }
      return null;
    }

    if (!json.result) {
      return null;
    }

    const mappedTickers: Record<string, KrakenTickerResult> = {};

    for (const [kPair, data] of Object.entries(json.result)) {
      const standardPair = KRAKEN_PAIR_TO_STANDARD[kPair] || 
                           (cachedSymbolsByAltname.get(kPair.toUpperCase())?.symbol) || 
                           kPair;
      
      const currentPrice = parseFloat(data.c?.[0] || "0");
      const openPrice = parseFloat(data.o || "0");
      const highPrice = parseFloat(data.h?.[1] || data.h?.[0] || "0");
      const lowPrice = parseFloat(data.l?.[1] || data.l?.[0] || "0");
      const volume24h = parseFloat(data.v?.[1] || data.v?.[0] || "0");

      let change24h = 0;
      if (openPrice > 0) {
        change24h = parseFloat((((currentPrice - openPrice) / openPrice) * 100).toFixed(2));
      }

      mappedTickers[standardPair] = {
        pair: standardPair,
        price: currentPrice,
        change24h,
        high: highPrice,
        low: lowPrice,
        volume: volume24h,
        timestamp: new Date().toISOString()
      };
    }

    return mappedTickers;
  } catch (err: any) {
    console.error("Failed to fetch live Kraken tickers:", err.message || err);
    return null;
  }
}


/**
 * Fetches recent public trades executed directly on Kraken.
 */
export async function fetchLiveKrakenTrades(pair: string = "BTC/USD"): Promise<any[] | null> {
  if (isKrakenRateLimited()) return null;
  try {
    const krakenPair = PAIR_MAP_TO_KRAKEN[pair] || "XXBTZUSD";
    const url = `https://api.kraken.com/0/public/Trades?pair=${krakenPair}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: {
        "User-Agent": "Kraken-Headless-Runner/2.0"
      }
    });

    if (res.status === 429) {
      krakenRateLimitedUntil = Date.now() + 60000;
      return null;
    }

    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.includes("Rate exceeded") || text.trim().startsWith("<")) {
      krakenRateLimitedUntil = Date.now() + 60000;
      return null;
    }
    const json = JSON.parse(text) as { error: string[]; result?: Record<string, any> };
    if (json.error && json.error.length > 0) {
      if (json.error.some(e => e.includes("Rate limit") || e.includes("Too many requests"))) {
        krakenRateLimitedUntil = Date.now() + 60000;
      }
      return null;
    }
    
    // Return first pair array in result
    if (json.result) {
      const firstKey = Object.keys(json.result).find(k => k !== 'last');
      if (firstKey && Array.isArray(json.result[firstKey])) {
        return json.result[firstKey];
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface KrakenCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
  count: number;
  timestamp: string;
}

/**
 * Fetches real historical OHLC candlestick data from Kraken's public REST API.
 * Valid intervals: 1 (1m), 5 (5m), 15 (15m), 30 (30m), 60 (1h), 240 (4h), 1440 (1d), 10080 (1w), 21600 (15d).
 */
export async function fetchLiveKrakenOHLC(
  pair: string = "BTC/USD", 
  interval: number = 15,
  since?: number
): Promise<KrakenCandle[] | null> {
  if (isKrakenRateLimited()) return null;
  try {
    const krakenPair = resolveKrakenPair(pair);
    let url = `https://api.kraken.com/0/public/OHLC?pair=${krakenPair}&interval=${interval}`;
    if (since) {
      url += `&since=${since}`;
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": "Kraken-Headless-Runner/2.0",
        "Accept": "application/json"
      }
    });

    if (res.status === 429) {
      krakenRateLimitedUntil = Date.now() + 60000;
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const text = await res.text();
    if (!text || text.includes("Rate exceeded") || text.trim().startsWith("<")) {
      krakenRateLimitedUntil = Date.now() + 60000;
      return null;
    }

    const json = JSON.parse(text) as { error: string[]; result?: Record<string, any> };
    if (json.error && json.error.length > 0) {
      if (json.error.some(e => e.includes("Rate limit") || e.includes("Too many requests"))) {
        krakenRateLimitedUntil = Date.now() + 60000;
      }
      return null;
    }

    if (!json.result) return null;

    const dataKey = Object.keys(json.result).find(k => k !== "last");
    if (!dataKey || !Array.isArray(json.result[dataKey])) {
      return null;
    }

    const rawCandles = json.result[dataKey];
    const candles: KrakenCandle[] = rawCandles.map((c: any[]) => {
      const epochSec = Number(c[0]);
      return {
        time: epochSec,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        vwap: parseFloat(c[5]),
        volume: parseFloat(c[6]),
        count: Number(c[7]),
        timestamp: new Date(epochSec * 1000).toISOString()
      };
    });

    return candles;
  } catch (err: any) {
    return null;
  }
}

let lastNonce = Date.now() * 1000;
function getNextNonce(): string {
  const now = Date.now() * 1000;
  if (now <= lastNonce) {
    lastNonce += 1;
    return lastNonce.toString();
  }
  lastNonce = now;
  return lastNonce.toString();
}

/**
 * Generates official Kraken HMAC-SHA512 API Sign digest.
 */
export function getKrakenSignature(urlPath: string, postDataStr: string, nonce: string | number, secret: string): string {
  const secretBuffer = Buffer.from(secret, 'base64');
  const sha256 = crypto.createHash('sha256').update(String(nonce) + postDataStr).digest();
  const hmacDigest = crypto.createHmac('sha512', secretBuffer)
    .update(urlPath)
    .update(sha256)
    .digest('base64');
  return hmacDigest;
}

/**
 * Invokes an authenticated private Kraken endpoint.
 */
export async function callKrakenPrivate(urlPath: string, params: Record<string, any> = {}): Promise<{ error: string[]; result?: any }> {
  const apiKey = process.env.KRAKEN_API_KEY?.trim();
  const apiSecret = process.env.KRAKEN_API_SECRET?.trim();

  if (!apiKey || !apiSecret) {
    return {
      error: ["EAPI:Missing Kraken API credentials (KRAKEN_API_KEY or KRAKEN_API_SECRET) in environment."],
      result: null
    };
  }

  if (isKrakenRateLimited()) {
    return {
      error: ["EAPI:Rate limit cooldown active. Backing off to prevent account suspension."],
      result: null
    };
  }

  try {
    const nonce = getNextNonce();
    const postDataObj = { nonce, ...params };
    const postData = querystring.stringify(postDataObj);

    const signature = getKrakenSignature(urlPath, postData, nonce, apiSecret);

    const response = await fetch(`https://api.kraken.com${urlPath}`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "API-Key": apiKey,
        "API-Sign": signature,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": "Kraken-Strategy-Runner/2.0"
      },
      body: postData
    });

    if (response.status === 429) {
      krakenRateLimitedUntil = Date.now() + 60000;
      return {
        error: ["EAPI:Rate limit exceeded (HTTP 429). Cooldown initiated."],
        result: null
      };
    }

    const text = await response.text();
    if (!text || text.includes("Rate exceeded") || text.trim().startsWith("<")) {
      krakenRateLimitedUntil = Date.now() + 60000;
      return {
        error: ["EAPI:Rate limit exceeded. Cooldown initiated."],
        result: null
      };
    }

    let data: { error: string[]; result?: any };
    try {
      data = JSON.parse(text);
    } catch {
      return {
        error: ["EAPI:Invalid response from Kraken API"],
        result: null
      };
    }

    if (data.error && data.error.some(e => e.includes("Rate limit") || e.includes("Too many requests"))) {
      krakenRateLimitedUntil = Date.now() + 60000;
    }

    return data;
  } catch (err: any) {
    return {
      error: [`EAPI:Network failure contacting Kraken: ${err.message || err}`],
      result: null
    };
  }
}

/**
 * Checks if Kraken API credentials are configured in environment variables.
 */
export function hasKrakenCredentials(): boolean {
  return Boolean(process.env.KRAKEN_API_KEY?.trim() && process.env.KRAKEN_API_SECRET?.trim());
}

let runtimePaperTradingOverride: boolean | null = null;

/**
 * Returns whether paper trading mode is enabled.
 */
export function isKrakenPaperTrading(): boolean {
  if (runtimePaperTradingOverride !== null) {
    return runtimePaperTradingOverride;
  }
  // Default to paper trading mode (with Kraken validate=true) unless explicitly set to false
  return process.env.KRAKEN_PAPER_TRADING !== 'false';
}

/**
 * Sets runtime paper trading mode toggle.
 */
export function setKrakenPaperTrading(isPaper: boolean): void {
  runtimePaperTradingOverride = isPaper;
  process.env.KRAKEN_PAPER_TRADING = isPaper ? 'true' : 'false';
}

/**
 * Returns the current automation level of Kraken CLIs / runners:
 * Level 2: Guarded Paper Automation (Simulated ledger / order validation with validate=true)
 * Level 4: Full Autonomous Live Capital Execution (Live exchange order placement)
 */
export function getKrakenAutomationLevel(): 2 | 4 {
  return isKrakenPaperTrading() ? 2 : 4;
}

/**
 * Sets the automation level for Kraken CLIs / runners.
 * Level 2 enables Paper Trading. Level 4 enables Live Trading.
 */
export function setKrakenAutomationLevel(level: number): 2 | 4 {
  const isPaper = level <= 2;
  setKrakenPaperTrading(isPaper);
  return isPaper ? 2 : 4;
}

/**
 * Retrieves the official Kraken exchange minimum order volume (ordermin) in base currency tokens.
 */
export function getKrakenMinimumOrderVolume(pair: string): { ordermin: number; costmin?: number; baseAsset: string; orderminRaw?: string } {
  const clean = pair.trim().toUpperCase();
  const info = cachedSymbolsBySymbol.get(clean) || cachedSymbolsByAltname.get(clean) || cachedSymbolsByWsname.get(clean);
  const baseAsset = clean.split('/')[0] || "ASSET";

  if (info && info.ordermin) {
    const minVal = parseFloat(info.ordermin);
    if (!isNaN(minVal) && minVal > 0) {
      return {
        ordermin: minVal,
        costmin: info.costmin ? parseFloat(info.costmin) : undefined,
        baseAsset: info.base || baseAsset,
        orderminRaw: info.ordermin
      };
    }
  }

  // Known fallback defaults according to official Kraken specifications (in base currency tokens, not USD)
  const defaultMinimums: Record<string, number> = {
    "XRP": 10.0,
    "XXRP": 10.0,
    "BTC": 0.0001,
    "XXBT": 0.0001,
    "XBT": 0.0001,
    "ETH": 0.002,
    "XETH": 0.002,
    "SOL": 0.05,
    "ADA": 10.0,
    "DOGE": 50.0,
    "DOT": 1.0,
    "LINK": 0.5,
    "LTC": 0.02,
    "AVAX": 0.1,
    "USDT": 5.0,
    "USDC": 5.0
  };

  const fallback = defaultMinimums[baseAsset] || 0.001;
  return {
    ordermin: fallback,
    baseAsset,
    orderminRaw: String(fallback)
  };
}

/**
 * Submits an order to Kraken (either in paper validation mode or live execution).
 */
export async function submitKrakenOrder(
  pair: string,
  type: 'buy' | 'sell',
  volume: number,
  price?: number,
  paperTrading: boolean = true
): Promise<{ success: boolean; data?: any; error?: string; adjustedVolume?: number }> {
  const krakenPair = PAIR_MAP_TO_KRAKEN[pair] || resolveKrakenPair(pair) || pair;

  // Verify and enforce minimum order size (ordermin)
  const minInfo = getKrakenMinimumOrderVolume(pair);
  const effectiveVolume = volume < minInfo.ordermin ? minInfo.ordermin : volume;

  // Format volume to appropriate decimal places
  const cleanVolume = Number(effectiveVolume.toFixed(6)).toString();

  const params: Record<string, any> = {
    pair: krakenPair,
    type,
    ordertype: price ? 'limit' : 'market',
    volume: cleanVolume
  };

  // Only attach price if limit order
  if (price && price > 0) {
    params.price = price.toFixed(2);
  }

  // Official Kraken paper validation flag: validate=true validates order against Kraken's matching engine rules without executing
  if (paperTrading) {
    params.validate = "true";
  }

  const response = await callKrakenPrivate("/0/private/AddOrder", params);

  if (response.error && response.error.length > 0) {
    return {
      success: false,
      error: response.error.join(", "),
      adjustedVolume: effectiveVolume
    };
  }

  return {
    success: true,
    data: response.result,
    adjustedVolume: effectiveVolume
  };
}

/**
 * Dispatches a cancel-all signal to Kraken.
 */
export async function cancelAllKraken(): Promise<{ success: boolean; data?: any; error?: string }> {
  const response = await callKrakenPrivate("/0/private/CancelAll", {});
  if (response.error && response.error.length > 0) {
    return {
      success: false,
      error: response.error.join(", ")
    };
  }
  return {
    success: true,
    data: response.result
  };
}
