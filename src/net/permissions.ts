import type { Action, PlayerId, Snapshot } from '../game/engine';

/**
 * Whether the device playing `seat` may perform `action`. The host device is the
 * banker and may do anything; guests may only move their own money and property.
 */
export function guestMayPerform(state: Snapshot, seat: PlayerId | null, a: Action): boolean {
  if (!seat) return false;
  const owns = (prop: string) => state.holdings[prop]?.owner === seat;
  switch (a.type) {
    case 'transfer':
      return a.from === seat || ((a.from === 'bank' || a.from === 'parking') && a.to === seat);
    case 'passGo':
    case 'tax':
    case 'card':
    case 'jailFine':
    case 'useJailCard':
    case 'collectParking':
      return a.player === seat;
    case 'buy':
      // Anyone can record an auction result; only you can buy at list price for yourself.
      return a.player === seat || a.price !== undefined;
    case 'rent':
      return a.payer === seat;
    case 'build':
    case 'sellBuilding':
    case 'mortgage':
    case 'unmortgage':
      return owns(a.prop);
    case 'trade':
      return a.a === seat;
    case 'bankrupt':
      return a.player === seat;
    case 'settings':
      return false;
  }
}
