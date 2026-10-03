import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../src/api/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('builds positions URLs with and without a status filter', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
    vi.stubGlobal('fetch', fetchMock);

    await api.positions();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/positions', undefined);

    await api.positions('OPEN');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/positions?status=OPEN', undefined);
  });

  it('sends risk settings via PUT with a JSON body and parses the result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ maxOpenPositions: 3, lossLimitPercent: 8, fixedTradeSizeUsd: 10 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.updateRiskSettings({ maxOpenPositions: 3 });
    expect(result.maxOpenPositions).toBe(3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/trading/risk/settings');
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ maxOpenPositions: 3 });
  });

  it('posts start/stop trading', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ running: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.startTrading();
    let call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('/api/trading/start');
    expect(call[1]?.method).toBe('POST');

    fetchMock.mockResolvedValue(jsonResponse({ running: false }));
    await api.stopTrading();
    call = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(call[0]).toBe('/api/trading/stop');
    expect(call[1]?.method).toBe('POST');
  });

  it('surfaces the server error message on non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'Insufficient funds' }, 400)),
    );
    await expect(api.stopTrading()).rejects.toThrow('Insufficient funds');
  });

  it('throws a generic error when the failure body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('oops', { status: 500 })),
    );
    await expect(api.summary()).rejects.toThrow(/request failed with status 500/);
  });

  it('propagates network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(api.summary()).rejects.toThrow('network down');
  });

  it('builds market data requests', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await api.ticker();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/market/ticker', undefined);

    await api.candles('1m', 300);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/market/candles?interval=1m&limit=300',
      undefined,
    );
  });

  it('posts simulated deposits with a JSON body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ deposit: { id: 1 }, account: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await api.simulateDeposit(250);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/deposits/simulate');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ amount: 250 });
  });

  it('posts withdrawals with confirmation flag', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ withdrawal: { id: 1, status: 'SIMULATED' } }));
    vi.stubGlobal('fetch', fetchMock);

    await api.createWithdrawal({
      amount: 50,
      destinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      confirmed: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/withdrawals');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      amount: 50,
      destinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      confirmed: true,
    });
  });

  it('fetches deposit info, deposits and withdrawals', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse([])));
    vi.stubGlobal('fetch', fetchMock);

    await api.depositsInfo();
    await api.deposits();
    await api.withdrawals();
    await api.riskEvents(10);
    await api.account();

    const urls = fetchMock.mock.calls.map((call) => (call as [string])[0]);
    expect(urls).toEqual([
      '/api/deposits/info',
      '/api/deposits',
      '/api/withdrawals',
      '/api/risk-events?limit=10',
      '/api/account',
    ]);
  });

  it('builds AI binary requests', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await api.aiBinaryStatus();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/binary-ai/status', undefined);

    await api.aiBinarySettings({ mode: 'AUTO_EXECUTE', stakeUsd: 10 });
    let call = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(call[0]).toBe('/api/binary-ai/settings');
    expect(call[1]?.method).toBe('PUT');
    expect(JSON.parse(call[1]?.body as string)).toEqual({ mode: 'AUTO_EXECUTE', stakeUsd: 10 });

    await api.aiBinaryStart();
    call = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(call[0]).toBe('/api/binary-ai/start');
    expect(call[1]?.method).toBe('POST');

    await api.aiBinaryStop();
    call = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(call[0]).toBe('/api/binary-ai/stop');

    await api.aiBinaryDecisions(25);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/binary-ai/decisions?limit=25', undefined);

    await api.ticks(60);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/market/ticks?limit=60', undefined);
  });

  it('builds binary requests and posts contracts', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await api.binaryConfig();
    await api.binaryQuote(10, 5, 0.8);
    await api.binaryOpen();
    await api.binaryHistory(10);
    await api.binarySummary();
    await api.serverTime();

    await api.openBinary({
      asset: 'BTC/USDT',
      direction: 'UP',
      stakeUsd: 10,
      durationSeconds: 5,
      payoutRatio: 0.8,
    });

    const urls = fetchMock.mock.calls.slice(0, 6).map((call) => (call as [string])[0]);
    expect(urls).toEqual([
      '/api/binary/config',
      '/api/binary/quote?stake=10&duration=5&payoutRatio=0.8',
      '/api/binary/open',
      '/api/binary/history?limit=10',
      '/api/binary/summary',
      '/api/server-time',
    ]);

    const openCall = fetchMock.mock.calls[6] as [string, RequestInit];
    expect(openCall[0]).toBe('/api/binary/open');
    expect(openCall[1]?.method).toBe('POST');
    expect(JSON.parse(openCall[1]?.body as string)).toEqual({
      asset: 'BTC/USDT',
      direction: 'UP',
      stakeUsd: 10,
      durationSeconds: 5,
      payoutRatio: 0.8,
    });
  });

  it('builds Phase 6.4 requests (options, Tron, wallet records)', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await api.optionsConfig();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/options/config', undefined);

    await api.openOption({ asset: 'BTC/USDT', side: 'CALL', stakeUsd: 25, durationSeconds: 60 });
    let call = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(call[0]).toBe('/api/options/open');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1]?.body as string)).toEqual({
      asset: 'BTC/USDT',
      side: 'CALL',
      stakeUsd: 25,
      durationSeconds: 60,
    });

    await api.tronStatus();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/tron/status', undefined);

    await api.tronHealth();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/tron/health', undefined);

    await api.tronFeeEstimate(10, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/tron/fee-estimate?amount=10&destination=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      undefined,
    );

    await api.walletRecords('WITHDRAWAL', 50, 10);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/wallet/records?type=WITHDRAWAL&limit=50&offset=10',
      undefined,
    );

    await api.walletRecord('wd-7');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/wallet/records/wd-7', undefined);
  });

  it('builds Phase 6.5 requests (binary session gain + TRX fee wallet)', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);

    await api.binarySessionStats();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/binary/session-stats', undefined);

    await api.binarySessionSettings({ gainLimitEnabled: false, maxSessionGainUsdt: 75 });
    let call = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(call[0]).toBe('/api/binary/session-settings');
    expect(call[1]?.method).toBe('PUT');
    expect(JSON.parse(call[1]?.body as string)).toEqual({
      gainLimitEnabled: false,
      maxSessionGainUsdt: 75,
    });

    await api.binarySessionReset();
    call = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(call[0]).toBe('/api/binary/session-reset');
    expect(call[1]?.method).toBe('POST');

    await api.tronFeeDepositInfo();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/tron/fee-deposit-info', undefined);

    await api.tronFeeStatus();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/tron/fee-status', undefined);

    await api.tronFeeDeposits();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/tron/fee-deposits', undefined);

    await api.simulateTrxDeposit(120);
    call = fetchMock.mock.calls[6] as [string, RequestInit];
    expect(call[0]).toBe('/api/tron/simulate-trx-deposit');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1]?.body as string)).toEqual({ amountTrx: 120 });
  });
});
