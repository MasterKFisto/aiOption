import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.js';
import {
  createWithdrawal,
  getAccount,
  listWithdrawals,
  logRiskEvent,
  updateWithdrawalStatus,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { resolveUsdtTokenContract } from '../services/appSettings.js';
import { tronService } from '../services/tronService.js';
import { estimateWithdrawalFee } from '../services/tronStatusService.js';
import { getFeeReserveStatus } from '../services/tronFeeWalletService.js';
import {
  hotWalletTokenBalance,
  INSUFFICIENT_HOT_WALLET_TOKEN_MESSAGE,
} from '../services/tronTokenService.js';
import { WalletService } from '../services/walletService.js';

/** Base58 Tron address: 34 chars, T-prefixed. */
export const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

const withdrawalSchema = z
  .object({
    amount: z.coerce.number().positive(),
    destinationAddress: z
      .string()
      .trim()
      .regex(TRON_ADDRESS_RE, 'must be a valid Tron address (base58, T-prefixed, 34 chars)'),
    confirmed: z.boolean(),
  })
  .refine((value) => value.confirmed === true, {
    message: 'you must confirm the withdrawal',
    path: ['confirmed'],
  });

/**
 * Tron USDT (TRC20) withdrawal endpoints. Registered with prefix /api.
 *
 * SAFETY: in simulated mode nothing is broadcast; in live mode withdrawals are
 * recorded as REQUESTED unless ENABLE_LIVE_TRON_WITHDRAWALS=true.
 */
export async function withdrawalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/withdrawals', async () => {
    // Lazily refresh BROADCAST withdrawals against the chain.
    for (const withdrawal of listWithdrawals(50)) {
      if (withdrawal.status === 'BROADCAST' && withdrawal.txid) {
        try {
          const status = await tronService.getTransactionStatus(withdrawal.txid);
          if (status.confirmed) {
            updateWithdrawalStatus(withdrawal.id, 'CONFIRMED');
          }
        } catch {
          // keep the current status on lookup failure
        }
      }
    }
    return listWithdrawals(50);
  });

  app.post('/withdrawals', async (request, reply) => {
    const parsed = withdrawalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body', issues: parsed.error.issues });
    }
    const { amount, destinationAddress } = parsed.data;

    const account = getAccount();
    if (amount > account.cashBalance + 1e-9) {
      return reply
        .code(400)
        .send({
          error:
            `Insufficient funds: requested ${amount} ${account.baseCurrency} ` +
            `but only ${account.cashBalance} available`,
        });
    }

    // Phase 7.4: every withdrawal is bound to the configured token contract.
    const tokenContractAddress = resolveUsdtTokenContract().address || null;

    // Network fee estimate + resource gate (Phase 6.4/6.5).
    const fee = estimateWithdrawalFee(destinationAddress);
    const feeReserve = getFeeReserveStatus();
    const feeBlocked =
      !fee.sufficientFeeResources && !config.ALLOW_WITHDRAWAL_WHEN_FEE_INSUFFICIENT;

    if (config.TRON_MODE === 'SIMULATED') {
      const withdrawal = createWithdrawal({
        amount,
        destinationAddress,
        status: 'SIMULATED',
        tokenContractAddress,
        txid: `sim-${randomUUID()}`,
        notes: 'simulated Tron USDT TRC20 withdrawal',
        feeEstimateTrx: fee.estimatedFeeTrx,
        feeEstimateUsd: fee.estimatedFeeUsd,
        feePayer: fee.feePayer,
        feeStatus: fee.sufficientFeeResources ? 'ESTIMATED' : 'INSUFFICIENT',
        feeNotes: fee.warnings.join('; ') || null,
        feeReserveSufficient: feeReserve.sufficientFeeReserve,
        feeReserveError: feeReserve.warnings.join('; ') || null,
      });
      new WalletService().withdraw(amount, `Tron USDT withdrawal to ${destinationAddress}`);
      publishEvent('withdrawal', withdrawal);
      return { withdrawal, account: getAccount(), feeEstimate: fee };
    }

    if (feeBlocked || config.TRON_WITHDRAWAL_FEE_POLICY === 'BLOCK_IF_INSUFFICIENT') {
      logRiskEvent({
        type: 'TRON_FEE_INSUFFICIENT_WITHDRAWAL_BLOCKED',
        message:
          `withdrawal blocked: hot wallet TRX balance ${fee.hotWalletTrxBalance} ` +
          `(min ${config.TRON_MIN_TRX_FEE_RESERVE}), estimated fee ${fee.estimatedFeeTrx} TRX`,
        equityAtTrigger: account.equity,
      });
      return reply.code(400).send({
        error:
          'Insufficient fee resources: fund the hot wallet with TRX or energy before withdrawing USDT',
        feeEstimate: fee,
      });
    }

    // Live Tron mode: never broadcast unless explicitly enabled.
    const status = fee.sufficientFeeResources ? 'REQUESTED' : 'PENDING_FEE';
    const withdrawal = createWithdrawal({
      amount,
      destinationAddress,
      status,
      tokenContractAddress,
      feeEstimateTrx: fee.estimatedFeeTrx,
      feeEstimateUsd: fee.estimatedFeeUsd,
      feePayer: fee.feePayer,
      feeStatus: fee.sufficientFeeResources ? 'ESTIMATED' : 'INSUFFICIENT',
      feeNotes: fee.warnings.join('; ') || null,
      feeReserveSufficient: feeReserve.sufficientFeeReserve,
      feeReserveError: feeReserve.warnings.join('; ') || null,
    });
    if (!config.ENABLE_LIVE_TRON_WITHDRAWALS) {
      publishEvent('withdrawal', withdrawal);
      return reply
        .code(202)
        .send({
          withdrawal,
          feeEstimate: fee,
          message: `withdrawal recorded as ${status} — live Tron withdrawals are disabled`,
        });
    }

    try {
      // Phase 7.4: never broadcast more of the token than the hot wallet holds.
      const tokenBalance = await hotWalletTokenBalance();
      if (tokenBalance !== null && tokenBalance + 1e-9 < amount) {
        updateWithdrawalStatus(withdrawal.id, 'FAILED', { error: INSUFFICIENT_HOT_WALLET_TOKEN_MESSAGE });
        return reply.code(400).send({
          error: INSUFFICIENT_HOT_WALLET_TOKEN_MESSAGE,
          hotWalletTokenBalance: tokenBalance,
        });
      }
      const broadcast = await tronService.sendUsdtWithdrawal({
        destinationAddress,
        amountUsdt: amount,
      });
      new WalletService().withdraw(amount, `Tron USDT withdrawal to ${destinationAddress}`);
      const updated = updateWithdrawalStatus(withdrawal.id, 'BROADCAST', { txid: broadcast.txid });
      publishEvent('withdrawal', updated);
      return { withdrawal: updated, account: getAccount() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updated = updateWithdrawalStatus(withdrawal.id, 'FAILED', { error: message });
      publishEvent('withdrawal', updated);
      return reply.code(502).send({ withdrawal: updated, error: message });
    }
  });
}
