export interface TradingStrategy {
  id: string;
  name: string;
  description: string;
  code: string;
  status: 'active' | 'inactive' | 'archived' | 'error';
  assetPair: string;
  interval: number; // in minutes (Kraken OHLC timeframe: 1, 5, 15, 30, 60, 240, 1440, etc.)
  executionMode?: 'paper' | 'live'; // Strategy-specific independent execution queue
  parameters: Record<string, number | string | boolean>;
  hardStopEnabled?: boolean;
  hardStopPercent?: number;
  createdAt: string;
  seededFromId?: string;
  seededFromName?: string;
  version?: number;
  archivedAt?: string;
  evolutionGeneration?: number;
  evolutionFitness?: number;
  modelSource?: 'google_drive' | 'local' | 'synthesized';
  onnxFileId?: string;
  onnxFileName?: string;
  onnxFileChecksum?: string;
  onnxModelType?: string;
  stateVectorDim?: number;
}

/**
 * Formats a strategy interval / timeframe into standard Kraken format (e.g., 1m, 5m, 15m, 1h, 4h, 1d)
 */
export function formatTimeframe(intervalMinutesOrSecs?: number | null): string {
  if (!intervalMinutesOrSecs && intervalMinutesOrSecs !== 0) return "5m";
  const num = Number(intervalMinutesOrSecs);
  if (num === 1) return "1m";
  if (num === 5) return "5m";
  if (num === 15) return "15m";
  if (num === 30) return "30m";
  if (num === 60) return "1h";
  if (num === 240) return "4h";
  if (num === 720) return "12h";
  if (num === 1440) return "1d";
  if (num === 10080) return "1w";
  if (num === 21600) return "15d";
  if (num >= 60 && num % 60 === 0) return `${num / 60}h`;
  return `${num}m`;
}

export interface MarketTicker {
  pair: string;
  price: number;
  change24h: number;
  high: number;
  low: number;
  volume: number;
  timestamp: string;
}

export interface ExecutionLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'trade';
  message: string;
  strategyId?: string;
}

export interface TradeOrder {
  id: string;
  strategyId: string;
  strategyName: string;
  timestamp: string;
  type: 'buy' | 'sell';
  price: number;
  amount: number;
  total: number;
  pair: string;
  status: 'filled' | 'pending';
  executionMode?: 'paper' | 'live';
  pnl?: number;
  onnxAction?: 'BUY' | 'HOLD' | 'SELL';
  onnxConfidence?: number;
  onnxLatencyMs?: number;
  onnxModelName?: string;
  onnxValueEstimate?: number;
}

export interface OnnxLearningStep {
  step: number;
  timestamp: string;
  transitionsProcessed: number;
  meanReward: number;
  policyLoss: number;
  valueLoss: number;
  entropy: number;
  learningRate: number;
  weightsHash: string;
}

export interface OnnxExperienceTransition {
  id: string;
  timestamp: string;
  strategyId: string;
  state: number[];
  action: number;
  actionName: "BUY" | "HOLD" | "SELL";
  reward: number;
  nextState: number[];
  done: boolean;
  valueEstimate: number;
  confidence: number;
}

export interface OnnxModelMetadata {
  id: string;
  fileName: string;
  filePath: string;
  modelType: "ppo" | "dqn" | "lstm" | "actor_critic" | "custom";
  fileSizeBytes: number;
  checksum: string;
  producer: string;
  irVersion: number;
  opset: number;
  inputs: Array<{ name: string; shape: any[]; type: number }>;
  outputs: Array<{ name: string; shape: any[]; type: number }>;
  totalParameters: number;
  totalInferences: number;
  avgLatencyMs: number;
  lastInferenceAt?: string;
  experienceCount: number;
  learningHistory: OnnxLearningStep[];
}

export interface OnnxInferenceResult {
  success: boolean;
  action: "BUY" | "HOLD" | "SELL";
  actionIndex: number;
  confidence: number;
  actionProbs: { BUY: number; HOLD: number; SELL: number };
  valueEstimate: number;
  latencyMs: number;
  stateVector: number[];
  modelPath: string;
  error?: string;
}

export interface StrategyPnL {
  strategyId: string;
  strategyName: string;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  volumeTradedUSD: number;
  executionMode?: 'paper' | 'live';
}

