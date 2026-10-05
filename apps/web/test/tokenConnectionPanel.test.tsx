// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TronTokenStatus } from '@aioption/shared';

import { TokenConnectionPanel } from '../src/components/TokenConnectionPanel';

/**
 * Phase 7.4: the "USDT Token Connection" panel must surface token connection
 * errors clearly and display the on-chain metadata/balances when connected.
 */

/* Browser APIs missing from jsdom (antd needs matchMedia/ResizeObserver). */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const apiMock = vi.hoisted(() => ({
  tronTokenStatus: vi.fn(),
  testTronTokenConnection: vi.fn(),
  saveTronTokenContract: vi.fn(),
}));

vi.mock('../src/api/client', () => ({
  api: apiMock,
}));

function statusFixture(overrides: Partial<TronTokenStatus> = {}): TronTokenStatus {
  return {
    tronMode: 'NILE',
    networkName: 'Nile Testnet',
    rpcUrl: 'https://nile.trongrid.io',
    rpcConnected: true,
    depositAddress: 'TTestnetDepositAddressPhase740000000',
    hotWalletAddress: 'TTestnetHotWalletPhase74000000000',
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
    warnings: [],
    errors: [],
    lastCheckedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPanel(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <TokenConnectionPanel />
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
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
});

beforeEach(() => {
  apiMock.tronTokenStatus.mockReset();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('TokenConnectionPanel (Phase 7.4)', () => {
  it('shows the missing-contract warning and error code clearly', async () => {
    apiMock.tronTokenStatus.mockResolvedValue(
      statusFixture({
        warnings: ['USDT token contract is not configured.'],
        errors: ['TOKEN_CONTRACT_MISSING'],
      }),
    );
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('USDT Token Connection')).toBeTruthy();
      expect(screen.getByText('USDT token contract is not configured.')).toBeTruthy();
      expect(screen.getByText('TOKEN_CONTRACT_MISSING')).toBeTruthy();
      expect(screen.getByTestId('token-connection-status').textContent).toBe('NOT CONFIGURED');
      expect(screen.getByText('Nile Testnet')).toBeTruthy();
      expect(screen.getByTestId('test-token-connection')).toBeTruthy();
      expect(screen.getByTestId('token-contract-input')).toBeTruthy();
    });
  });

  it('shows token metadata, balances and source when connected', async () => {
    apiMock.tronTokenStatus.mockResolvedValue(
      statusFixture({
        tokenContractAddress: 'TTestUsdtTokenContractPhase7400000',
        tokenContractSource: 'ENVIRONMENT',
        tokenConfigured: true,
        tokenConnected: true,
        tokenName: 'Tether USD Test',
        tokenSymbol: 'USDT-TEST',
        tokenDecimals: 6,
        depositTokenBalance: '250.5',
        hotWalletTokenBalance: '1000',
        hotWalletTrxBalance: '42',
        warnings: ['TOKEN_SYMBOL_MISMATCH: Token symbol "USDT-TEST" does not match expected "USDT".'],
      }),
    );
    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('token-contract-address').textContent).toBe(
        'TTestUsdtTokenContractPhase7400000',
      );
      expect(screen.getByText('Tether USD Test')).toBeTruthy();
      expect(screen.getByText('USDT-TEST')).toBeTruthy();
      expect(screen.getByText('250.5 USDT-TEST')).toBeTruthy();
      expect(screen.getByText('1000 USDT-TEST')).toBeTruthy();
      expect(screen.getByText('42 TRX')).toBeTruthy();
      expect(screen.getByTestId('token-connection-status').textContent).toBe('CONNECTED');
      expect(screen.getByText('Environment')).toBeTruthy();
      // The mismatch warning is shown but does not block the connected state.
      expect(screen.getByText(/TOKEN_SYMBOL_MISMATCH/)).toBeTruthy();
    });
  });
});
