import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GROUP_COLOR, GROUP_MEMBERS, GROUP_ORDER, type Group } from '../game/board';
import type { Action, Party, Player, Snapshot } from '../game/engine';
import { cardDigits, money } from '../format';

export type Dispatch = (a: Action) => boolean;

export function Sheet({
  title,
  onClose,
  onBack,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (onBack ?? onClose)();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          {onBack ? (
            <button className="icon-btn" onClick={onBack} aria-label="Back">
              ‹
            </button>
          ) : (
            <span className="icon-spacer" />
          )}
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

const BILLS = [1, 5, 10, 20, 50, 100, 500];

/** Keypad for entering a dollar amount, with bill buttons that add like counting cash. */
export function AmountPad({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const press = (d: string) => {
    const next = Number(String(value) + d);
    if (next <= 99999) onChange(next);
  };
  return (
    <div className="amount-pad">
      <div className={`amount-display ${value ? '' : 'muted'}`}>{money(value)}</div>
      <div className="bills">
        {BILLS.map((b) => (
          <button key={b} className={`bill bill-${b}`} onClick={() => onChange(Math.min(value + b, 99999))}>
            +{b}
          </button>
        ))}
      </div>
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button onClick={() => onChange(0)} className="key-muted">
          C
        </button>
        <button onClick={() => press('0')}>0</button>
        <button onClick={() => onChange(Math.floor(value / 10))} className="key-muted" aria-label="Delete">
          ⌫
        </button>
      </div>
    </div>
  );
}

function ContactlessIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M8.5 8.5a5 5 0 0 1 0 7" />
      <path d="M12 6a8.5 8.5 0 0 1 0 12" />
      <path d="M15.5 3.5a12 12 0 0 1 0 17" />
    </svg>
  );
}

/** Tiny color bars showing which groups (and how many of each) a player owns. */
export function OwnedStrip({ state, player }: { state: Snapshot; player: string }) {
  const groups = GROUP_ORDER.map((g) => ({
    g,
    owned: GROUP_MEMBERS[g].filter((id) => state.holdings[id].owner === player).length,
    total: GROUP_MEMBERS[g].length,
  })).filter((x) => x.owned > 0);
  if (!groups.length) return <div className="owned-strip empty">No properties</div>;
  return (
    <div className="owned-strip">
      {groups.map(({ g, owned, total }) => (
        <span key={g} className="owned-group" title={`${owned}/${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`owned-pip ${i < owned ? 'on' : ''}`}
              style={{ '--pip': GROUP_COLOR[g as Group] } as CSSProperties}
            />
          ))}
        </span>
      ))}
    </div>
  );
}

export function DebitCard({
  player,
  state,
  onClick,
  compact,
  tag,
}: {
  player: Player;
  state: Snapshot;
  onClick?: () => void;
  compact?: boolean;
  /** Small label such as "You". */
  tag?: string;
}) {
  const prev = useRef(player.balance);
  const [delta, setDelta] = useState<{ n: number; k: number } | null>(null);
  useEffect(() => {
    const d = player.balance - prev.current;
    prev.current = player.balance;
    if (!d) return;
    setDelta({ n: d, k: Date.now() });
    const t = setTimeout(() => setDelta(null), 1600);
    return () => clearTimeout(t);
  }, [player.balance]);

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`debit-card ${compact ? 'compact' : ''} ${player.bankrupt ? 'bankrupt' : ''}`}
      style={{ '--card': player.color } as CSSProperties}
      onClick={onClick}
    >
      <div className="card-top">
        <span className="card-brand">BANKROLL</span>
        <ContactlessIcon />
      </div>
      <div className="card-mid">
        <span className="chip" aria-hidden />
        <div className="card-balance">
          {money(player.balance)}
          {delta && (
            <span key={delta.k} className={`delta ${delta.n > 0 ? 'up' : 'down'}`}>
              {delta.n > 0 ? '+' : '−'}${Math.abs(delta.n).toLocaleString('en-US')}
            </span>
          )}
        </div>
      </div>
      <div className="card-bottom">
        <span className="card-name">{player.name}</span>
        <span className="card-number">•••• {cardDigits(player.id, player.name)}</span>
      </div>
      {!compact && <OwnedStrip state={state} player={player.id} />}
      <div className="card-badges">
        {tag && <span className="badge tag">{tag}</span>}
        {player.balance < 0 && !player.bankrupt && <span className="badge danger">In debt</span>}
        {player.jailCards > 0 && <span className="badge">🔑 Jail free ×{player.jailCards}</span>}
      </div>
      {player.bankrupt && <span className="stamp">Bankrupt</span>}
    </Tag>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="number-row">
      <span>{label}</span>
      <span className="number-input">
        $
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
      </span>
    </label>
  );
}

export function GroupDot({ group }: { group: Group }) {
  return <span className="group-dot" style={{ background: GROUP_COLOR[group] }} />;
}

export function PlayerChips({ players, value, onChange }: { players: Player[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="chips">
      {players.map((p) => (
        <button
          key={p.id}
          className={`chip-btn ${value === p.id ? 'on' : ''}`}
          style={{ '--chip': p.color } as CSSProperties}
          onClick={() => onChange(p.id)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

/** Chip picker over any account: players, the bank, or the Free Parking pot. */
export function PartyChips({
  state,
  parties,
  value,
  onChange,
}: {
  state: Snapshot;
  parties: Party[];
  value: Party;
  onChange: (p: Party) => void;
}) {
  return (
    <div className="chips">
      {parties.map((p) => (
        <button
          key={p}
          className={`chip-btn ${value === p ? 'on' : ''}`}
          style={{ '--chip': state.players.find((x) => x.id === p)?.color } as CSSProperties}
          onClick={() => onChange(p)}
        >
          {p === 'bank' ? 'Bank' : p === 'parking' ? 'Free Parking' : state.players.find((x) => x.id === p)?.name}
        </button>
      ))}
    </div>
  );
}
