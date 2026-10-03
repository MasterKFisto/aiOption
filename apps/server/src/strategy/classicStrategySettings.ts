import type { ClassicStrategySettings, ClassicStrategySettingsUpdate } from '@aioption/shared';

import { config } from '../config.js';
import { logSettingsAudit, setAppSetting } from '../db/repositories.js';
import { publishEvent } from '../events/eventBus.js';
import { readBoolSetting, readNumberSetting } from '../services/appSettings.js';

/** app_settings keys for the Phase 6.5.2 AI strategy settings. */
export const STRATEGY_KEYS = {
  rsiPeriod: 'classic_ai_rsi_period',
  rsiOverbought: 'classic_ai_rsi_overbought',
  rsiOversold: 'classic_ai_rsi_oversold',
  requireNeutralCooldown: 'classic_ai_require_neutral_cooldown',
  maxConsecutiveSameDirection: 'classic_max_consecutive_same_direction',
  cooldownAfterMaxConsecutiveMs: 'classic_cooldown_after_max_consecutive_ms',
} as const;

export class StrategySettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategySettingsError';
  }
}

/**
 * Classic AI strategy settings: app_settings (UI) override the env defaults.
 * Read on EVERY evaluation, so a save applies to the live loop immediately.
 */
export function getStrategySettings(): ClassicStrategySettings {
  return {
    rsiPeriod: readNumberSetting(STRATEGY_KEYS.rsiPeriod, config.CLASSIC_AI_RSI_PERIOD),
    rsiOverbought: readNumberSetting(STRATEGY_KEYS.rsiOverbought, config.CLASSIC_AI_RSI_OVERBOUGHT),
    rsiOversold: readNumberSetting(STRATEGY_KEYS.rsiOversold, config.CLASSIC_AI_RSI_OVERSOLD),
    requireNeutralCooldown: readBoolSetting(
      STRATEGY_KEYS.requireNeutralCooldown,
      config.CLASSIC_AI_REQUIRE_NEUTRAL_COOLDOWN,
    ),
    maxConsecutiveSameDirection: readNumberSetting(
      STRATEGY_KEYS.maxConsecutiveSameDirection,
      config.CLASSIC_MAX_CONSECUTIVE_SAME_DIRECTION,
    ),
    cooldownAfterMaxConsecutiveMs: readNumberSetting(
      STRATEGY_KEYS.cooldownAfterMaxConsecutiveMs,
      config.CLASSIC_COOLDOWN_AFTER_MAX_CONSECUTIVE_MS,
    ),
  };
}

/** Validates all fields first (nothing saved on error), then persists + audits. */
export function updateStrategySettings(update: ClassicStrategySettingsUpdate): ClassicStrategySettings {
  const current = getStrategySettings();
  const next = { ...current, ...update };
  const isInt = (n: number) => Number.isInteger(n);
  if (!isInt(next.rsiPeriod) || next.rsiPeriod < 2 || next.rsiPeriod > 100) {
    throw new StrategySettingsError('RSI period must be an integer between 2 and 100.');
  }
  if (next.rsiOverbought < 51 || next.rsiOverbought > 99) {
    throw new StrategySettingsError('RSI overbought threshold must be between 51 and 99.');
  }
  if (next.rsiOversold < 1 || next.rsiOversold > 49) {
    throw new StrategySettingsError('RSI oversold threshold must be between 1 and 49.');
  }
  if (!isInt(next.maxConsecutiveSameDirection) || next.maxConsecutiveSameDirection < 1 || next.maxConsecutiveSameDirection > 20) {
    throw new StrategySettingsError('Max consecutive same-direction trades must be an integer between 1 and 20.');
  }
  if (!isInt(next.cooldownAfterMaxConsecutiveMs) || next.cooldownAfterMaxConsecutiveMs < 0 || next.cooldownAfterMaxConsecutiveMs > 86_400_000) {
    throw new StrategySettingsError('Cooldown must be between 0 and 1440 minutes.');
  }

  const entries: Array<[keyof ClassicStrategySettings, string]> = [
    ['rsiPeriod', STRATEGY_KEYS.rsiPeriod],
    ['rsiOverbought', STRATEGY_KEYS.rsiOverbought],
    ['rsiOversold', STRATEGY_KEYS.rsiOversold],
    ['requireNeutralCooldown', STRATEGY_KEYS.requireNeutralCooldown],
    ['maxConsecutiveSameDirection', STRATEGY_KEYS.maxConsecutiveSameDirection],
    ['cooldownAfterMaxConsecutiveMs', STRATEGY_KEYS.cooldownAfterMaxConsecutiveMs],
  ];
  for (const [field, key] of entries) {
    if (update[field] !== undefined) {
      // setAppSetting writes the settings_audit row itself.
      setAppSetting(key, String(next[field]));
    }
  }
  void logSettingsAudit; // audit is handled by setAppSetting
  const saved = getStrategySettings();
  publishEvent('classic', { action: 'STRATEGY_UPDATED', strategy: saved });
  return saved;
}
