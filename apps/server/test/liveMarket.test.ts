import type { Candle } from '@aioption/shared';
import { describe, expect, it } from 'vitest';

import { LiveMarketDataService } from '../src/market/liveMarketDataService.js';
import type { MarketDataSource } from '../src/market/liveMarketDataService.js';

class StubSource implements MarketDataSource {
  statsCalls: string[] = [];
  candleCalls: Array<{ symbol: string; granularity: number; limit: number }> = [];
  failSymbols = new Set<string>();

  async fetchStats(symbol: string) {
    this.statsCalls.push(symbol);
    if (this.failSymbols.has(symbol)) {
      throw new Error(`stats unavailable for ${symbol}`);
    }
    return { last: 67000, open: 65000, high: 68000, low: 64000, volume: 1234 };
  }

  async fetchCandles(symbol: string, granularity: number, limit: number): Promise<Candle[]> {
    this.candleCalls.push({ symbol, granularity, limit });
    return [{ timestamp: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }];
  }
}

function makeService(source: StubSource): LiveMarketDataService {
  return new LiveMarketDataService(source, {
    symbol: 'BTC/USDT',
    fallbackSymbol: 'BTC/USD',
    pollIntervalMs: 3000,
  });
}

describe('LiveMarketDataService', () => {
  it('polls the primary symbol and reports connected with 24h stats', async () => {
    const source = new StubSource();
    const service = makeService(source);
    await service.refresh();

    expect(service.getStatus()).toBe('connected');
    const ticker = service.getTicker();
    expect(ticker?.symbol).toBe('BTC/USDT');
    expect(ticker?.usingFallback).toBe(false);
    expect(ticker?.lastPrice).toBe(67000);
    expect(ticker?.priceChangePercent24h).toBeCloseTo((2000 / 65000) * 100, 6);
    expect(ticker?.source).toBe('COINBASE');
    expect(ticker?.lastUpdatedAt).toBeTruthy();
    expect(source.statsCalls).toEqual(['BTC/USDT']);
  });

  it('falls back to the fallback symbol when the primary is unavailable', async () => {
    const source = new StubSource();
    source.failSymbols.add('BTC/USDT');
    const service = makeService(source);
    await service.refresh();

    expect(service.getStatus()).toBe('connected');
    const ticker = service.getTicker();
    expect(ticker?.symbol).toBe('BTC/USD');
    expect(ticker?.requestedSymbol).toBe('BTC/USDT');
    expect(ticker?.usingFallback).toBe(true);
  });

  it('reports error when both symbols fail and keeps the last good ticker', async () => {
    const source = new StubSource();
    const service = makeService(source);
    await service.refresh();
    const good = service.getTicker();

    source.failSymbols.add('BTC/USDT');
    source.failSymbols.add('BTC/USD');
    await service.refresh();

    expect(service.getStatus()).toBe('error');
    expect(service.getTicker()).toEqual(good); // stale data preserved for the UI
  });

  it('fetches candles with the correct granularity per interval', async () => {
    const source = new StubSource();
    const service = makeService(source);
    await service.refresh(); // active symbol = BTC/USDT

    await service.getCandles('1m', 100);
    await service.getCandles('5m', 50);
    await service.getCandles('1h', 10);

    expect(source.candleCalls).toEqual([
      { symbol: 'BTC/USDT', granularity: 60, limit: 100 },
      { symbol: 'BTC/USDT', granularity: 300, limit: 50 },
      { symbol: 'BTC/USDT', granularity: 3600, limit: 10 },
    ]);
  });

  it('stop() marks the feed as disconnected', () => {
    const service = makeService(new StubSource());
    service.start();
    service.stop();
    expect(service.getStatus()).toBe('disconnected');
  });

  it('keeps a rolling tick buffer for binary entry/settlement', async () => {
    const source = new StubSource();
    const service = makeService(source);
    await service.refresh();
    await service.refresh();

    const latest = service.getLatestTick();
    expect(latest?.price).toBe(67000);
    expect(latest?.source).toBe('COINBASE');
    expect(latest?.timestamp).toBeTruthy();
    expect(service.getTickAtOrAfter(latest!.timestamp)?.price).toBe(latest?.price);
    // Older ticks are not returned by getTickAtOrAfter.
    expect(service.getTickAtOrAfter(new Date(Date.now() + 60_000).toISOString())).toBeNull();
    service.stop();
  });
});
