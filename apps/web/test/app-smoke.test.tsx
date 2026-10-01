// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import App from '../src/App';

/* Browser APIs missing from jsdom — lightweight-charts/antd need them. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class EventSourceStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
}

function stubFetch(): void {
  const responses: Record<string, unknown> = {
    '/api/account/summary': {
      account: {
        id: 1,
        mode: 'PAPER',
        equity: 1000,
        cashBalance: 800,
        lockedBalance: 200,
        baseCurrency: 'USDC',
        fixedTradeSizeUsd: 10,
        maxOpenPositions: 5,
        lossLimitPercent: 5,
        tradingEnabled: false,
        startingEquity: 1000,
        postTradePromptEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      realizedPnl: 0,
      unrealizedPnl: 0,
      loopRunning: false,
      dailyLossLimitPercent: 40,
      dailyLossRemainingUsd: 600,
      lossLimitFloorUsd: 600,
      binarySessionGainUsd: 0,
      binarySessionGainLimitUsd: 50,
      binarySessionGainRemainingUsd: 50,
      binarySessionGainLimitReached: false,
      aiBinarySessionProfitUsd: 0,
    },
    '/api/binary/session-stats': {
      sessionStartedAt: new Date().toISOString(),
      manualNetGain: 0,
      aiNetGain: 0,
      combinedNetGain: 0,
      wins: 0,
      losses: 0,
      refunds: 0,
      gainLimitEnabled: true,
      maxSessionGainUsdc: 50,
      maxSessionGainPercent: 0,
      remainingSessionGain: 50,
      gainLimitReached: false,
      gainLimitReason: null,
    },
    '/api/tron/fee-deposit-info': {
      feeWalletAddress: 'TSimulatedFeeWalletAddressTRX0000000001',
      sameAddressAsDeposit: false,
      asset: 'TRX',
      network: 'TRON',
      purpose: 'network fee reserve',
      acceptTrxDeposits: true,
      requiredConfirmations: 20,
      warning: 'TRX deposits are used only for Tron network fees. They are not credited as USDC trading balance.',
    },
    '/api/tron/fee-status': {
      feeWalletAddress: 'TSimulatedFeeWalletAddressTRX0000000001',
      trxBalance: 120,
      energyAvailable: 100000,
      bandwidthAvailable: 5000,
      minTrxFeeReserve: 50,
      sufficientFeeReserve: true,
      estimatedWithdrawalsSupported: 4,
      lastCheckedAt: new Date().toISOString(),
      warnings: [],
    },
    '/api/tron/fee-deposits': [
      {
        id: 1,
        network: 'TRON',
        asset: 'TRX',
        amountTrx: 120,
        fromAddress: 'TSimulatedSenderAddress000000000000',
        txid: 'sim-trx-1',
        status: 'CREDITED',
        confirmations: 999,
        createdAt: new Date().toISOString(),
        creditedAt: new Date().toISOString(),
        notes: 'simulated TRX fee deposit',
      },
    ],
    '/api/market/ticker': {
      status: 'connected',
      ticker: {
        status: 'connected',
        source: 'COINBASE',
        symbol: 'BTC/USDT',
        requestedSymbol: 'BTC/USDC',
        usingFallback: true,
        lastPrice: 67000,
        priceChange24h: 1000,
        priceChangePercent24h: 1.5,
        high24h: 68000,
        low24h: 66000,
        volume24h: 100,
        lastUpdatedAt: new Date().toISOString(),
      },
    },
    '/api/market/candles?interval=1m&limit=300': {
      symbol: 'BTC/USDT',
      interval: '1m',
      source: 'COINBASE',
      candles: [
        { timestamp: Date.now() - 60000, open: 66000, high: 66100, low: 65900, close: 66050, volume: 1 },
        { timestamp: Date.now(), open: 66050, high: 66200, low: 66000, close: 66100, volume: 1 },
      ],
    },
    '/api/positions?status=OPEN': [],
    '/api/ai/decisions?limit=5': [],
    '/api/risk-events?limit=5': [],
    '/api/withdrawals': [],
    '/api/deposits': [],
    '/api/deposits/info': {
      address: 'TSimulatedAiOptionDepositAddressUSDC1',
      network: 'TRON',
      asset: 'USDC',
      tokenStandard: 'TRC20',
      tronMode: 'SIMULATED',
      liveWithdrawalsEnabled: false,
      requiredConfirmations: 12,
      lastSyncedAt: null,
    },
    '/api/binary/config': {
      enabled: true,
      liveTradingEnabled: false,
      allowedDurationsSeconds: [5, 10],
      allowedPayoutRatios: [0.5, 0.6, 0.7, 0.8, 0.9],
      minStakeUsd: 1,
      maxStakeUsd: 50,
      defaultStakeUsd: 10,
      maxOpenContracts: 3,
      maxPriceStaleMs: 3000,
      settlementSource: 'INTERNAL_MARKET_FEED',
    },
    '/api/binary/open': [],
    '/api/binary/history?limit=10': [],
    '/api/binary/history?limit=20': [],
    '/api/binary/history?limit=100': [],
    '/api/binary/summary': { wins: 0, losses: 0, refunds: 0, netPnlUsd: 0, openCount: 0 },
    '/api/market/ticks?limit=120': {
      symbol: 'BTC/USDT',
      ticks: [
        { price: 66990, timestamp: new Date(Date.now() - 2000).toISOString(), source: 'COINBASE' },
        { price: 67000, timestamp: new Date(Date.now() - 1000).toISOString(), source: 'COINBASE' },
        { price: 67005, timestamp: new Date().toISOString(), source: 'COINBASE' },
      ],
    },
    '/api/binary-ai/status': {
      enabled: true,
      mode: 'SIGNAL_ONLY',
      running: false,
      currentSignal: 'UP',
      confidence: 0.72,
      reason: 'momentum +0.04% over 5s',
      stakeUsd: 10,
      durationSeconds: 10,
      payoutRatio: 0.8,
      lastSignalAt: new Date().toISOString(),
      lastTradeAt: null,
      openContracts: 0,
      sessionStats: {
        totalSignals: 5,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        refunds: 0,
        netPnl: 0,
        consecutiveLosses: 0,
        sessionLossUsd: 0,
      },
      warnings: [],
    },
    '/api/binary-ai/decisions?limit=40': [],
    '/api/binary-ai/decisions?limit=50': [],
    '/api/options/config': {
      minStakeUsd: 1,
      maxStakeUsd: 100,
      defaultStakeUsd: 10,
      allowedDurationsSeconds: [60, 180, 300, 600],
      defaultDurationSeconds: 300,
      maxDurationSeconds: 600,
    },
    '/api/tron/status': {
      mode: 'SIMULATED',
      networkName: 'Simulated',
      connectionStatus: 'CONNECTED',
      readyToTrade: true,
      readiness: 'READY_TO_TRADE',
      depositsEnabled: true,
      withdrawalsEnabled: true,
      liveWithdrawalsEnabled: false,
      depositAddress: 'TSimulatedAiOptionDepositAddressUSDC1',
      hotWalletAddress: '',
      usdcContractAddress: '',
      requiredConfirmations: 12,
      trxBalance: 120,
      energyAvailable: 100000,
      bandwidthAvailable: 5000,
      lowFeeResource: false,
      lastCheckedAt: null,
      warnings: ['simulated Tron mode — no real chain interaction'],
    },
    '/api/wallet/records?type=ALL&limit=100&offset=0': {
      records: [
        {
          id: 'tx-1',
          kind: 'TRADE',
          time: new Date().toISOString(),
          type: 'OPTION_STAKE_LOCKED',
          amount: -10,
          asset: 'USDC',
          network: null,
          status: 'RECORDED',
          reference: null,
          txid: null,
          destinationAddress: null,
          depositAddress: null,
          feeEstimateTrx: null,
          feeEstimateUsd: null,
          feePaidBy: null,
          notes: 'classic option CALL 60s stake locked',
          explorerUrl: null,
        },
        {
          id: 'wd-1',
          kind: 'WITHDRAWAL',
          time: new Date().toISOString(),
          type: 'WITHDRAWAL',
          amount: -50,
          asset: 'USDC',
          network: 'TRON',
          status: 'SIMULATED',
          reference: 'sim-1',
          txid: 'sim-1',
          destinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          depositAddress: null,
          feeEstimateTrx: 30,
          feeEstimateUsd: 3.6,
          feePaidBy: 'HOT_WALLET',
          notes: 'simulated withdrawal',
          explorerUrl: null,
        },
      ],
      summary: {
        availableBalance: 800,
        lockedBalance: 200,
        totalEquity: 1000,
        pendingWithdrawals: 0,
        pendingDeposits: 0,
        hotWalletTrxBalance: 120,
        feeResourcesSufficient: true,
      },
    },
    '/api/server-time': { serverTime: new Date().toISOString(), epochMs: Date.now() },
  };

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const body = responses[url];
      if (body === undefined) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
}

describe('App smoke test (blank-screen regression guard)', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('EventSource', EventSourceStub);
    // lightweight-charts schedules animation frames; in jsdom they would fire
    // during teardown against a destroyed canvas. No-op them for the smoke test.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    stubFetch();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    // Unmount the app (incl. the price chart) so pending animation frames
    // and query timers are cancelled before jsdom tears down.
    cleanup();
  });

  it('renders the dashboard without crashing', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );

    // Navigation and wallet actions must be visible.
    expect(screen.getByText('Classic Options')).toBeTruthy();
    expect(screen.getByText('Binary Options')).toBeTruthy();
    expect(screen.getByText('Positions')).toBeTruthy();
    expect(screen.getByText('AI Decisions')).toBeTruthy();
    expect(screen.getByText('Wallet Records')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Deposit')).toBeTruthy();
    expect(screen.getByText('Withdraw')).toBeTruthy();

    // Account + market panels render with data.
    await waitFor(() => {
      expect(screen.getByText('Total equity')).toBeTruthy();
      expect(screen.getByText('Available balance')).toBeTruthy();
      expect(screen.getByText('Live market — BTC/USDT')).toBeTruthy();
    });

    // The classic ticket and the Tron indicator (bottom of the left menu).
    await waitFor(() => {
      expect(screen.getByText('Classic Raise')).toBeTruthy();
      expect(screen.getByText('Simulated')).toBeTruthy();
    });
  });

  it('renders the Binary Options page without crashing', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText('Binary Options'));

    await waitFor(() => {
      // Risk warning, ticket and open-contract panel must render.
      expect(screen.getByText('Binary Raise')).toBeTruthy();
      expect(screen.getByText('Open binary contracts (0)')).toBeTruthy();
      expect(screen.getByText('Binary performance')).toBeTruthy();
      // The risk warning appears in both the page banner and the ticket.
      expect(screen.getAllByText(/extremely high risk/).length).toBeGreaterThan(0);
      expect(screen.getByText(/Not investment advice/)).toBeTruthy();
    });

    // AI auto trading panel, chart and decision history are part of the page.
    await waitFor(() => {
      expect(screen.getByText('AI Auto Trading')).toBeTruthy();
      expect(screen.getByText('AI decision history')).toBeTruthy();
      // Save settings appears in both the AI panel and the gain-limit panel.
      expect(screen.getAllByText('Save settings').length).toBeGreaterThan(0);
      expect(screen.getByText('Start AI')).toBeTruthy();
      expect(screen.getByText('Stop AI')).toBeTruthy();
      expect(screen.getByText(/Live .* chart/)).toBeTruthy();
      // The binary max session gain panel is part of the page.
      expect(screen.getByText('Binary Max Session Gain')).toBeTruthy();
      expect(screen.getByText('Reset session')).toBeTruthy();
      // The AI signal (UP) and its confidence are displayed (the manual
      // ticket also has an UP button, so accept multiple matches).
      expect(screen.getAllByText('▲ UP').length).toBeGreaterThan(0);
      expect(screen.getByText(/confidence 72%/)).toBeTruthy();
    });
  });

  it('renders the Wallet Records page and the Tron status modal', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText('Wallet Records'));

    await waitFor(() => {
      expect(screen.getByText('Wallet records')).toBeTruthy();
      expect(screen.getByText('Available')).toBeTruthy();
      expect(screen.getByText('OPTION_STAKE_LOCKED')).toBeTruthy();
      // Kind tag + type column both show WITHDRAWAL.
      expect(screen.getAllByText('WITHDRAWAL').length).toBeGreaterThan(0);
      expect(screen.getByText('Hot wallet TRX')).toBeTruthy();
    });

    // The bottom-of-sidebar Tron indicator opens the status modal.
    fireEvent.click(screen.getByText('Simulated'));
    await waitFor(() => {
      expect(screen.getByText('Tron network status')).toBeTruthy();
      expect(screen.getByText('Deposit address')).toBeTruthy();
      expect(screen.getByText('Energy available')).toBeTruthy();
    });
  });
});