export interface DailyPnLDay {
  date: string; // "YYYY-MM-DD"
  formattedDate: string; // "Aug 14, 2026"
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  dayLabel: string; // "Sun", "Mon", etc.
  dayOfMonth: number; // 1-31
  monthLabel: string; // "Aug"
  pnl: number; // Net USD P&L
  realizedPnL: number;
  unrealizedPnL?: number;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  volumeUSD: number;
  isToday: boolean;
  isFuture?: boolean;
  machineState?: {
    automationLevel: number;
    executionMode: 'paper' | 'live';
    engineStatus: 'active' | 'idle' | 'halted' | 'standby';
    activeWorkersCount: number;
    daemonHealth: string;
  };
}

export interface DailyPnLHeatmapData {
  strategyId: string;
  strategyName: string;
  assetPair: string;
  year?: number;
  month?: number;
  monthLabel?: string;
  days: DailyPnLDay[];
  total30DPnL: number;
  totalMonthPnL?: number;
  greenDays: number;
  redDays: number;
  flatDays: number;
  bestDay: { date: string; formattedDate: string; pnl: number };
  worstDay: { date: string; formattedDate: string; pnl: number };
  winRatePercent: number; // % of profitable days
  avgDailyPnL: number;
  profitFactor: number;
}

export interface StrategyQueueMatrix {
  strategyId: string;
  strategyName: string;
  assetPair: string;
  status: 'active' | 'inactive' | 'error';
  interval: number;
  executionMode: 'paper' | 'live';
  parameters?: Record<string, any>;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  volumeTradedUSD: number;
  profitFactor: number;
  maxDrawdown: number;
  avgTradeReturn: number;
  bestTrade: number;
  worstTrade: number;
  trades: TradeOrder[];
}

export interface QueueMatrixData {
  queue: 'paper' | 'live';
  queueLabel: string;
  automationLevel: number;
  totalRealizedPnL: number;
  totalUnrealizedPnL: number;
  totalPnL: number;
  cumulativeReturnPercent: number;
  totalClosedTrades: number;
  totalAllTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  volumeTradedUSD: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPercent: number;
  averageTradeReturn: number;
  bestTradeUSD: number;
  worstTradeUSD: number;
  activeWorkers: number;
  strategies: StrategyQueueMatrix[];
  allTimeTrades: TradeOrder[];
  pnlTrajectory: Array<{
    tradeIndex: number;
    time: string;
    tradePnL: number;
    cumPnL: number;
    pair: string;
    type: 'buy' | 'sell';
    strategyName: string;
  }>;
  assetBreakdown: Array<{
    pair: string;
    volumeUSD: number;
    tradesCount: number;
    netPnL: number;
    winRate: number;
  }>;
}

export interface KrakenSpotPosition {
  asset: string;
  name: string;
  amount: number;
  available: number;
  inOrders: number;
  unitPriceUSD: number;
  totalValueUSD: number;
  portfolioPercentage: number;
  change24h: number;
  type: 'fiat' | 'crypto' | 'stablecoin';
}

export interface KrakenProPosition {
  id: string;
  pair: string;
  type: 'long' | 'short';
  contractType: 'perpetual' | 'margin' | 'futures';
  size: number;
  notionalValueUSD: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  collateralUSD: number;
  marginRequirementUSD: number;
  unrealizedPnLUSD: number;
  unrealizedPnLPercent: number;
  fundingRate?: number;
  status: 'open' | 'closed';
}

export interface KrakenAccountLedgers {
  mode: 'paper' | 'live';
  hasCredentials: boolean;
  lastSync: string;
  spot: {
    totalValueUSD: number;
    freeCashUSD: number;
    cryptoValueUSD: number;
    change24hUSD: number;
    change24hPercent: number;
    assets: KrakenSpotPosition[];
  };
  pro: {
    totalCollateralUSD: number;
    freeMarginUSD: number;
    usedMarginUSD: number;
    marginLevelPercent: number;
    totalUnrealizedPnL: number;
    unrealizedPnLPercent: number;
    effectiveLeverage: number;
    positions: KrakenProPosition[];
  };
}

