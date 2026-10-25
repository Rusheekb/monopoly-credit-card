import type { GameState } from './game/engine';

const KEY = 'bankroll.game.v1';

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as GameState;
    return g?.version === 1 && Array.isArray(g.players) ? g : null;
  } catch {
    return null;
  }
}

export function saveGame(game: GameState | null) {
  try {
    if (game) localStorage.setItem(KEY, JSON.stringify(game));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage full or unavailable: the game keeps running in memory.
  }
}
