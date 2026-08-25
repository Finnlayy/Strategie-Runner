/**
 * Universal Symbol Parser & Kraken / Kraken Pro Auto-Mapping (Frontend TypeScript).
 * Mirrors /app/data_layer/symbol_resolver.py deterministically.
 */

export interface ResolvedSymbol {
  rawInput: string;
  base: string;
  quote: string;
  canonical: string;
  lakePartition: string;
  krakenSpot: string;
  krakenProFutures: string;
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

  public static resolveAll(rawInput: string): ResolvedSymbol {
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
 * Returns the recognized unicode / fiat symbol for a given quote or asset pair.
 */
export function getCurrencySymbol(raw: string): string {
  if (!raw) return "$";
  const clean = raw.trim().toUpperCase();
  let quote = clean;
  if (clean.includes("/") || clean.includes("_") || clean.includes("-") || clean.includes(":")) {
    const parsed = ExchangeSymbolNormalizer.parse(clean);
    quote = parsed[1];
  } else if (ExchangeSymbolNormalizer.KNOWN_QUOTES.has(clean)) {
    quote = clean;
  }

  const symbolMap: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    CAD: "CA$",
    AUD: "A$",
    CHF: "CHF ",
    USDT: "₮",
    USDC: "USDC ",
    DAI: "DAI ",
    BTC: "₿",
    XBT: "₿",
    ETH: "Ξ",
    SOL: "SOL ",
    XRP: "XRP ",
  };

  return symbolMap[quote] || "$";
}

/**
 * Extracts normalized base, quote, currency symbol, and pair for ledger alignment.
 */
export function getLedgerCurrency(rawPairOrQuote?: string): { base: string; quote: string; symbol: string; pair: string } {
  const [base, quote] = ExchangeSymbolNormalizer.parse(rawPairOrQuote || "BTC/USD");
  const symbol = getCurrencySymbol(quote);
  return {
    base,
    quote,
    symbol,
    pair: `${base}/${quote}`,
  };
}

