import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  activePlayers,
  buildingsInBank,
  describeTransfers,
  newGame,
  playerName,
  type Action,
  type GameState,
  type Party,
  type Tx,
} from './game/engine';
import { clientId, loadGame, loadSession, saveGame, saveSession } from './storage';
import { money } from './format';
import { GuestController, HostController, LocalController, type Controller, type View } from './net/controller';
import { isValidCode, newRoomCode, normalizeCode } from './net/protocol';
import { Setup, SettingsForm } from './components/Setup';
import { PlayerInfo, Terminal } from './components/Terminal';
import { Home, JoinScreen, RoomSheet, SeatPicker, StatusScreen, TradeOffer } from './components/Lobby';
import { AmountPad, DebitCard, PartyChips, Sheet } from './components/ui';

type Screen = 'home' | 'host' | 'local' | 'join';

/** Room code from an invite link (#join=CODE), if any. */
function codeFromHash(): string | null {
  const m = window.location.hash.match(/join=([A-Za-z0-9]+)/);
  const code = m ? normalizeCode(m[1]) : null;
  return code && isValidCode(code) ? code : null;
}

function clearHash() {
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
}

function restore(): Controller | null {
  const session = loadSession();
  const invite = codeFromHash();
  if (invite && !(session?.mode === 'guest' && session.code === invite)) return null;
  clearHash();
  const game = loadGame();
  if (session?.mode === 'local' && game) return new LocalController(game, clientId());
  if (session?.mode === 'host' && game && session.code) return new HostController(game, session.code, clientId(), session.seats);
  if (session?.mode === 'guest' && session.code) return new GuestController(session.code, clientId());
  return null;
}

// Created once at startup (not in a state initializer, which StrictMode runs twice).
const restored = restore();

export default function App() {
  const [ctrl, setCtrl] = useState<Controller | null>(restored);
  const [screen, setScreen] = useState<Screen>(() => (codeFromHash() ? 'join' : 'home'));

  const replace = (c: Controller) => {
    ctrl?.destroy();
    setCtrl(c);
  };

  const leave = (c: Controller) => {
    if (c instanceof HostController) c.end();
    else c.destroy();
    saveGame(null);
    saveSession(null);
    setCtrl(null);
    setScreen('home');
    window.scrollTo(0, 0);
  };

  if (ctrl) return <Session key={ctrl.getView().mode + ctrl.getView().clientId} ctrl={ctrl} onLeave={() => leave(ctrl)} onReplace={replace} />;

  switch (screen) {
    case 'home':
      return <Home onHost={() => setScreen('host')} onJoin={() => setScreen('join')} onLocal={() => setScreen('local')} />;
    case 'join':
      return (
        <JoinScreen
          initial={codeFromHash() ?? ''}
          onBack={() => {
            clearHash();
            setScreen('home');
          }}
          onJoin={(code) => {
            if (loadGame() && !confirm('Joining will end the game saved on this device. Continue?')) return;
            clearHash();
            saveGame(null);
            setCtrl(new GuestController(code, clientId()));
          }}
        />
      );
    case 'host':
    case 'local':
      return (
        <Setup
          hosting={screen === 'host'}
          onBack={() => setScreen('home')}
          onStart={(players, settings) => {
            const game = newGame(players, settings);
            setCtrl(screen === 'host' ? new HostController(game, newRoomCode(), clientId()) : new LocalController(game, clientId()));
            window.scrollTo(0, 0);
          }}
        />
      );
  }
}

function Session({ ctrl, onLeave, onReplace }: { ctrl: Controller; onLeave: () => void; onReplace: (c: Controller) => void }) {
  const view = useSyncExternalStore(ctrl.subscribe, ctrl.getView);
  const [watching, setWatching] = useState(false);

  if (view.status === 'ended') {
    return <StatusScreen title="Game over" text={view.statusText} action="Back to start" onAction={onLeave} />;
  }
  if (!view.game) {
    return <StatusScreen title="Joining game…" text={view.statusText ?? 'Connecting to the host.'} action="Cancel" onAction={onLeave} />;
  }
  if (view.mode === 'guest' && !view.seat && !watching) {
    return (
      <SeatPicker
        view={view}
        onLeave={onLeave}
        onPick={(seat) => {
          if (seat) ctrl.claimSeat(seat);
          else setWatching(true);
        }}
      />
    );
  }
  return <GameScreen ctrl={ctrl} view={view} game={view.game} onLeave={onLeave} onReplace={onReplace} />;
}

