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
        baseCurrency: 'USDT',
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
      unrealizedPnl: 2.35,
      loopRunning: false,
      dailyLossLimitPercent: 40,
      dailyLossRemainingUsd: 600,
      lossLimitFloorUsd: 600,
      binarySessionGainUsd: 0,
      binarySessionGainLimitUsd: 50,
      binarySessionGainRemainingUsd: 50,
      binarySessionGainLimitReached: false,
      aiBinarySessionProfitUsd: 0,
      availableBalance: 800,
      lockedBalance: 200,
      totalEquity: 1000,
      openClassicUnrealizedPnl: 2.35,
      openBinaryExposure: 15,
      openBinaryCount: 2,
      estimatedBinaryUnrealizedPnl: null,
      binaryUnrealizedMode: 'CONSERVATIVE',
    },
    '/api/settings/binary-unrealized': { mode: 'CONSERVATIVE' },
    '/api/binary/session-stats': {
      sessionStartedAt: new Date().toISOString(),
      manualNetGain: 0,
      aiNetGain: 0,
      combinedNetGain: 0,
      wins: 0,
      losses: 0,
      refunds: 0,
      gainLimitEnabled: true,
      maxSessionGainUsdt: 50,
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
      warning: 'TRX deposits are used only for Tron network fees. They are not credited as USDT trading balance.',
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
    '/api/tron/fee-estimate?amount=100&destination=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': {
      network: 'TRON',
      asset: 'USDT',
      tokenStandard: 'TRC20',
      estimatedFeeTrx: 30,
      estimatedFeeUsd: 3.6,
      feePayer: 'HOT_WALLET',
      energyRequired: 31895,
      bandwidthRequired: 345,
      hotWalletTrxBalance: 0,
      hotWalletEnergyAvailable: 0,
      sufficientFeeResources: false,
      warnings: ['hot wallet TRX balance (0) or energy may be insufficient'],
    },
    '/api/market/ticker': {
      status: 'connected',
      ticker: {
        status: 'connected',
        source: 'COINBASE',
        symbol: 'BTC/USDT',
        requestedSymbol: 'BTC/USDT',
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
    '/api/ai/decisions?limit=5': [],
    '/api/risk-events?limit=5': [],
    '/api/withdrawals': [],
    '/api/deposits': [],
    '/api/deposits/info': {
      address: 'TSimulatedAiOptionDepositAddressUSDT1',
      network: 'TRON',
      asset: 'USDT',
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
    '/api/binary/open': [
      {
        id: 91,
        asset: 'BTC/USDT',
        direction: 'UP',
        stakeUsd: 10,
        payoutRatio: 0.8,
        potentialProfitUsd: 8,
        totalReturnIfWinUsd: 18,
        entryPrice: 66000,
        settlementPrice: null,
        status: 'OPEN',
        result: null,
        openedAt: new Date(Date.now() - 2000).toISOString(),
        expiresAt: new Date(Date.now() + 8000).toISOString(),
        settledAt: null,
        marketDataSource: 'COINBASE',
        source: 'AI_BINARY',
        rejectionReason: null,
        notes: null,
        currentStatus: 'LOSING',
        currentPrice: 65990,
        timeRemainingMs: 8000,
        potentialProfit: 8,
        potentialLoss: 10,
        estimatedUnrealizedPnl: null,
      },
    ],
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
      allowedDurationsSeconds: [60, 180, 300, 600, 900, 1800, 3600],
      defaultDurationSeconds: 600,
      maxDurationSeconds: 3600,
    },
    '/api/classic/settings': {
      tradingEnabled: false,
      defaultStakeUsd: 10,
      maxStakeUsd: 100,
      minStakeUsd: 1,
      maxStakeCeilingUsd: 100,
      defaultDurationSeconds: 600,
      allowedDurationsSeconds: [60, 180, 300, 600, 900, 1800, 3600],
      maxDurationSeconds: 3600,
      dailyLossLimitPercent: 40,
      totalLossLimitPercent: 0,
      currentLockedBalance: 200,
      availableBalance: 800,
      openPositionCount: 1,
    },
    '/api/classic/strategy': {
      settings: {
        rsiPeriod: 14,
        rsiOverbought: 70,
        rsiOversold: 30,
        requireNeutralCooldown: true,
        maxConsecutiveSameDirection: 3,
        cooldownAfterMaxConsecutiveMs: 300000,
      },
      direction: {
        consecutivePutCount: 3,
        consecutiveCallCount: 0,
        putBlockedUntil: new Date(Date.now() + 240_000).toISOString(),
        callBlockedUntil: null,
        lastDirectionalSignal: 'PUT',
        neutralSeenSinceLastDirection: false,
      },
    },
    '/api/ai/decisions?limit=100': [
      {
        id: 41,
        symbol: 'BTC/USDT',
        signal: 'NEUTRAL',
        action: 'HOLD',
        confidence: 0.5,
        expectedReturn: 0,
        proposedTradeSizeUsd: 10,
        rationale: 'NEUTRAL — RSI Oversold (24.3 < 30) — PUT refused',
        executed: false,
        positionId: null,
        createdAt: new Date().toISOString(),
        features: {
          currentPrice: 58321.5,
          momentumPercent: -0.84,
          momentumPeriod: 24,
          rsi: 24.3,
          rsiPeriod: 14,
          rsiOverbought: 70,
          rsiOversold: 30,
          volatilityPercent: 41.2,
          volatilityThreshold: 120,
          regime: 'OVERSOLD',
          rawSignal: 'BEARISH',
          consecutivePutCount: 2,
          consecutiveCallCount: 0,
          finalSignal: 'NEUTRAL',
          filterReason: 'RSI Oversold (24.3 < 30) — PUT refused',
          rejectionReason: null,
        },
      },
      {
        id: 40,
        symbol: 'BTC/USDT',
        signal: 'BEARISH',
        action: 'OPEN_PUT',
        confidence: 0.71,
        expectedReturn: -0.004,
        proposedTradeSizeUsd: 10,
        rationale: 'PUT — momentum down | Blocked: Max consecutive PUTs reached (3). Directional bias blocked.',
        executed: false,
        positionId: null,
        createdAt: new Date().toISOString(),
        features: {
          currentPrice: 58900,
          momentumPercent: -0.4,
          momentumPeriod: 24,
          rsi: 41.7,
          rsiPeriod: 14,
          rsiOverbought: 70,
          rsiOversold: 30,
          volatilityPercent: 39,
          volatilityThreshold: 120,
          regime: 'NORMAL',
          rawSignal: 'BEARISH',
          consecutivePutCount: 3,
          consecutiveCallCount: 0,
          finalSignal: 'PUT',
          filterReason: null,
          rejectionReason: 'Max consecutive PUTs reached (3). Directional bias blocked.',
        },
      },
    ],
    '/api/classic/status': {
      tradingEnabled: false,
      loopRunning: false,
      blockedReason: 'TRADING_DISABLED',
      blockedMessage: 'Classic Options trading is disabled.',
      openPositions: 1,
      lockedBalance: 200,
      openClassicStakeUsd: 10,
      availableBalance: 800,
      marketDataFresh: true,
      lastUpdated: new Date().toISOString(),
    },
    '/api/classic/history?limit=20': [
      {
        id: 7,
        symbol: 'BTC-2026-10-02-67000-C',
        side: 'CALL',
        strikePrice: 67000,
        expiry: '2026-10-02',
        quantity: 1,
        entryPremium: 10,
        exitPremium: 67100,
        status: 'CLOSED',
        realizedPnl: 8,
        openedAt: new Date(Date.now() - 700_000).toISOString(),
        closedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        durationSeconds: 600,
        expiresAt: new Date(Date.now() - 100_000).toISOString(),
        settledAt: new Date().toISOString(),
        settlementPrice: 67100,
        settlementStatus: 'SETTLED',
        settlementReason: 'expired: WIN at market price 67100',
        source: 'MANUAL',
        stakeUsd: 10,
      },
    ],
    '/api/positions?status=OPEN': [
      {
        id: 8,
        symbol: 'BTC-2026-10-02-67000-P',
        side: 'PUT',
        strikePrice: 67000,
        expiry: '2026-10-02',
        quantity: 1,
        entryPremium: 10,
        exitPremium: null,
        status: 'OPEN',
        realizedPnl: null,
        openedAt: new Date().toISOString(),
        closedAt: null,
        createdAt: new Date().toISOString(),
        durationSeconds: 600,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        settledAt: null,
        settlementPrice: null,
        settlementStatus: 'OPEN',
        settlementReason: null,
        source: 'MANUAL',
        stakeUsd: 10,
      },
    ],
    '/api/wallet/addresses': {
      usdtTradeAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      withdrawalDestinationAddress: '',
      effectiveWithdrawalDestinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      trxFeeWalletAddress: 'TSimulatedFeeWalletAddressTRX0000000001',
      usdtTradeAddressSource: 'DATABASE',
      withdrawalDestinationAddressSource: 'NOT_SET',
      trxFeeWalletAddressSource: 'SIMULATED',
      updatedAt: new Date().toISOString(),
      validationStatus: {
        usdtTradeAddress: { valid: true, addressType: 'TRON' },
        withdrawalDestinationAddress: null,
        trxFeeWalletAddress: { valid: false, addressType: 'UNKNOWN', reason: 'Simulated placeholder' },
      },
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
      depositAddress: 'TSimulatedAiOptionDepositAddressUSDT1',
      hotWalletAddress: '',
      usdtContractAddress: '',
      requiredConfirmations: 12,
      trxBalance: 120,
      energyAvailable: 100000,
      bandwidthAvailable: 5000,
      lowFeeResource: false,
      lastCheckedAt: null,
      warnings: ['simulated Tron mode — no real chain interaction'],
    },
    // Phase 7.4: token panel (no contract configured in the smoke environment).
    '/api/tron/token-status': {
      tronMode: 'SIMULATED',
      networkName: 'Simulated',
      rpcUrl: '',
      rpcConnected: true,
      depositAddress: 'TSimulatedAiOptionDepositAddressUSDT1',
      hotWalletAddress: '',
      tokenContractAddress: '',
      tokenContractSource: 'NOT_SET',
      tokenConfigured: false,
      tokenConnected: false,
      simulated: false,
      tokenName: null,
      tokenSymbol: null,
      tokenDecimals: null,
      depositTokenBalance: null,
      hotWalletTokenBalance: null,
      hotWalletTrxBalance: null,
      expectedSymbol: 'USDT',
      expectedDecimals: 6,
      allowTestToken: true,
      warnings: ['USDT token contract is not configured.'],
      errors: ['TOKEN_CONTRACT_MISSING'],
      lastCheckedAt: new Date().toISOString(),
    },
    '/api/wallet/records?type=ALL&limit=100&offset=0': {
      records: [
        {
          id: 'tx-1',
          kind: 'TRADE',
          time: new Date().toISOString(),
          type: 'OPTION_STAKE_LOCKED',
          amount: -10,
          asset: 'USDT',
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
          asset: 'USDT',
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

    // The unified account bar shows the Phase 6.5 fields.
    await waitFor(() => {
      expect(screen.getByText('Binary session gain')).toBeTruthy();
      expect(screen.getByText('Binary gain limit')).toBeTruthy();
      expect(screen.getByText('AI binary session profit')).toBeTruthy();
      expect(screen.getAllByText(/Daily loss limit/).length).toBeGreaterThan(0);
      expect(screen.getByText('Loss limit floor')).toBeTruthy();
      // Phase 6.5.3: clear realized / unrealized / binary exposure split.
      expect(screen.getByText('Realized PnL (settled)')).toBeTruthy();
      expect(screen.getByTestId('unrealized-title').textContent).toContain('Unrealized PnL');
      expect(screen.getByLabelText('About Unrealized PnL')).toBeTruthy();
      expect(screen.getByText('Open Classic Options PnL')).toBeTruthy();
      expect(screen.getByText('Open Binary Exposure')).toBeTruthy();
      expect(screen.getByText(/USDT \(2 open\)/)).toBeTruthy();
      // Conservative mode: no estimated binary PnL shown.
      expect(screen.queryByTestId('estimated-binary-title')).toBeNull();
    });
  });

  it('Phase 6.5.1: Classic page has the trading panel, 10-min default, address, open + settled panels', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      // Trading control panel with Start/Stop + status + save — on the Classic page.
      expect(screen.getByText('Classic Options trading')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Start Trading' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Stop Trading' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save Settings' })).toBeTruthy();
      expect(screen.getByTestId('classic-status').textContent).toBe('Trading Disabled');
      expect(screen.getByText('Default stake (USDT)')).toBeTruthy();
      expect(screen.getByText(/Total loss limit/)).toBeTruthy();
    });
    // Ticket + settings default to 10 minutes.
    await waitFor(() => {
      expect(screen.getAllByText('10 min').length).toBeGreaterThanOrEqual(2);
    });
    // Open positions (stake, countdown) + settled history + trade address.
    await waitFor(() => {
      expect(screen.getByText('Open positions (1)')).toBeTruthy();
      expect(screen.getAllByText('Stake (locked)').length).toBeGreaterThan(0);
      expect(screen.getByText(/^9m \d\ds$|^10m 00s$/)).toBeTruthy();
      expect(screen.getByText('Recent settled positions')).toBeTruthy();
      expect(screen.getByText('WIN')).toBeTruthy();
      expect(screen.getByText('USDT Tron trade address')).toBeTruthy();
      expect(screen.getByTestId('usdt-trade-address').textContent).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
      expect(screen.getByText('Valid Tron address')).toBeTruthy();
    });
  });

  it('Phase 6.5.2: Advanced AI Settings show RSI thresholds, streak counts and cooldowns', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('Advanced AI Settings'));
    await waitFor(() => {
      expect(screen.getByText('RSI Overbought (51–99)')).toBeTruthy();
      expect(screen.getByText('RSI Oversold (1–49)')).toBeTruthy();
      expect(screen.getByText('Max consecutive same direction')).toBeTruthy();
      expect(screen.getByText('Cooldown after max consecutive (min)')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save AI Settings' })).toBeTruthy();
      const state = screen.getByTestId('direction-state').textContent ?? '';
      expect(state).toContain('3 consecutive PUT');
      expect(state).toContain('PUT blocked until');
      expect(state).toContain('CALL allowed');
    });
  });

  it('Phase 6.5.2: AI Decisions page shows RSI, streaks and why a signal was blocked', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('AI Decisions'));
    await waitFor(() => {
      expect(screen.getByText('24.3')).toBeTruthy(); // RSI value
      expect(screen.getByText('Blocked: RSI Oversold (24.3 < 30) — PUT refused')).toBeTruthy();
      expect(
        screen.getByText('Blocked: Max consecutive PUTs reached (3). Directional bias blocked.'),
      ).toBeTruthy();
      expect(screen.getByText('3 / 0')).toBeTruthy(); // streak PUT / CALL
    });
    // Detail drawer with every feature.
    fireEvent.click(screen.getByText('24.3'));
    await waitFor(() => {
      expect(screen.getByText('AI decision #41')).toBeTruthy();
      expect(screen.getByText('Consecutive PUT')).toBeTruthy();
      expect(screen.getByText('Strategy filter')).toBeTruthy();
      expect(screen.getByText('Risk rejection')).toBeTruthy();
    });
  });

  it('Phase 6.5.1: Start Trading asks for confirmation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );
    const start = await screen.findByRole('button', { name: 'Start Trading' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => {
      expect(screen.getAllByText('Start Classic Options trading?').length).toBeGreaterThan(0);
    });
  });

  it('Phase 6.5.1: editing the trade address shows the warning and the edit form', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('USDT Tron trade address');
    const edit = await screen.findByRole('button', { name: 'Edit' });
    await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(edit);
    await waitFor(() => {
      expect(screen.getByText(/Please verify the Tron address carefully/)).toBeTruthy();
      expect(screen.getByText('USDT Tron trade address (TRC20)')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save address' })).toBeTruthy();
    });
  });

  it('Phase 6.5.1: Settings page no longer hosts the Classic Start Trading control', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Settings'));
    await waitFor(() => {
      expect(screen.getByText('Classic Options trading has moved')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open Classic Options' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Start Trading' })).toBeNull();
    expect(screen.queryByText('Option default duration (seconds)')).toBeNull();
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
      expect(screen.getByText('Open binary contracts (1)')).toBeTruthy();
      // Phase 6.5.3: live status + potential profit/loss, no final result.
      expect(screen.getByTestId('binary-status-91').textContent).toBe('Currently Losing');
      expect(screen.getByText('Potential loss')).toBeTruthy();
      expect(screen.getAllByText('-$10.00').length).toBeGreaterThan(0);
      expect(screen.getByText(/result decided at expiry/)).toBeTruthy();
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

    // The TRX fee wallet panel is part of the page (address, reserve, simulate).
    await waitFor(() => {
      // Card title of the fee panel (the trade-address panel has a row with the same label).
      expect(screen.getAllByText('TRX fee wallet').length).toBeGreaterThan(0);
      expect(screen.getAllByText('USDT Tron trade address').length).toBeGreaterThan(0);
      // Shown in both the fee panel and the trade-address panel.
      expect(screen.getAllByText('TSimulatedFeeWalletAddressTRX0000000001').length).toBeGreaterThan(0);
      expect(screen.getByTestId('usdt-trade-address').textContent).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
      expect(screen.getByText('Simulate TRX fee deposit')).toBeTruthy();
      expect(screen.getByText('Recent TRX fee deposits')).toBeTruthy();
      expect(screen.getByText(/not credited as USDT trading balance/)).toBeTruthy();
    });

    // The bottom-of-sidebar Tron indicator opens the status modal.
    fireEvent.click(screen.getByText('Simulated'));
    await waitFor(() => {
      expect(screen.getByText('Tron network status')).toBeTruthy();
      expect(screen.getByText('Deposit address')).toBeTruthy();
      expect(screen.getByText('Energy available')).toBeTruthy();
      // Trade address panel is reachable from the Tron status modal too.
      const modal = document.querySelector('.ant-modal') as HTMLElement;
      expect(modal.textContent).toContain('USDT Tron trade address');
    });

    // Phase 7.4: the modal contains the USDT Token Connection panel and shows
    // the missing-contract error clearly.
    await waitFor(() => {
      const modal = document.querySelector('.ant-modal') as HTMLElement;
      expect(modal.textContent).toContain('USDT Token Connection');
      expect(modal.textContent).toContain('TOKEN_CONTRACT_MISSING');
      expect(modal.textContent).toContain('USDT token contract is not configured.');
      expect(modal.textContent).toContain('Test Token Connection');
    });
  });

  it('shows the fee-reserve warning and disables withdrawal submission', async () => {
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

    // Open the withdrawal modal from the Classic Options page.
    fireEvent.click(screen.getByText('Withdraw'));

    // Wait until the available balance has loaded, otherwise the amount
    // input (max = available) would clamp the typed amount to 0.
    await waitFor(() => {
      expect(screen.getByText('Withdraw USDT')).toBeTruthy();
      const modal = document.querySelector('.ant-modal') as HTMLElement;
      expect(modal.textContent).toContain('$800.00');
    });

    // Fill amount + address; fireEvent.change handles React's value tracker
    // so the antd form store registers the new values.
    const spin = document.querySelector(
      '.ant-modal input[role="spinbutton"]',
    ) as HTMLInputElement;
    fireEvent.change(spin, { target: { value: '100' } });
    const address = document.querySelector('.ant-modal input[placeholder="T..."]') as HTMLInputElement;
    fireEvent.change(address, { target: { value: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' } });

    await waitFor(() => {
      expect(screen.getByText(/Fee resources insufficient/)).toBeTruthy();
    });
    expect(screen.getByText('Open TRX fee deposit panel')).toBeTruthy();
    const submit = screen.getByRole('button', { name: /Submit withdrawal/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
