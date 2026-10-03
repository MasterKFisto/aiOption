import { randomUUID } from 'node:crypto';

import { roundMoney } from '@aioption/shared';
import type {
  CancelOrderResult,
  ExecutionAdapter,
  ExternalPosition,
  OrderResult,
  OrderSide,
  PlaceOrderParams,
} from '@aioption/shared';

/** Provides the current market price for a symbol. */
export interface MarketPriceProvider {
  getPrice(symbol: string): Promise<number>;
}

/** Simple in-memory price source for paper trading. */
export class StaticPriceProvider implements MarketPriceProvider {
  private readonly prices = new Map<string, number>();

  constructor(initial: Record<string, number> = {}) {
    for (const [symbol, price] of Object.entries(initial)) {
      this.prices.set(symbol, price);
    }
  }

  setPrice(symbol: string, price: number): void {
    this.prices.set(symbol, price);
  }

  async getPrice(symbol: string): Promise<number> {
    const price = this.prices.get(symbol);
    if (price === undefined) {
      throw new Error(`No paper market price configured for ${symbol}`);
    }
    return price;
  }
}

/** Default taker fee: 0.1% per side. */
const DEFAULT_FEE_RATE = 0.001;

/**
 * Paper venue adapter: orders fill instantly at the current market price (or
 * the limit price when provided), charge a 0.1% fee, and track a simple
 * in-memory open book.
 */
export class PaperExecutionAdapter implements ExecutionAdapter {
  private readonly openBook = new Map<string, ExternalPosition>();
  private readonly feeRate: number;
  private readonly feeCurrency: string;

  constructor(
    private readonly priceProvider: MarketPriceProvider,
    options: { feeRate?: number; feeCurrency?: string } = {},
  ) {
    this.feeRate = options.feeRate ?? DEFAULT_FEE_RATE;
    this.feeCurrency = options.feeCurrency ?? 'USDT';
  }

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const filledAt = new Date().toISOString();

    if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
      return this.rejected(params, 'quantity must be a positive number', filledAt);
    }

    const price = params.price ?? (await this.priceProvider.getPrice(params.symbol));
    if (!Number.isFinite(price) || price <= 0) {
      return this.rejected(params, `no valid market price for ${params.symbol}`, filledAt);
    }

    const applied = this.applyToBook(params.symbol, params.side, params.quantity, price);
    if (!applied) {
      return this.rejected(params, `could not apply ${params.side} ${params.quantity} of ${params.symbol}`, filledAt);
    }

    const fee = roundMoney(params.quantity * price * this.feeRate);
    return {
      orderId: `paper-${randomUUID()}`,
      status: 'FILLED',
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      filledQuantity: params.quantity,
      averagePrice: price,
      fee,
      feeCurrency: this.feeCurrency,
      filledAt,
    };
  }

  async cancelOrder(orderId: string): Promise<CancelOrderResult> {
    // Paper orders fill instantly, so there is never anything to cancel.
    return { orderId, status: 'NOT_FOUND', message: 'paper orders fill instantly and cannot be cancelled' };
  }

  async getOpenPositions(): Promise<ExternalPosition[]> {
    return [...this.openBook.values()];
  }

  private rejected(params: PlaceOrderParams, message: string, filledAt: string): OrderResult {
    return {
      orderId: `paper-${randomUUID()}`,
      status: 'REJECTED',
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      filledQuantity: 0,
      averagePrice: 0,
      fee: 0,
      feeCurrency: this.feeCurrency,
      message,
      filledAt,
    };
  }

  /**
   * Applies a fill to the in-memory book with venue netting semantics: the
   * order first reduces the opposite side (closing), and any remainder opens
   * a new position on its own side.
   */
  private applyToBook(symbol: string, side: OrderSide, quantity: number, price: number): boolean {
    const opposite: OrderSide = side === 'BUY' ? 'SELL' : 'BUY';
    let remaining = quantity;

    const oppositeKey = `${symbol}:${opposite}`;
    const oppositePosition = this.openBook.get(oppositeKey);
    if (oppositePosition) {
      // Tolerance-aware comparison: fully consumed when the remaining order
      // size covers the opposite book.
      if (oppositePosition.quantity - remaining <= 1e-9) {
        this.openBook.delete(oppositeKey);
        remaining -= oppositePosition.quantity;
      } else {
        this.openBook.set(oppositeKey, {
          ...oppositePosition,
          quantity: oppositePosition.quantity - remaining,
        });
        remaining = 0;
      }
    }

    if (remaining > 1e-9) {
      this.add(symbol, side, remaining, price);
    }
    return true;
  }

  /** Adds quantity to the given side's book, re-computing the average price. */
  private add(symbol: string, side: OrderSide, quantity: number, price: number): void {
    const key = `${symbol}:${side}`;
    const existing = this.openBook.get(key);
    if (!existing) {
      this.openBook.set(key, { symbol, side, quantity, averagePrice: price });
    } else {
      const totalQuantity = existing.quantity + quantity;
      const averagePrice =
        (existing.averagePrice * existing.quantity + price * quantity) / totalQuantity;
      this.openBook.set(key, { symbol, side, quantity: totalQuantity, averagePrice });
    }
  }
}
