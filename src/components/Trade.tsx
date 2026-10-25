import { useState, type CSSProperties } from 'react';
import { GROUP_MEMBERS } from '../game/board';
import { activePlayers, mortgageInterest, ownedBy, type Action, type GameState, type Player, type TradeSide } from '../game/engine';
import { money } from '../format';
import { GroupDot, PlayerChips, type Dispatch } from './ui';

const empty = (): TradeSide => ({ cash: 0, props: [], jailCards: 0 });

function Side({ game, player, side, onChange }: { game: GameState; player: Player; side: TradeSide; onChange: (s: TradeSide) => void }) {
  const owned = ownedBy(game, player.id);
  const toggle = (id: string) =>
    onChange({ ...side, props: side.props.includes(id) ? side.props.filter((x) => x !== id) : [...side.props, id] });
  return (
    <div className="trade-side" style={{ '--chip': player.color } as CSSProperties}>
      <h4>{player.name} gives</h4>
      <label className="number-row">
        <span>Cash (has {money(player.balance)})</span>
        <span className="number-input">
          $
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={side.cash || ''}
            placeholder="0"
            onChange={(e) => onChange({ ...side, cash: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          />
        </span>
      </label>
      {player.jailCards > 0 && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={side.jailCards > 0}
            onChange={(e) => onChange({ ...side, jailCards: e.target.checked ? 1 : 0 })}
          />
          Get Out of Jail Free card
        </label>
      )}
      {owned.length === 0 && <p className="muted small">No properties</p>}
      {owned.map((p) => {
        const h = game.holdings[p.id];
        const built = GROUP_MEMBERS[p.group].some((id) => game.holdings[id].houses > 0);
        return (
          <label key={p.id} className={`check-row ${built ? 'disabled' : ''}`}>
            <input type="checkbox" disabled={built} checked={side.props.includes(p.id)} onChange={() => toggle(p.id)} />
            <GroupDot group={p.group} />
            <span>
              {p.name}
              {h.mortgaged && <small> mortgaged · +{money(mortgageInterest(p))} interest</small>}
              {built && <small> sell group's buildings first</small>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function TradeView({ game, me, finish }: { game: GameState; me: Player; dispatch: Dispatch; finish: (a: Action) => void }) {
  const others = activePlayers(game).filter((p) => p.id !== me.id);
  const [partner, setPartner] = useState(others[0]?.id ?? '');
  const [mine, setMine] = useState(empty);
  const [theirs, setTheirs] = useState(empty);
  if (!others.length) return <p className="muted center">No one to trade with.</p>;
  const them = game.players.find((p) => p.id === partner)!;
  const pick = (id: string) => {
    setPartner(id);
    setTheirs(empty());
  };
  const nothing = !mine.cash && !theirs.cash && !mine.props.length && !theirs.props.length && !mine.jailCards && !theirs.jailCards;

  return (
    <div className="stack">
      <p className="muted small">Trade with</p>
      <PlayerChips players={others} value={partner} onChange={pick} />
      <div className="trade-grid">
        <Side game={game} player={me} side={mine} onChange={setMine} />
        <Side game={game} player={them} side={theirs} onChange={setTheirs} />
      </div>
      <button
        className="btn primary big"
        disabled={nothing}
        onClick={() => finish({ type: 'trade', a: me.id, b: them.id, aGives: mine, bGives: theirs })}
      >
        Both agree — make the trade
      </button>
    </div>
  );
}
