import type { GameState } from './game/engine';

const GAME_KEY = 'bankroll.game.v1';
const SESSION_KEY = 'bankroll.session.v1';
const CLIENT_KEY = 'bankroll.client.v1';

export type SessionMode = 'local' | 'host' | 'guest';

export interface Session {
  mode: SessionMode;
  /** Room code when hosting or joined. */
  code?: string;
  /** Host only: which device plays which seat, so seats survive a reload. */
  seats?: Record<string, string>;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: keep running in memory.
  }
}

export function loadGame(): GameState | null {
  const g = read<GameState>(GAME_KEY);
  return g?.version === 1 && Array.isArray(g.players) ? g : null;
}

export const saveGame = (game: GameState | null) => write(GAME_KEY, game);

export function loadSession(): Session | null {
  const s = read<Session>(SESSION_KEY);
  if (s?.mode) return s;
  // Games saved before multiplayer existed are single-device games.
  return loadGame() ? { mode: 'local' } : null;
}

export const saveSession = (s: Session | null) => write(SESSION_KEY, s);

/** A stable id for this browser, so a device keeps its seat when it reconnects. */
export function clientId(): string {
  let id = read<string>(CLIENT_KEY);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    write(CLIENT_KEY, id);
  }
  return id;
}
