import { createHash } from 'node:crypto';

import type { AddressValidation } from '@aioption/shared';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
/** Tron address version byte (mainnet, Shasta and Nile all use 0x41). */
const TRON_VERSION_BYTE = 0x41;
/** Hard cap before any parsing — rejects oversized payloads cheaply. */
const MAX_INPUT_LENGTH = 128;

const sha256 = (data: Buffer): Buffer => createHash('sha256').update(data).digest();

/**
 * Full Tron address validation (Base58Check), equivalent to TronWeb's
 * `isAddress` for base58 addresses:
 *   1. non-empty string            4. only Base58 characters
 *   2. starts with "T"             5. version byte 0x41
 *   3. exactly 34 characters       6. double-SHA256 checksum matches
 *
 * Dependency-free and synchronous so it can run on every request.
 */
export function validateTronAddress(input: unknown): AddressValidation {
  if (typeof input !== 'string' || input.trim() === '') {
    return { valid: false, addressType: 'UNKNOWN', reason: 'Address is required.' };
  }
  const address = input.trim();
  if (address.length > MAX_INPUT_LENGTH) {
    return { valid: false, addressType: 'UNKNOWN', reason: 'Address is too long.' };
  }
  if (!address.startsWith('T')) {
    return { valid: false, addressType: 'UNKNOWN', reason: 'Tron addresses start with "T".' };
  }
  if (address.length !== 34) {
    return {
      valid: false,
      addressType: 'UNKNOWN',
      reason: `Tron addresses are exactly 34 characters long (got ${address.length}).`,
    };
  }
  if (!BASE58_RE.test(address)) {
    return {
      valid: false,
      addressType: 'UNKNOWN',
      reason: 'Address contains characters that are not valid Base58 (0, O, I and l are not allowed).',
    };
  }

  // Base58 → 25 bytes: [version (1)] [payload (20)] [checksum (4)].
  let value = 0n;
  for (const char of address) {
    value = value * 58n + BigInt(BASE58_ALPHABET.indexOf(char));
  }
  const hex = value.toString(16).padStart(50, '0');
  if (hex.length !== 50) {
    return { valid: false, addressType: 'TRON', reason: 'Address does not decode to 25 bytes.' };
  }
  const bytes = Buffer.from(hex, 'hex');
  if (bytes[0] !== TRON_VERSION_BYTE) {
    return { valid: false, addressType: 'TRON', reason: 'Address has an invalid Tron version byte.' };
  }
  const expected = sha256(sha256(bytes.subarray(0, 21))).subarray(0, 4);
  if (!expected.equals(bytes.subarray(21))) {
    return {
      valid: false,
      addressType: 'TRON',
      reason: 'Address checksum is invalid — check the address for typos.',
    };
  }
  return { valid: true, addressType: 'TRON' };
}

export function isValidTronAddress(input: unknown): boolean {
  return validateTronAddress(input).valid;
}
