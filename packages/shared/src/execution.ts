/**
 * Venue-level execution types shared by the trading engine and every exchange
 * adapter (paper, testnet, live).
 */

/** Venue-level order side: BUY opens/increases a position, SELL closes/reduces it. */
export type OrderSide = 'BUY' | 'SELL';

export type OrderType = 'MARKET' | 'LIMIT';

/** Final state of an order after submission. */
export type OrderStatus = 'FILLED' | 'REJECTED';

export type CancelStatus = 'CANCELLED' | 'NOT_FOUND';

export interface PlaceOrderParams {
  /** Venue instrument id, e.g. 'BTC-30OCT26-67000-C'. */
  symbol: string;
  side: OrderSide;
  /** Number of contracts (can be fractional). */
  quantity: number;
  /** Limit price; if omitted the venue fills at the current market price. */
  price?: number;
  orderType?: OrderType;
}

export interface OrderResult {
  orderId: string;
  status: OrderStatus;
  symbol: string;
  side: OrderSide;
  /** Quantity requested. */
  quantity: number;
  /** Quantity actually filled (0 when REJECTED). */
  filledQuantity: number;
  /** Volume-weighted average fill price per contract. */
  averagePrice: number;
  /** Total fee charged, in `feeCurrency`. */
  fee: number;
  feeCurrency: string;
  /** Human-readable reason when status is REJECTED. */
  message?: string;
  filledAt: string;
}

export interface CancelOrderResult {
  orderId: string;
  status: CancelStatus;
  message?: string;
}

/** A venue-reported open position (external view of the book). */
export interface ExternalPosition {
  symbol: string;
  side: OrderSide;
  quantity: number;
  averagePrice: number;
}

/**
 * Venue abstraction: every exchange adapter (paper, testnet, live) implements
 * this interface so the trading engine stays venue-agnostic.
 */
export interface ExecutionAdapter {
  placeOrder(params: PlaceOrderParams): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<CancelOrderResult>;
  getOpenPositions(): Promise<ExternalPosition[]>;
}
