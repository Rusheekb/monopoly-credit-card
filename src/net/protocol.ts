import type { Action, GameState, PlayerId, Snapshot } from '../game/engine';

export const PROTOCOL_VERSION = 1;

export type TradeAction = Extract<Action, { type: 'trade' }>;

export interface PendingTrade {
  id: number;
  action: TradeAction;
  /** clientId of the device that proposed it. */
  by: string;
}

/** Everything about the room that isn't the game itself. */
export interface RoomView {
  code: string;
  hostId: string;
  /** playerId → clientId of the device playing that seat. */
  seats: Record<PlayerId, string>;
  /** clientIds currently connected, including the host. */
  online: string[];
  trade: PendingTrade | null;
  /** clientId behind the most recent undoable change, so guests can undo their own. */
  lastActor: string | null;
}

/** The game as sent to guests: no undo history, recent log only. */
export type GuestGame = Snapshot & Pick<GameState, 'version' | 'log'>;

export type ToHost =
  | { t: 'hello'; v: number; clientId: string }
  | { t: 'claim'; seat: PlayerId | null }
  | { t: 'action'; action: Action }
  | { t: 'undo' }
  | { t: 'tradeReply'; id: number; accept: boolean }
  | { t: 'tradeCancel'; id: number }
  | { t: 'ping' };

export type ToGuest =
  | { t: 'state'; game: GuestGame; room: RoomView }
  | { t: 'notice'; text: string; error?: boolean }
  | { t: 'ping' }
  | { t: 'ended' };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function newRoomCode(): string {
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, CODE_LENGTH);
}

export const isValidCode = (c: string) => c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));

export const peerIdFor = (code: string) => `bankroll-v1-${code}`;

export function joinLink(code: string): string {
  const url = new URL(window.location.href);
  url.hash = `join=${code}`;
  return url.toString();
}
