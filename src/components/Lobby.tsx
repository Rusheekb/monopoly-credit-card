import { useMemo, useState, type CSSProperties } from 'react';
import qrcode from 'qrcode-generator';
import type { GameState, Player } from '../game/engine';
import { PROPERTY_BY_ID } from '../game/board';
import type { View } from '../net/controller';
import { CODE_LENGTH, isValidCode, joinLink, normalizeCode, type PendingTrade } from '../net/protocol';
import { money } from '../format';
import { Sheet } from './ui';

export function Home({ onHost, onJoin, onLocal }: { onHost: () => void; onJoin: () => void; onLocal: () => void }) {
  return (
    <main className="setup">
      <div className="hero">
        <div className="hero-card" aria-hidden>
          <span className="chip" />
        </div>
        <h1>Bankroll</h1>
        <p>Ditch the paper money. Every player gets a debit card, and the bank lives on your phones.</p>
      </div>
      <button className="choice" onClick={onHost}>
        <span className="choice-icon">📡</span>
        <span>
          <strong>Host a game</strong>
          <small>Set up the players, then everyone joins from their own phone with a code.</small>
        </span>
      </button>
      <button className="choice" onClick={onJoin}>
        <span className="choice-icon">🔗</span>
        <span>
          <strong>Join a game</strong>
          <small>Enter the code shown on the host’s screen.</small>
        </span>
      </button>
      <button className="choice" onClick={onLocal}>
        <span className="choice-icon">📱</span>
        <span>
          <strong>Single device</strong>
          <small>One phone acts as the bank and gets passed around.</small>
        </span>
      </button>
    </main>
  );
}

export function JoinScreen({ initial, onJoin, onBack }: { initial: string; onJoin: (code: string) => void; onBack: () => void }) {
  const [code, setCode] = useState(normalizeCode(initial));
  const ok = isValidCode(code);
  return (
    <main className="setup">
      <button className="link-back" onClick={onBack}>
        ‹ Back
      </button>
      <div className="hero">
        <h1>Join a game</h1>
        <p>Type the {CODE_LENGTH}-character room code from the host’s screen, or scan their QR code with your camera.</p>
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onJoin(code);
        }}
      >
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          placeholder={'•'.repeat(CODE_LENGTH)}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          aria-label="Room code"
        />
        <button className="btn primary big" disabled={!ok}>
          Join
        </button>
      </form>
    </main>
  );
}

export function StatusScreen({ title, text, action, onAction }: { title: string; text?: string; action: string; onAction: () => void }) {
  return (
    <main className="setup">
      <div className="hero">
        <div className="spinner" aria-hidden />
        <h1 className="small-title">{title}</h1>
        {text && <p>{text}</p>}
      </div>
      <button className="btn ghost" onClick={onAction}>
        {action}
      </button>
    </main>
  );
}

function seatState(view: View, p: Player): { label: string; free: boolean; mine: boolean } {
  const holder = view.room?.seats[p.id];
  if (!holder) return { label: 'Open', free: true, mine: false };
  if (holder === view.clientId) return { label: 'This device', free: true, mine: true };
  if (view.room?.online.includes(holder)) return { label: holder === view.room.hostId ? 'Host’s device' : 'On another phone', free: false, mine: false };
  return { label: 'Disconnected', free: true, mine: false };
}

/** Pick which player this device is. */
export function SeatList({ view, onPick, choosing }: { view: View; onPick: (seat: string | null) => void; choosing?: boolean }) {
  const game = view.game!;
  return (
    <div className="seat-list">
      {game.players.map((p) => {
        const s = seatState(view, p);
        return (
          <button
            key={p.id}
            className={`seat ${s.mine ? 'on' : ''}`}
            style={{ '--chip': p.color } as CSSProperties}
            disabled={!s.free || p.bankrupt}
            onClick={() => onPick(p.id)}
          >
            <span className="seat-swatch" />
            <span className="seat-name">{p.name}</span>
            <span className="seat-state">{p.bankrupt ? 'Bankrupt' : s.label}</span>
          </button>
        );
      })}
      <button className={`seat ${view.seat === null && !choosing ? 'on' : ''}`} onClick={() => onPick(null)}>
        <span className="seat-swatch none" />
        <span className="seat-name">{view.mode === 'host' ? 'Banker only' : 'Just watching'}</span>
        <span className="seat-state">{view.mode === 'host' ? 'Can still act on every card' : 'View only'}</span>
      </button>
    </div>
  );
}

export function SeatPicker({ view, onPick, onLeave }: { view: View; onPick: (seat: string | null) => void; onLeave: () => void }) {
  return (
    <main className="setup">
      <div className="hero">
        <h1 className="small-title">Who are you?</h1>
        <p>Connected to room {view.room?.code}. Pick your player — your card will be on this phone.</p>
      </div>
      <SeatList view={view} onPick={onPick} choosing />
      <button className="btn ghost" onClick={onLeave}>
        Leave
      </button>
    </main>
  );
}

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function RoomSheet({
  view,
  onClose,
  onPick,
  onLeave,
}: {
  view: View;
  onClose: () => void;
  onPick: (seat: string | null) => void;
  onLeave: () => void;
}) {
  const room = view.room!;
  const link = joinLink(room.code);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Join my Bankroll game', text: `Room code ${room.code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      // Share sheet dismissed.
    }
  };
  const devices = room.online.length;
  return (
    <Sheet title={`Room ${room.code}`} onClose={onClose}>
      <div className="room-invite">
        <Qr text={link} />
        <div>
          <p className="muted small">Room code</p>
          <div className="room-code">{room.code}</div>
          <p className="muted small">
            {devices} device{devices === 1 ? '' : 's'} connected
          </p>
          <button className="btn small" onClick={share}>
            {copied ? 'Link copied' : 'Share invite link'}
          </button>
        </div>
      </div>
      <h3 className="section-title">This device plays as</h3>
      <SeatList view={view} onPick={onPick} />
      <button className="btn danger" onClick={onLeave}>
        {view.mode === 'host' ? 'End game for everyone' : 'Leave game'}
      </button>
    </Sheet>
  );
}

function tradeLines(game: GameState, side: { cash: number; props: string[]; jailCards: number }): string[] {
  const lines = side.props.map((id) => PROPERTY_BY_ID[id].name + (game.holdings[id].mortgaged ? ' (mortgaged)' : ''));
  if (side.cash) lines.unshift(money(side.cash));
  if (side.jailCards) lines.push('Get Out of Jail Free card');
  return lines.length ? lines : ['Nothing'];
}

export function TradeOffer({
  game,
  trade,
  onReply,
}: {
  game: GameState;
  trade: PendingTrade;
  onReply: (accept: boolean) => void;
}) {
  const a = game.players.find((p) => p.id === trade.action.a)!;
  return (
    <Sheet title="Trade offer" onClose={() => onReply(false)}>
      <p className="center-text">
        <strong>{a.name}</strong> wants to trade with you.
      </p>
      <div className="trade-grid">
        <div className="trade-side" style={{ '--chip': a.color } as CSSProperties}>
          <h4>You get</h4>
          {tradeLines(game, trade.action.aGives).map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
        <div className="trade-side">
          <h4>You give</h4>
          {tradeLines(game, trade.action.bGives).map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      </div>
      <button className="btn primary big" onClick={() => onReply(true)}>
        Accept trade
      </button>
      <button className="btn ghost" onClick={() => onReply(false)}>
        Decline
      </button>
    </Sheet>
  );
}