export interface RunnerMetrics {
  cpuUsage: number;
  memoryUsage: number;
  latencyMs: number;
  activeWorkers: number;
  paperWorkers?: number;
  liveWorkers?: number;
  totalTrades: number;
  profitLossPercentage: number;
  balanceUSD: number;
  balanceBTC: number;
  portfolioUSD?: number;
  baselineUSD?: number;
  initialPaperBalanceUSD?: number;
  automationLevel?: 2 | 4;
  automationLevelLabel?: string;
  activeLedgerMode?: 'paper' | 'live';
  paperBalances?: Record<string, number>;
  liveKrakenBalances?: Record<string, number>;
  hasCredentials?: boolean;
}

export interface StrategyManifest {
  schemaVersion: string;
  manifestId: string;
  updatedAt: string;
  totalStrategies: number;
  activeCount: number;
  environment: string;
  strategies: TradingStrategy[];
  persistedPath?: string;
}

export interface AuditReport {
  status: 'clean' | 'warning' | 'error';
  summary: string;
  issues: string[];
  recommendations: string;
  riskScore?: number;
  codeSmells?: string[];
  manifestLearnedInsights?: string;
}

export interface TweakedStrategyResult {
  name: string;
  description: string;
  assetPair: string;
  interval: number;
  parameters: Record<string, number | string | boolean>;
  code: string;
  tweaksApplied: string[];
  reasoning: string;
  expectedImprovement: string;
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

export interface KrakenAssetPairsResponse {
  total: number;
  symbols: KrakenSymbolInfo[];
  quotes: string[];
  popularSymbols: string[];
}

export interface BacktestConfig {
  strategyId: string;
  assetPair: string;
  interval: number; // Kraken interval: 1, 5, 15, 30, 60, 240, 1440
  candleCount: number; // e.g. 100, 250, 500, 720
  initialBalance: number; // e.g. 10000 USD
  feePercent: number; // e.g. 0.26%
  slippagePercent: number; // e.g. 0.05%
  hardStopEnabled: boolean;
  hardStopPercent: number;
  customParameters?: Record<string, any>;
  customCode?: string;
}

export interface BacktestTrade {
  id: string;
  type: 'buy' | 'sell';
  entryTime: string;
  exitTime?: string;
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  totalValue: number;
  fee: number;
  pnl: number;
  pnlPercent: number;
  reason: string;
  status: 'closed' | 'open';
}

export interface BacktestEquityPoint {
  timestamp: string;
  time: string;
  price: number;
  equity: number;
  benchmarkEquity: number;
  drawdown: number;
  cash: number;
  assetHoldings: number;
  action?: 'buy' | 'sell' | 'stop-loss';
  tradePrice?: number;
}

export interface BacktestSummary {
  initialBalance: number;
  finalBalance: number;
  totalReturnUSD: number;
  totalReturnPercent: number;
  benchmarkReturnPercent: number;
  alpha: number;
  maxDrawdownPercent: number;
  maxDrawdownUSD: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageTradeReturn: number;
  bestTradeUSD: number;
  worstTradeUSD: number;
  avgHoldCandles: number;
  totalFeesPaid: number;
  calmarRatio?: number;
  annualizedVolatilityPercent?: number;
  exposurePercent?: number;
  beta?: number;
  informationRatio?: number;
  var95Percent?: number;
  cvar95Percent?: number;
}

export interface BacktestAIAnalysis {
  score: number;
  verdict: 'Exceptional' | 'Viable' | 'Needs Optimization' | 'High Risk';
  executiveSummary: string;
  regimePerformance: {
    trendingUp: string;
    trendingDown: string;
    choppyRange: string;
  };
  drawdownDiagnosis: string;
  recommendedTweaks: string[];
  suggestedParameters?: Record<string, any>;
}

export interface BacktestResult {
  id: string;
  strategyId: string;
  strategyName: string;
  assetPair: string;
  interval: number;
  periodLabel: string;
  startTime: string;
  endTime: string;
  totalCandles: number;
  summary: BacktestSummary;
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
  aiAnalysis?: BacktestAIAnalysis;
  runId?: string;
  engine?: string;
  engineRequested?: string;
  symbols?: string[];
  analytics?: QjAnalytics;
  artifacts?: QjArtifact[];
  warnings?: string[];
}

// GENETIC WALK-FORWARD STRATEGY OPTIMIZER TYPES
export interface GeneticChromosome {
  // 1. ATR Dynamic Stop / Take-Profit Genes
  atrPeriod: number; // 7 - 30
  atrStopMultiplier: number; // 1.0 - 4.5
  atrTakeProfitMultiplier: number; // 1.5 - 8.0
  useTrailingAtr: boolean;
  trailingAtrStep: number; // 0.2 - 2.0

