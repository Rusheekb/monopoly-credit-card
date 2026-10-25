import { describe, expect, it } from 'vitest';
import { apply, newGame, type Action } from '../game/engine';
import { guestMayPerform } from './permissions';

const base = newGame([
  { name: 'Ann', color: '#f00' },
  { name: 'Bob', color: '#0f0' },
]);
const r = apply(base, { type: 'buy', player: 'p1', prop: 'boardwalk' });
const game = r.ok ? r.state : base;

const may = (seat: string | null, a: Action) => guestMayPerform(game, seat, a);

describe('guestMayPerform', () => {
  it('lets spectators do nothing', () => {
    expect(may(null, { type: 'passGo', player: 'p1' })).toBe(false);
  });

  it('only moves your own money', () => {
    expect(may('p1', { type: 'transfer', from: 'p1', to: 'p2', amount: 5 })).toBe(true);
    expect(may('p1', { type: 'transfer', from: 'p2', to: 'p1', amount: 5 })).toBe(false);
    expect(may('p1', { type: 'transfer', from: 'bank', to: 'p1', amount: 5 })).toBe(true);
    expect(may('p1', { type: 'transfer', from: 'bank', to: 'p2', amount: 5 })).toBe(false);
    expect(may('p2', { type: 'rent', payer: 'p2', prop: 'boardwalk' })).toBe(true);
    expect(may('p1', { type: 'rent', payer: 'p2', prop: 'boardwalk' })).toBe(false);
    expect(may('p1', { type: 'passGo', player: 'p2' })).toBe(false);
  });

  it('manages only your own property', () => {
    expect(may('p1', { type: 'mortgage', prop: 'boardwalk' })).toBe(true);
    expect(may('p2', { type: 'mortgage', prop: 'boardwalk' })).toBe(false);
  });

  it('allows recording an auction for any winner but not list-price buys for others', () => {
    expect(may('p1', { type: 'buy', player: 'p2', prop: 'parkplace', price: 100 })).toBe(true);
    expect(may('p1', { type: 'buy', player: 'p2', prop: 'parkplace' })).toBe(false);
  });

  it('only proposes trades and bankruptcy for yourself, and never changes settings', () => {
    const side = { cash: 0, props: [], jailCards: 0 };
    expect(may('p1', { type: 'trade', a: 'p1', b: 'p2', aGives: side, bGives: side })).toBe(true);
    expect(may('p2', { type: 'trade', a: 'p1', b: 'p2', aGives: side, bGives: side })).toBe(false);
    expect(may('p2', { type: 'bankrupt', player: 'p1', creditor: 'bank' })).toBe(false);
    expect(may('p1', { type: 'settings', settings: { goSalary: 1000 } })).toBe(false);
  });
});
