import { roundMoney } from '@aioption/shared';
import type { AiDecision, OptionSide, OrderResult, PlaceOrderParams, Ticker } from '@aioption/shared';

import { createPosition, getAccount, markAiDecisionExecuted } from '../db/repositories.js';
import { PaperExecutionAdapter, StaticPriceProvider } from '../execution/paperAdapter.js';
import { logger } from '../logger.js';
import { SimulatedMarketDataService } from '../market/marketDataService.js';
import { RiskEngine } from '../risk/riskEngine.js';
import type { MarketDataProvider } from '../strategy/signalEngine.js';
import { SignalEngine } from '../strategy/signalEngine.js';
import { WalletService } from '../services/walletService.js';

export interface TradingLoopOptions {
  intervalMs?: number;
  market?: MarketDataProvider;
  engine?: SignalEngine;
  risk?: RiskEngine;
  adapter?: PaperExecutionAdapter;
  wallet?: WalletService;
}

export interface LoopExecution {
  symbol: string;
  decisionId: number;
  order: OrderResult;
  positionId: number;
}

export interface LoopRunResult {
  symbols: string[];
  executed: LoopExecution[];
  skipped: Array<{ symbol: string; reason: string }>;
  /** True when the loss limit fired and trading was halted during this run. */
  halted: boolean;
}

const DEFAULT_INTERVAL_MS = 60_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Converts a ticker symbol + decision into a concrete paper option order. */
function buildOptionOrderPlan(
  tickerSymbol: string,
  decision: AiDecision,
  market: MarketDataProvider,
): { params: PlaceOrderParams; strikePrice: number; expiry: string } {
  const ticker: Ticker = market.getTicker(tickerSymbol);
  const base = tickerSymbol.split('/')[0] ?? tickerSymbol;
  // Next-week ATM option: 7 days out, strike rounded to the asset step.
  const expiry = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString().slice(0, 10);
  const strikeStep = base === 'BTC' ? 1000 : 100;
  const strikePrice = Math.round(ticker.lastPrice / strikeStep) * strikeStep;
  const optionType = decision.action === 'OPEN_CALL' ? 'C' : 'P';
  const instrument = `${base}-${expiry}-${strikePrice}-${optionType}`;
  // MVP premium model: ~3% of spot. Quantity scales the fixed trade size.
  const premium = roundMoney(ticker.lastPrice * 0.03, 2);
  const quantity = round4(decision.proposedTradeSizeUsd / premium);

  return {
    params: { symbol: instrument, side: 'BUY', quantity, price: premium, orderType: 'LIMIT' },
    strikePrice,
    expiry,
  };
}

/**
 * The main scheduler: every `intervalMs` (default 1 minute) it fetches market
 * data, generates an AI signal per symbol, runs it through the risk engine,
 * executes approved trades via the paper adapter, and updates the wallet and
 * positions.
 */
export class TradingLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly intervalMs: number;
  private readonly market: MarketDataProvider;
  private readonly engine: SignalEngine;
  private readonly risk: RiskEngine;
  private readonly adapter: PaperExecutionAdapter;
  private readonly wallet: WalletService;

  constructor(options: TradingLoopOptions = {}) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.market = options.market ?? new SimulatedMarketDataService();
    this.wallet = options.wallet ?? new WalletService();
    this.engine = options.engine ?? new SignalEngine(this.market);
    this.risk = options.risk ?? new RiskEngine(this.wallet);
    this.adapter = options.adapter ?? new PaperExecutionAdapter(new StaticPriceProvider());
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Starts the scheduler (does not run immediately — first tick after intervalMs). */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    logger.info({ intervalMs: this.intervalMs }, 'trading loop started');
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('trading loop stopped');
  }

  /** One scheduler tick. Exposed for tests and manual runs. */
  async runOnce(): Promise<LoopRunResult> {
    const result: LoopRunResult = {
      symbols: this.market.getSymbols(),
      executed: [],
      skipped: [],
      halted: false,
    };

    try {
      // 1. Loss-limit gate (also disables trading + closes positions on trigger).
      if (this.risk.checkLossLimit().triggered) {
        result.halted = true;
        this.stop();
        return result;
      }

      // 2. Requirement: only trade while trading_enabled is true in the DB.
      const account = getAccount();
      if (!account.tradingEnabled) {
        return result;
      }

      // 3. Signal -> risk -> execute per symbol.
      for (const symbol of result.symbols) {
        const decision = this.engine.evaluate(symbol);
        const verdict = this.risk.evaluate(decision);
        if (!verdict.approved) {
          result.skipped.push({ symbol, reason: verdict.reason ?? 'rejected by risk engine' });
          logger.info({ symbol, reason: verdict.reason }, 'trade skipped');
          continue;
        }

        try {
          const plan = buildOptionOrderPlan(symbol, decision, this.market);
          const order = await this.adapter.placeOrder(plan.params);
          if (order.status !== 'FILLED') {
            result.skipped.push({ symbol, reason: order.message ?? 'order not filled' });
            continue;
          }

          const costUsd = roundMoney(order.filledQuantity * order.averagePrice + order.fee);
          this.wallet.lockFunds(costUsd, `funds locked for ${order.symbol}`);
          const side: OptionSide = decision.action === 'OPEN_CALL' ? 'CALL' : 'PUT';
          const position = createPosition({
            symbol: order.symbol,
            side,
            strikePrice: plan.strikePrice,
            expiry: plan.expiry,
            quantity: order.filledQuantity,
            entryPremium: order.averagePrice,
            openedAt: order.filledAt,
          });
          markAiDecisionExecuted(decision.id, position.id);

          result.executed.push({
            symbol,
            decisionId: decision.id,
            order,
            positionId: position.id,
          });
          logger.info({ symbol, positionId: position.id, orderId: order.orderId }, 'trade executed');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.skipped.push({ symbol, reason: message });
          logger.error({ symbol, err }, 'execution failed');
        }
      }
    } catch (err) {
      logger.error({ err }, 'trading loop tick failed');
    }

    return result;
  }
}

// The singleton used by the Fastify app and the trading routes.
export const tradingLoop = new TradingLoop();