  // 2. Volume Filters
  useVolumeFilter: boolean;
  rvolThreshold: number; // 1.0 - 3.5 (Relative Volume compared to 20-SMA)
  useObvTrend: boolean; // On-Balance Volume slope confirmation

  // 3. Trend Filters
  useTrendFilter: boolean;
  trendFastEma: number; // 5 - 35
  trendSlowEma: number; // 35 - 200
  adxFilterEnabled: boolean;
  adxThreshold: number; // 15 - 35

  // 4. Fair Value Gap (FVG) Imbalance Filters
  useFvgFilter: boolean;
  fvgMinGapPercent: number; // 0.05% - 1.0%
  fvgMitigationStrict: boolean; // Require price to retest FVG imbalance before entry

  // 5. Change In State of Delivery (CISD) & SMC Structure Filters
  useCisdFilter: boolean;
  cisdLookback: number; // 5 - 25 candles
  cisdDisplacementMult: number; // 1.1 - 2.5x average body range

  // 6. Multi-Timeframe (MTF) Alignment
  useMtfFilter: boolean;
  mtfMultiplier: number; // 3 - 12 (e.g. 5m -> 15m/1h macro trend)
  mtfTrendEma: number; // 20 - 100 on higher timeframe

  // 7. Sizing & Risk
  riskPerTradePercent: number; // 0.5% - 5.0%
}

export interface GeneticIndividual {
  id: string;
  generation: number;
  genes: GeneticChromosome;
  fitness: number;
  inSampleSummary: BacktestSummary;
  outOfSampleSummary: BacktestSummary;
  overallReturn: number;
  overallDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  tradesCount: number;
  robustnessIndex: number; // (OOS Sharpe / IS Sharpe) * 100 or stability rating
  rank: number;
  isSurvivor: boolean;
  isBaselineSeed?: boolean;
}

export interface GeneticConfig {
  populationSize: number; // 30 individuals
  maxGenerations: number; // 50 generations
  survivorsCount: number; // 3 survivors
  mutationRate: number; // e.g. 0.18
  crossoverRate: number; // e.g. 0.80
  walkForwardSplitPercent: number; // e.g. 70 (70% In-Sample Train / 30% Out-of-Sample Test)
  assetPair: string;
  interval: number;
  candleCount: number;
  initialBalance: number;
  feePercent: number;
  slippagePercent: number;
  baselineStrategyId?: string; // Optional: seed initial population with an existing strategy
  baselineStrategyName?: string;
  seedGenes?: Partial<GeneticChromosome>;
}

export interface GenerationHistoryPoint {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  bestReturn: number;
  bestSharpe: number;
  bestDrawdown: number;
  bestIndividualId: string;
}

export interface GeneticOptimizationResult {
  id: string;
  assetPair: string;
  interval: number;
  totalGenerationsCompleted: number;
  populationSize: number;
  survivorCount: number;
  bestIndividual: GeneticIndividual;
  topSurvivors: GeneticIndividual[];
  population: GeneticIndividual[];
  history: GenerationHistoryPoint[];
  inSampleCandles: number;
  outOfSampleCandles: number;
  generatedCode: string;
  baselineStrategyId?: string;
  baselineStrategyName?: string;
  baselineIndividual?: GeneticIndividual;
  baselineComparison?: {
    returnDelta: number;
    sharpeDelta: number;
    winRateDelta: number;
    drawdownDelta: number;
    baselineFitness: number;
    evolvedFitness: number;
    improvementPercent: number;
    isBetter: boolean;
  };
}

// ---------------------------------------------------------------------------
// QUANTJOURNEY BACKTESTER WORKFLOW
// ---------------------------------------------------------------------------

export interface QjModelParam {
  key: string;
  label: string;
  type: 'int' | 'float' | 'bool' | 'json' | string;
  default: any;
  min?: number;
  max?: number;
}

export interface QjModelDefinition {
  id: string;
  label: string;
  family: string;
  description: string;
  params: QjModelParam[];
}

export interface QjEngineCapabilities {
  engine: string;
  qjAvailable: boolean;
  tiAvailable: boolean;
  versions: {
    quantjourneyBt?: string | null;
    quantjourneyTi?: string | null;
    pandas?: string | null;
    numpy?: string | null;
    python?: string | null;
  };
  missing: string[];
  models: QjModelDefinition[];
  features: Record<string, boolean>;
  runsDir?: string;
  runCount?: number;
}

export interface QjEngineMeta {
  engine: string;
  version?: string | null;
  mode?: string;
  rebalanceEngine?: string;
  costSolver?: string;
  costModel?: string;
  policy?: string;
  periodsPerYear?: number;
}

export interface QjAnalytics {
  engine: QjEngineMeta;
  metrics: Record<string, any>;
  tradeStats?: Record<string, any>;
  rebalance?: { policy?: string; count?: number; stats?: Record<string, any> };
  contribution?: Record<string, {
    contributionPercent?: number;
    sharePercent?: number | null;
    averageWeightPercent?: number;
    exposureSharePercent?: number;
  }>;
  data?: {
    source?: string;
    symbols?: string[];
    bars?: number;
    start?: string;
    end?: string;
    intervalMinutes?: number;
    benchmark?: string;
  };
  strategy?: { model?: string; params?: Record<string, any>; diagnostics?: Record<string, any> };
  quality?: { warnings?: string[]; rating?: string; confidence?: string };
  assumptions?: Record<string, any>;
  optimization?: Record<string, any>;
}

export interface QjArtifact {
  name: string;
  bytes?: number;
  mediaType?: string;
  url: string;
}

export interface QjEnrichedBacktestResult extends BacktestResult {
  runId?: string;
  engine?: string;
  engineRequested?: string;
  symbols?: string[];
  analytics?: QjAnalytics;
  artifacts?: QjArtifact[];
  warnings?: string[];
  fallbackReason?: string | null;
  qjCapabilities?: QjEngineCapabilities;
}

export interface QjFoldResult {
  fold: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainBars?: number;
  testBars?: number;
  bestParams?: Record<string, any>;
  inSample?: Record<string, any>;
  outOfSample?: Record<string, any>;
  efficiency?: number | null;
  overfitRatio?: number | null;
  deflatedSharpe?: number | null;
  rankStabilityLogit?: number | null;
  stitchedNav?: number;
  status: string;
  error?: string;
}

export interface QjVerdict {
  name: string;
  value: number;
  signal: string;
  description: string;
}

export interface QjWalkForwardResult {
  runId: string;
  kind: 'walkforward';
  strategyName: string;
  assetPair: string;
  symbols: string[];
  periodLabel: string;
  geometry: {
    scheme: string;
    trainBars: number;
    testBars: number;
    stepBars: number;
    purgeBars: number;
    folds: number;
    gridSize: number;
  };
  folds: QjFoldResult[];
  summary: {
    nFolds: number;
    failedFolds: number;
    oosSharpe?: number | null;
    oosCagrPercent?: number | null;
    oosTotalReturnPercent?: number | null;
    oosMaxDrawdownPercent?: number | null;
    inSampleSharpe?: number;
    meanOosSharpe?: number;
    efficiency?: number | null;
    overfitRatio?: number | null;
    sharpeDecayPerFold?: number | null;
    consistencyPercent?: number;
    bestParams?: Record<string, any>;
    deflatedSharpe?: number | null;
    deflatedSharpeMethod?: string | null;
    deflatedSharpeReason?: string | null;
    rankStabilityFailureRate?: number | null;
    rankStabilityReason?: string | null;
    objective: string;
    warnings: string[];
    verdicts: QjVerdict[];
    elapsedSeconds?: number;
  };
  equityCurve: BacktestEquityPoint[];
  warnings: string[];
  artifacts: QjArtifact[];
}

export interface QjTrial {
  rank: number;
  params: Record<string, any>;
  score: number;
  sharpeRatio?: number | null;
  totalReturnPercent?: number | null;
  cagrPercent?: number | null;
  maxDrawdownPercent?: number | null;
  totalTrades?: number | null;
  profitFactor?: number | null;
  annualizedVolatilityPercent?: number | null;
}

export interface QjOptimizationResult {
  runId: string;
  kind: 'optimization';
  strategyName: string;
  assetPair: string;
  symbols: string[];
  periodLabel: string;
  summary: {
    objective: string;
    gridSize: number;
    completedTrials: number;
    failedTrials: number;
    bestParams: Record<string, any>;
    bestScore?: number | null;
    bestMetrics?: Record<string, any>;
    deflatedSharpe?: number | null;
    deflatedSharpeMethod?: string | null;
    deflatedSharpeReason?: string | null;
    baselineMetrics?: Record<string, any>;
    warnings: string[];
    elapsedSeconds?: number;
  };
  trials: QjTrial[];
  bestResult?: QjEnrichedBacktestResult | null;
  warnings: string[];
  artifacts: QjArtifact[];
}

export interface QjStressScenario {
  feeBps: number;
  slippageBps: number;
  totalBps: number;
  totalReturnPercent?: number | null;
  cagrPercent?: number | null;
  sharpeRatio?: number | null;
  maxDrawdownPercent?: number | null;
  totalCostsUSD?: number | null;
  totalTrades?: number | null;
  status: string;
  error?: string;
}

export interface QjStressResult {
  runId: string;
  kind: 'stress';
  strategyName: string;
  assetPair: string;
  symbols: string[];
  periodLabel: string;
  summary: {
    scenarios: number;
    breakevenBps?: number | null;
    zeroCostReturnPercent?: number | null;
    highestCostReturnPercent?: number | null;
    returnDecayPercent?: number | null;
    elapsedSeconds?: number;
  };
  scenarios: QjStressScenario[];
  warnings: string[];
  artifacts: QjArtifact[];
}

export interface QjRunSummary {
  runId: string;
  kind: string;
  createdAt: string;
  strategyName?: string;
  assetPair?: string;
  interval?: number;
  periodLabel?: string;
  engine?: string;
  metrics?: Record<string, any>;
  warnings?: string[];
  config?: Record<string, any> | null;
  artifactCount?: number;
}

// ---------------------------------------------------------------------------
// STRATEGY ARENA (multi-bot R-score replay)
// ---------------------------------------------------------------------------

export interface ArenaLadderStep {
  target: string;
  rMultiple: number;
  fraction: number;
  price: number | null;
  hit: boolean;
  time: string | null;
}

export interface ArenaTrade {
  id: string;
  symbol: string;
  side: string;
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;
  amount: number;
  totalValue?: number;
  fee?: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  reason?: string;
  holdingBars?: number;
  entryTs?: number | null;
  exitTs?: number | null;
  rMultiple: number;
  grossR?: number;
  feeR?: number;
  riskAmount?: number;
  exitReason?: string;
  ladder?: ArenaLadderStep[];
}

export interface ArenaSignalCheck {
  label: string;
  value: string;
  status: 'pass' | 'fail' | 'info' | string;
}

export interface ArenaBot {
  id: string;
  name: string;
  tagline: string;
  family: string;
  model: string;
  params: Record<string, any>;
  color: string;
  rule: string;
  rank: number;
  scoreR: number;
  avgR: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  profitFactorR: number | null;
  totalTrades: number;
  openTrades: number;
  totalReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  sharpeRatio: number | null;
  exposurePercent: number | null;
  equityCurve: Array<{ time: string; equity: number }>;
  trades: ArenaTrade[];
  lastTrade: ArenaTrade | null;
  openPosition: Record<string, any> | null;
  signal: {
    state: string;
    label: string;
    detail: string;
    checks: ArenaSignalCheck[];
    lastPrice: number | null;
    lastWeight: number | null;
  };
  status: string;
}

export interface ArenaResult {
  kind: 'arena';
  generatedAt: string;
  symbols: string[];
  assetPair: string;
  interval: number;
  periodLabel: string;
  totalCandles: number;
  source: string;
  engine: Record<string, any>;
  scoring: {
    metric: string;
    basis: string;
    riskPercent: number;
    ladder: number[];
    ladderSizing: string;
  };
  priceSeries: Array<{ timestamp: string; ts: number; time: string; price: number }>;
  bots: ArenaBot[];
  leaderboard: Array<Record<string, any>>;
  tradeTape: Array<Record<string, any>>;
  notes: Array<{ id: string; title: string; body: string }>;
  warnings: string[];
  assumptions: Record<string, any>;
  elapsedSeconds: number | null;
}
