import { roundMoney } from '@aioption/shared';
import type {
  ClassicBlockedReason,
  ClassicSettings,
  ClassicSettingsUpdate,
} from '@aioption/shared';

import { config } from '../config.js';
import {
  getAccount,
  logRiskEvent,
  logSettingsAudit,
  netDepositedCapital,
  setAppSetting,
  sumOpenPositionStakes,
  listPositions,
  updateAccount,
} from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import {
  SETTING_KEYS,
  readBoolSetting,
  readNumberSetting,
} from '../services/appSettings.js';

/** Daily loss limit bounds (same safe maximum as the global risk settings). */
export const DAILY_LOSS_LIMIT_MIN = 1;
export const DAILY_LOSS_LIMIT_MAX = 80;

export class ClassicSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassicSettingsError';
  }
}

/**
 * Classic Options settings: DB values (account columns + app_settings)
 * override the environment defaults. Trading is enabled only when the global
 * master switch (account.trading_enabled, shared with Binary) AND the
 * classic flag are both on — so "Stop" on the Classic page halts new classic
 * options without touching Binary trading.
 */
export class ClassicSettingsStore {
  /** Classic-specific enable flag (default true = follows the master switch). */
  classicFlag(): boolean {
    return readBoolSetting(SETTING_KEYS.classicTradingEnabled, true);
  }

  isTradingEnabled(): boolean {
    return getAccount().tradingEnabled && this.classicFlag();
  }

  maxStakeUsd(): number {
    return Math.min(getAccount().maxOptionStakeUsd, config.MAX_OPTION_STAKE_USD);
  }

  defaultStakeUsd(): number {
    const stored = readNumberSetting(SETTING_KEYS.classicDefaultStakeUsd, config.DEFAULT_OPTION_STAKE_USD);
    return Math.min(Math.max(stored, config.MIN_OPTION_STAKE_USD), this.maxStakeUsd());
  }

  defaultDurationSeconds(): number {
    const stored = getAccount().optionDefaultDurationSeconds;
    return config.OPTION_ALLOWED_DURATIONS_SECONDS.includes(stored)
      ? stored
      : config.OPTION_DEFAULT_DURATION_SECONDS;
  }

  dailyLossLimitPercent(): number {
    return getAccount().lossLimitPercent;
  }

  totalLossLimitPercent(): number {
    return readNumberSetting(SETTING_KEYS.totalLossLimitPercent, config.TOTAL_LOSS_LIMIT_PERCENT);
  }

  /** Loss-limit verdict for new opens; returns the user-facing reason or null. */
  lossLimitState(): { reason: ClassicBlockedReason; message: string } | null {
    const account = getAccount();
    if (account.startingEquity > 0) {
      const floor = account.startingEquity * (1 - account.lossLimitPercent / 100);
      if (account.equity <= floor + 1e-9) {
        return {
          reason: 'DAILY_LOSS_LIMIT_REACHED',
          message: `Daily loss limit (${account.lossLimitPercent}%) reached — new Classic Options are blocked.`,
        };
      }
    }
    const totalPercent = this.totalLossLimitPercent();
    const baseline = netDepositedCapital();
    if (totalPercent > 0 && baseline > 0) {
      const floor = baseline * (1 - totalPercent / 100);
      if (account.equity <= floor + 1e-9) {
        return {
          reason: 'LOSS_LIMIT_REACHED',
          message: `Total loss limit (${totalPercent}%) reached — new Classic Options are blocked.`,
        };
      }
    }
    return null;
  }

  lossLimitBlock(): string | null {
    const state = this.lossLimitState();
    if (state?.reason === 'LOSS_LIMIT_REACHED') {
      logRiskEvent({
        type: 'CLASSIC_TOTAL_LOSS_LIMIT_BLOCK',
        message: state.message,
        equityAtTrigger: getAccount().equity,
      });
    }
    return state?.message ?? null;
  }

  setClassicFlag(enabled: boolean): void {
    setAppSetting(SETTING_KEYS.classicTradingEnabled, enabled ? 'true' : 'false');
  }

  getSettings(): ClassicSettings {
    const account = getAccount();
    return {
      tradingEnabled: this.isTradingEnabled(),
      defaultStakeUsd: this.defaultStakeUsd(),
      maxStakeUsd: this.maxStakeUsd(),
      minStakeUsd: config.MIN_OPTION_STAKE_USD,
      maxStakeCeilingUsd: config.MAX_OPTION_STAKE_USD,
      defaultDurationSeconds: this.defaultDurationSeconds(),
      allowedDurationsSeconds: config.OPTION_ALLOWED_DURATIONS_SECONDS,
      maxDurationSeconds: config.OPTION_MAX_DURATION_SECONDS,
      dailyLossLimitPercent: account.lossLimitPercent,
      totalLossLimitPercent: this.totalLossLimitPercent(),
      currentLockedBalance: roundMoney(account.lockedBalance),
      availableBalance: roundMoney(account.cashBalance),
      openPositionCount: listPositions('OPEN').length,
    };
  }

