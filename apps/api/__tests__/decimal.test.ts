import { describe, it, expect } from 'vitest';
import { addDec, subDec, mulDec, divDec, gtDec, gteDec, ltDec, lteDec, eqDec, isZero } from '../src/utils/decimal.js';

describe('Decimal Arithmetic', () => {
  it('adds two decimals correctly', () => {
    expect(addDec('10.5', '5.25')).toBe('15.750000');
    expect(addDec('0.1', '0.2')).toBe('0.300000');
    expect(addDec('100', '0')).toBe('100.000000');
  });

  it('subtracts two decimals correctly', () => {
    expect(subDec('10.5', '5.25')).toBe('5.250000');
    expect(subDec('0', '100')).toBe('-100.000000');
  });

  it('multiplies two decimals correctly', () => {
    expect(mulDec('10', '2')).toBe('20.000000');
    expect(mulDec('0.5', '4')).toBe('2.000000');
  });

  it('divides two decimals correctly', () => {
    expect(divDec('10', '2')).toBe('5.000000');
    expect(divDec('10', '0')).toBe('0.000000');
  });

  it('compares decimals correctly', () => {
    expect(gtDec('10', '5')).toBe(true);
    expect(gtDec('5', '10')).toBe(false);
    expect(gteDec('10', '10')).toBe(true);
    expect(ltDec('5', '10')).toBe(true);
    expect(lteDec('10', '10')).toBe(true);
    expect(eqDec('10', '10')).toBe(true);
    expect(eqDec('10', '10.001')).toBe(false);
  });

  it('detects zero', () => {
    expect(isZero('0.000000')).toBe(true);
    expect(isZero('0')).toBe(true);
    expect(isZero('1')).toBe(false);
  });
});