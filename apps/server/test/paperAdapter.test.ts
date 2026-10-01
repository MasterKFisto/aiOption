import { describe, expect, it } from 'vitest';

import { PaperExecutionAdapter, StaticPriceProvider } from '../src/execution/paperAdapter.js';

const makeAdapter = (prices: Record<string, number>, options?: { feeRate?: number; feeCurrency?: string }) =>
  new PaperExecutionAdapter(new StaticPriceProvider(prices), options);

describe('PaperExecutionAdapter', () => {
  it('fills instantly at the market price and charges a 0.1% fee', async () => {
    const adapter = makeAdapter({ 'BTC-30OCT26-67000-C': 200 });
    const result = await adapter.placeOrder({
      symbol: 'BTC-30OCT26-67000-C',
      side: 'BUY',
      quantity: 2,
    });
    expect(result.status).toBe('FILLED');
    expect(result.filledQuantity).toBe(2);
    expect(result.averagePrice).toBe(200);
    expect(result.fee).toBeCloseTo(0.4, 6);
    expect(result.feeCurrency).toBe('USDC');
    expect(result.orderId).toMatch(/^paper-/);
  });

  it('honors a limit price when provided and supports custom fee currency', async () => {
    const adapter = makeAdapter({ 'ETH-30OCT26-3000-C': 50 }, { feeCurrency: 'USDT' });
    const result = await adapter.placeOrder({
      symbol: 'ETH-30OCT26-3000-C',
      side: 'BUY',
      quantity: 4,
      price: 55,
    });
    expect(result.averagePrice).toBe(55);
    expect(result.fee).toBeCloseTo(0.22, 6); // 4 * 55 * 0.001
    expect(result.feeCurrency).toBe('USDT');
  });

  it('tracks a weighted average price across buys', async () => {
    const adapter = makeAdapter({ 'BTC-30OCT26-67000-C': 200 });
    await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: 2 });
    await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: 3, price: 210 });
    const book = await adapter.getOpenPositions();
    expect(book).toEqual([{ symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: 5, averagePrice: 206 }]);
  });

  it('SELL closes longs first, opening a short only with the remainder', async () => {
    const adapter = makeAdapter({ 'BTC-30OCT26-67000-C': 200 });
    await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: 5 });
    const close = await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'SELL', quantity: 5 });
    expect(close.status).toBe('FILLED');
    expect(await adapter.getOpenPositions()).toEqual([]);

    await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'SELL', quantity: 2 });
    expect(await adapter.getOpenPositions()).toEqual([
      { symbol: 'BTC-30OCT26-67000-C', side: 'SELL', quantity: 2, averagePrice: 200 },
    ]);
  });

  it('BUY closes shorts, remainder opens a long', async () => {
    const adapter = makeAdapter({ 'BTC-30OCT26-67000-C': 200 });
    await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'SELL', quantity: 3 });
    const result = await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: 5 });
    expect(result.status).toBe('FILLED');
    expect(await adapter.getOpenPositions()).toEqual([
      { symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: 2, averagePrice: 200 },
    ]);
  });

  it('rejects non-positive quantities', async () => {
    const adapter = makeAdapter({ 'BTC-30OCT26-67000-C': 200 });
    const zero = await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: 0 });
    expect(zero.status).toBe('REJECTED');
    expect(zero.filledQuantity).toBe(0);
    const negative = await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: -1 });
    expect(negative.status).toBe('REJECTED');
  });

  it('rejects a zero limit price', async () => {
    const adapter = makeAdapter({ 'BTC-30OCT26-67000-C': 200 });
    const result = await adapter.placeOrder({ symbol: 'BTC-30OCT26-67000-C', side: 'BUY', quantity: 1, price: 0 });
    expect(result.status).toBe('REJECTED');
    expect(result.fee).toBe(0);
  });

  it('throws when no price is available for the symbol', async () => {
    const adapter = makeAdapter({});
    await expect(
      adapter.placeOrder({ symbol: 'UNKNOWN-SYMBOL', side: 'BUY', quantity: 1 }),
    ).rejects.toThrow(/No paper market price/);
  });

  it('never has cancellable orders (fills are instant)', async () => {
    const adapter = makeAdapter({ 'BTC-30OCT26-67000-C': 200 });
    const result = await adapter.cancelOrder('paper-abc');
    expect(result.status).toBe('NOT_FOUND');
    expect(result.message).toMatch(/cannot be cancelled/);
  });
});