  /**
   * Validates EVERY field first (nothing is saved on error), then persists.
   * Each changed value is written to settings_audit.
   */
  updateSettings(update: ClassicSettingsUpdate): ClassicSettings {
    const current = this.getSettings();
    const maxStake = update.maxStakeUsd ?? current.maxStakeUsd;
    const defaultStake = update.defaultStakeUsd ?? current.defaultStakeUsd;

    if (maxStake < config.MIN_OPTION_STAKE_USD || maxStake > config.MAX_OPTION_STAKE_USD) {
      throw new ClassicSettingsError(
        `Maximum stake must be between ${config.MIN_OPTION_STAKE_USD} and ${config.MAX_OPTION_STAKE_USD} USDT.`,
      );
    }
    if (defaultStake < config.MIN_OPTION_STAKE_USD || defaultStake > maxStake) {
      throw new ClassicSettingsError(
        `Default stake must be between ${config.MIN_OPTION_STAKE_USD} and the maximum stake (${maxStake} USDT).`,
      );
    }
    if (
      update.defaultDurationSeconds !== undefined &&
      !config.OPTION_ALLOWED_DURATIONS_SECONDS.includes(update.defaultDurationSeconds)
    ) {
      throw new ClassicSettingsError('Invalid option duration.');
    }
    if (
      update.dailyLossLimitPercent !== undefined &&
      (update.dailyLossLimitPercent < DAILY_LOSS_LIMIT_MIN || update.dailyLossLimitPercent > DAILY_LOSS_LIMIT_MAX)
    ) {
      throw new ClassicSettingsError(
        `Daily loss limit must be between ${DAILY_LOSS_LIMIT_MIN}% and ${DAILY_LOSS_LIMIT_MAX}%.`,
      );
    }
    if (
      update.totalLossLimitPercent !== undefined &&
      (update.totalLossLimitPercent < 0 || update.totalLossLimitPercent > 100)
    ) {
      throw new ClassicSettingsError('Total loss limit must be between 0% (off) and 100%.');
    }

    // Account columns (shared with existing risk settings).
    const accountBefore = getAccount();
    updateAccount({
      ...(update.maxStakeUsd !== undefined ? { maxOptionStakeUsd: update.maxStakeUsd } : {}),
      ...(update.defaultDurationSeconds !== undefined
        ? { optionDefaultDurationSeconds: update.defaultDurationSeconds }
        : {}),
      ...(update.dailyLossLimitPercent !== undefined
        ? { lossLimitPercent: update.dailyLossLimitPercent }
        : {}),
    });
    if (update.maxStakeUsd !== undefined) {
      logSettingsAudit('classic_max_stake_usd', String(accountBefore.maxOptionStakeUsd), String(update.maxStakeUsd));
    }
    if (update.defaultDurationSeconds !== undefined) {
      logSettingsAudit(
        'classic_default_duration_seconds',
        String(accountBefore.optionDefaultDurationSeconds),
        String(update.defaultDurationSeconds),
      );
    }
    if (update.dailyLossLimitPercent !== undefined) {
      logSettingsAudit(
        'daily_loss_limit_percent',
        String(accountBefore.lossLimitPercent),
        String(update.dailyLossLimitPercent),
      );
    }
    // app_settings values (setAppSetting audits internally).
    if (update.defaultStakeUsd !== undefined || update.maxStakeUsd !== undefined) {
      setAppSetting(SETTING_KEYS.classicDefaultStakeUsd, String(roundMoney(defaultStake)));
    }
    if (update.totalLossLimitPercent !== undefined) {
      setAppSetting(SETTING_KEYS.totalLossLimitPercent, String(update.totalLossLimitPercent));
    }

    const settings = this.getSettings();
    publishEvent('classic', { action: 'SETTINGS_UPDATED', settings });
    publishEvent('account', getAccount());
    return settings;
  }

  /** Open classic stake sum (for status displays). */
  openClassicStakeUsd(): number {
    return sumOpenPositionStakes();
  }
}

let store: ClassicSettingsStore | null = null;

export function getClassicSettingsStore(): ClassicSettingsStore {
  store ??= new ClassicSettingsStore();
  return store;
}
