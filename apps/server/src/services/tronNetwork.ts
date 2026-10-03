import { config } from '../config.js';

/**
 * Network naming + explorer helpers (Phase 7). Depends only on config so it
 * can be imported from repositories without an import cycle.
 */
export const NETWORK_NAMES: Record<string, string> = {
  SIMULATED: 'Simulated',
  SHASTA: 'Shasta Testnet',
  NILE: 'Nile Testnet',
  MAINNET: 'Tron Mainnet',
};

const EXPLORERS: Record<string, string> = {
  SHASTA: 'https://shasta.tronscan.org',
  NILE: 'https://nile.tronscan.org',
  MAINNET: 'https://tronscan.org',
};

/** Block-explorer base for the active network (TRON_EXPLORER_URL overrides). */
export function explorerBase(): string | null {
  if (config.TRON_MODE === 'SIMULATED') {
    return null;
  }
  return config.TRON_EXPLORER_URL || EXPLORERS[config.TRON_MODE] || null;
}

/** Explorer link for a transaction on the ACTIVE network (null for simulated txids). */
export function explorerTxUrl(txid: string | null): string | null {
  if (!txid || txid.startsWith('sim-')) {
    return null;
  }
  const base = explorerBase() ?? EXPLORERS['MAINNET']!;
  return `${base}/#/transaction/${txid}`;
}

export function isTestnet(): boolean {
  return config.TRON_MODE === 'SHASTA' || config.TRON_MODE === 'NILE';
}
