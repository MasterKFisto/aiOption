import { describe, expect, it } from 'vitest';

import { SIMULATED_DEPOSIT_ADDRESS, SimulatedTronService } from '../src/services/tronService.js';
import { TronGridTronService } from '../src/services/tronGridService.js';

describe('SimulatedTronService', () => {
  it('returns a fixed simulated deposit address', async () => {
    const service = new SimulatedTronService();
    await expect(service.getDepositAddress()).resolves.toBe(SIMULATED_DEPOSIT_ADDRESS);
  });

  it('queues simulated incoming transfers and reports them', async () => {
    const service = new SimulatedTronService();
    const transfer = service.simulateIncomingUsdt(125.5);

    expect(transfer.txid).toMatch(/^sim-/);
    expect(transfer.amountUsdt).toBe(125.5);

    const transfers = await service.getIncomingUsdtTransfers();
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.txid).toBe(transfer.txid);
  });

  it('never broadcasts withdrawals', async () => {
    const service = new SimulatedTronService();
    await expect(
      service.sendUsdtWithdrawal({ destinationAddress: 'T123', amountUsdt: 1 }),
    ).rejects.toThrow(/does not broadcast/);
  });

  it('reports simulated transactions as confirmed', async () => {
    const service = new SimulatedTronService();
    const status = await service.getTransactionStatus('sim-abc');
    expect(status.confirmed).toBe(true);
    expect(status.succeeded).toBe(true);
  });
});

describe('TronGridTronService (safety guards)', () => {
  it('refuses to broadcast withdrawals while live withdrawals are disabled', async () => {
    const service = new TronGridTronService('MAINNET');
    await expect(
      service.sendUsdtWithdrawal({ destinationAddress: 'T123', amountUsdt: 1 }),
    ).rejects.toThrow(/live Tron withdrawals are disabled/);
  });

  it('requires a configured deposit address in live mode', async () => {
    const service = new TronGridTronService('MAINNET');
    await expect(service.getDepositAddress()).rejects.toThrow(/TRON_DEPOSIT_ADDRESS/);
  });
});