type Overlay = { kind: 'player'; id: string } | { kind: 'transfer' } | { kind: 'history' } | { kind: 'menu' } | { kind: 'room' } | null;
type Toast = { id: number; text: string; detail?: string; error?: boolean };

/** Shows a toast whenever a transaction lands or is undone, whoever made it. */
function useLogToasts(game: GameState, show: (t: Toast) => void) {
  const last = useRef<Tx | undefined>(game.log.at(-1));
  useEffect(() => {
    const prev = last.current;
    const cur = game.log.at(-1);
    last.current = cur;
    if (cur?.id === prev?.id) return;
    if (cur && (!prev || cur.id > prev.id)) {
      show({ id: Date.now(), text: cur.label, detail: describeTransfers(game, cur).join(' · ') });
      navigator.vibrate?.(20);
    } else if (prev) {
      show({ id: Date.now(), text: `Undone: ${prev.label}` });
    }
  }, [game, show]);
}

function GameScreen({
  ctrl,
  view,
  game,
  onLeave,
  onReplace,
}: {
  ctrl: Controller;
  view: View;
  game: GameState;
  onLeave: () => void;
  onReplace: (c: Controller) => void;
}) {
  const [overlay, setOverlay] = useState<Overlay>(() => (view.mode === 'host' && !game.log.length ? { kind: 'room' } : null));
  const [toast, setToast] = useState<Toast | null>(null);

  useLogToasts(game, setToast);
  useEffect(
    () =>
      ctrl.onNotice((n) => {
        setToast({ id: Date.now(), text: n.text, error: n.error });
        if (n.error) navigator.vibrate?.([30, 40, 30]);
      }),
    [ctrl],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 3500 : 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const dispatch = (a: Action) => ctrl.dispatch(a);
  const room = view.room;
  const bank = buildingsInBank(game);
  const s = game.settings;
  const active = activePlayers(game);
  const winner = active.length === 1 && game.players.length > 1 ? active[0] : null;
  const remoteSeats = room
    ? Object.keys(room.seats).filter((p) => room.seats[p] !== view.clientId && room.online.includes(room.seats[p]))
    : [];
  const seatOnline = (pid: string) => remoteSeats.includes(pid) || room?.seats[pid] === view.clientId;
  const players = [...game.players].sort((a, b) => Number(b.id === view.seat) - Number(a.id === view.seat));
  const trade = room?.trade;
  const offerForMe = trade && trade.action.b === view.seat && room.seats[trade.action.b] === view.clientId ? trade : null;
  const myOffer = trade && (trade.by === view.clientId || view.mode === 'host') && !offerForMe ? trade : null;

  const openCard = (id: string) => setOverlay({ kind: 'player', id });
  const hint = view.isBanker
    ? 'Tap any card to pay, collect, buy, build and more.'
    : view.seat
      ? 'Tap your card to pay, collect, buy and build. Tap others to see their properties.'
      : 'You’re watching. Tap a card to see that player’s properties.';

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">Bankroll</span>
        <div className="topbar-actions">
          {room && (
            <button className={`room-chip ${view.status}`} onClick={() => setOverlay({ kind: 'room' })} title="Room and players">
              <span className="dot" />
              {room.code}
            </button>
          )}
          <button className="icon-btn" onClick={() => ctrl.undo()} disabled={!view.canUndo} aria-label="Undo" title="Undo">
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

      {view.status !== 'online' && <div className="conn-banner">{view.statusText ?? 'Connecting…'}</div>}

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

      {myOffer && (
        <div className="trade-banner">
          <span>
            Waiting for <strong>{playerName(game, myOffer.action.b)}</strong> to answer {myOffer.by === view.clientId ? 'your' : `${playerName(game, myOffer.action.a)}’s`} trade offer…
          </span>
          <button className="btn small" onClick={() => ctrl.cancelTrade(myOffer.id)}>
            Cancel
          </button>
        </div>
      )}

      <main className="cards">
        {players.map((p) => (
          <DebitCard
            key={p.id}
            player={p}
            state={game}
            onClick={() => openCard(p.id)}
            tag={p.id === view.seat ? 'You' : room && seatOnline(p.id) ? '📱 Connected' : undefined}
          />
        ))}
      </main>

      <p className="hint">{hint}</p>

      {view.isBanker && (
        <button className="fab" onClick={() => setOverlay({ kind: 'transfer' })}>
          ⇄ Transfer
        </button>
      )}

      {overlay?.kind === 'player' &&
        (view.isBanker || overlay.id === view.seat ? (
          <Terminal game={game} playerId={overlay.id} dispatch={dispatch} remoteSeats={remoteSeats} onClose={() => setOverlay(null)} />
        ) : (
          <PlayerInfo game={game} playerId={overlay.id} onClose={() => setOverlay(null)} />
        ))}
      {overlay?.kind === 'transfer' && <TransferSheet game={game} dispatch={dispatch} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'history' && (
        <HistorySheet game={game} canUndo={view.canUndo} onUndo={() => ctrl.undo()} onClose={() => setOverlay(null)} />
      )}
      {overlay?.kind === 'room' && room && (
        <RoomSheet view={view} onClose={() => setOverlay(null)} onPick={(seat) => ctrl.claimSeat(seat)} onLeave={() => confirmLeave(view, onLeave)} />
      )}
      {overlay?.kind === 'menu' && (
        <Sheet title={view.mode === 'guest' ? 'Game' : 'Settings'} onClose={() => setOverlay(null)}>
          {view.isBanker ? (
            <SettingsForm settings={s} inGame onChange={(x) => dispatch({ type: 'settings', settings: x })} />
          ) : (
            <p className="muted">Only the host can change the rules.</p>
          )}
          {view.mode === 'local' && (
            <button
              className="btn primary"
              onClick={() => {
                onReplace(new HostController(game, newRoomCode(), view.clientId));
              }}
            >
              📡 Let players join from their phones
            </button>
          )}
          <button className="btn danger" onClick={() => confirmLeave(view, onLeave)}>
            {view.mode === 'guest' ? 'Leave game' : view.mode === 'host' ? 'End game for everyone' : 'End game & start over'}
          </button>
        </Sheet>
      )}

      {offerForMe && <TradeOffer game={game} trade={offerForMe} onReply={(ok) => ctrl.replyTrade(offerForMe.id, ok)} />}

      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} key={toast.id} role="status">
          <span className="toast-icon">{toast.error ? '!' : '✓'}</span>
          <span className="toast-text">
            <strong>{toast.text}</strong>
            {toast.detail && <small>{toast.detail}</small>}
          </span>
          {!toast.error && view.canUndo && (
            <button className="toast-undo" onClick={() => ctrl.undo()}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function confirmLeave(view: View, onLeave: () => void) {
  const msg =
    view.mode === 'guest'
      ? 'Leave this game? You can rejoin with the room code.'
      : view.mode === 'host'
        ? 'End this game for everyone? Balances and history will be cleared.'
        : 'End this game and start a new one? Balances and history will be cleared.';
  if (confirm(msg)) onLeave();
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

function HistorySheet({ game, canUndo, onUndo, onClose }: { game: GameState; canUndo: boolean; onUndo: () => void; onClose: () => void }) {
  const log = [...game.log].reverse();
  return (
    <Sheet title="History" onClose={onClose}>
      <button className="btn ghost" onClick={onUndo} disabled={!canUndo}>
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
