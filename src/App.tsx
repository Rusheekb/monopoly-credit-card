import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activePlayers,
  apply,
  buildingsInBank,
  describeTransfers,
  newGame,
  playerName,
  undo,
  type Action,
  type GameState,
  type Party,
} from './game/engine';
import { loadGame, saveGame } from './storage';
import { money } from './format';
import { Setup, SettingsForm } from './components/Setup';
import { Terminal } from './components/Terminal';
import { AmountPad, DebitCard, PartyChips, Sheet } from './components/ui';

type Overlay = { kind: 'player'; id: string } | { kind: 'transfer' } | { kind: 'history' } | { kind: 'menu' } | null;
type Toast = { id: number; text: string; detail?: string; error?: boolean };

export default function App() {
  const [game, setGame] = useState<GameState | null>(loadGame);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  useEffect(() => saveGame(game), [game]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 3500 : 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const dispatch = useCallback((action: Action): boolean => {
    const g = gameRef.current;
    if (!g) return false;
    const r = apply(g, action);
    if (!r.ok) {
      setToast({ id: Date.now(), text: r.error, error: true });
      navigator.vibrate?.([30, 40, 30]);
      return false;
    }
    gameRef.current = r.state;
    setGame(r.state);
    if (r.tx) {
      setToast({ id: r.tx.id, text: r.tx.label, detail: describeTransfers(r.state, r.tx).join(' · ') });
      navigator.vibrate?.(20);
    }
    return true;
  }, []);

  const doUndo = () => {
    const g = gameRef.current;
    const prev = g && undo(g);
    if (!prev) return;
    const undone = g.log.length > prev.log.length ? g.log.at(-1) : undefined;
    setGame(prev);
    setToast({ id: Date.now(), text: undone ? `Undid: ${undone.label}` : 'Undid last change' });
  };

  if (!game) {
    return (
      <Setup
        onStart={(players, settings) => {
          setGame(newGame(players, settings));
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  const bank = buildingsInBank(game);
  const s = game.settings;
  const winner = activePlayers(game).length === 1 && game.players.length > 1 ? activePlayers(game)[0] : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">Bankroll</span>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={doUndo} disabled={!game.past.length} aria-label="Undo" title="Undo">
            ↶
          </button>
          <button className="icon-btn" onClick={() => setOverlay({ kind: 'history' })} aria-label="History" title="History">
            ☰
          </button>
          <button className="icon-btn" onClick={() => setOverlay({ kind: 'menu' })} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      <div className="bank-strip">
        <span>🏦 Bank</span>
        {s.limitedBuildings && (
          <span>
            <span className="house" /> {bank.houses} <span className="hotel" /> {bank.hotels}
          </span>
        )}
        {s.freeParkingJackpot && <span className="pot">🅿️ Pot {money(game.parking)}</span>}
      </div>

      {winner && (
        <div className="winner">
          🏆 <strong>{winner.name}</strong> wins with {money(winner.balance)}!
        </div>
      )}

      <main className="cards">
        {game.players.map((p) => (
          <DebitCard key={p.id} player={p} state={game} onClick={() => setOverlay({ kind: 'player', id: p.id })} />
        ))}
      </main>

      <p className="hint">Tap a card to pay, collect, buy, build and more.</p>

      <button className="fab" onClick={() => setOverlay({ kind: 'transfer' })}>
        ⇄ Transfer
      </button>

      {overlay?.kind === 'player' && (
        <Terminal game={game} playerId={overlay.id} dispatch={dispatch} onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'transfer' && <TransferSheet game={game} dispatch={dispatch} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'history' && <HistorySheet game={game} onUndo={doUndo} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'menu' && (
        <Sheet title="Settings" onClose={() => setOverlay(null)}>
          <SettingsForm settings={s} inGame onChange={(x) => dispatch({ type: 'settings', settings: x })} />
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('End this game and start a new one? Balances and history will be cleared.')) {
                setOverlay(null);
                setGame(null);
              }
            }}
          >
            End game &amp; start over
          </button>
        </Sheet>
      )}

      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} key={toast.id} role="status">
          <span className="toast-icon">{toast.error ? '!' : '✓'}</span>
          <span className="toast-text">
            <strong>{toast.text}</strong>
            {toast.detail && <small>{toast.detail}</small>}
          </span>
          {!toast.error && game.past.length > 0 && (
            <button className="toast-undo" onClick={doUndo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TransferSheet({ game, dispatch, onClose }: { game: GameState; dispatch: (a: Action) => boolean; onClose: () => void }) {
  const parties: Party[] = [...activePlayers(game).map((p) => p.id), 'bank', ...(game.settings.freeParkingJackpot ? ['parking' as const] : [])];
  const [from, setFrom] = useState<Party>(parties[0]);
  const [to, setTo] = useState<Party>(parties[1]);
  const [amount, setAmount] = useState(0);
  return (
    <Sheet title="Transfer money" onClose={onClose}>
      <div className="stack">
        <p className="muted small">From</p>
        <PartyChips state={game} parties={parties} value={from} onChange={setFrom} />
        <p className="muted small">To</p>
        <PartyChips state={game} parties={parties} value={to} onChange={setTo} />
        <AmountPad value={amount} onChange={setAmount} />
        <button
          className="btn primary big"
          disabled={!amount || from === to}
          onClick={() => {
            if (dispatch({ type: 'transfer', from, to, amount, note: 'Transfer' })) onClose();
          }}
        >
          {from === to ? 'Pick two different accounts' : `Send ${money(amount)} · ${playerName(game, from)} → ${playerName(game, to)}`}
        </button>
      </div>
    </Sheet>
  );
}

function HistorySheet({ game, onUndo, onClose }: { game: GameState; onUndo: () => void; onClose: () => void }) {
  const log = [...game.log].reverse();
  return (
    <Sheet title="History" onClose={onClose}>
      <button className="btn ghost" onClick={onUndo} disabled={!game.past.length}>
        ↶ Undo last
      </button>
      {!log.length && <p className="muted center">No transactions yet.</p>}
      <ol className="history">
        {log.map((tx) => (
          <li key={tx.id}>
            <div className="history-head">
              <strong>{tx.label}</strong>
              <time>{new Date(tx.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
            </div>
            {describeTransfers(game, tx).map((line, i) => (
              <div key={i} className="history-line">
                {line}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
