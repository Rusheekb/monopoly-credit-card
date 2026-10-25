import { useState, type ReactNode } from 'react';
import { GROUP_LABEL, GROUP_MEMBERS, PROPERTIES, PROPERTY_BY_ID, type Property } from '../game/board';
import { CARDS, type Card } from '../game/cards';
import {
  activePlayers,
  buildingSaleValue,
  countOwnedInGroup,
  netWorth,
  ownedBy,
  ownsWholeGroup,
  playerName,
  rentFor,
  unmortgageCost,
  type Action,
  type GameState,
  type Party,
  type Player,
} from '../game/engine';
import { money } from '../format';
import { AmountPad, DebitCard, GroupDot, PlayerChips, Sheet, type Dispatch } from './ui';
import { TradeView } from './Trade';

type View = 'home' | 'rent' | 'buy' | 'cash' | 'tax' | 'chance' | 'chest' | 'jail' | 'props' | 'trade' | 'bankrupt';

const TITLES: Record<View, string> = {
  home: '',
  rent: 'Pay rent',
  buy: 'Buy property',
  cash: 'Pay or receive',
  tax: 'Pay tax',
  chance: 'Chance',
  chest: 'Community Chest',
  jail: 'Jail',
  props: 'My properties',
  trade: 'Trade',
  bankrupt: 'Bankruptcy',
};

export function Terminal({
  game,
  playerId,
  dispatch,
  onClose,
}: {
  game: GameState;
  playerId: string;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>('home');
  const me = game.players.find((p) => p.id === playerId)!;
  /** Dispatch and close the terminal on success. */
  const finish = (a: Action) => {
    if (dispatch(a)) onClose();
  };

  if (me.bankrupt) {
    return (
      <Sheet title={me.name} onClose={onClose}>
        <DebitCard player={me} state={game} compact />
        <p className="muted center">{me.name} is out of the game.</p>
      </Sheet>
    );
  }

  const props = { game, me, dispatch, finish };
  return (
    <Sheet
      title={view === 'home' ? me.name : TITLES[view]}
      onClose={onClose}
      onBack={view === 'home' ? undefined : () => setView('home')}
    >
      <DebitCard player={me} state={game} compact />
      {view === 'home' && <Home {...props} go={setView} />}
      {view === 'rent' && <RentView {...props} />}
      {view === 'buy' && <BuyView {...props} />}
      {view === 'cash' && <CashView {...props} />}
      {view === 'tax' && <TaxView {...props} />}
      {(view === 'chance' || view === 'chest') && <CardsView {...props} deck={view} />}
      {view === 'jail' && <JailView {...props} />}
      {view === 'props' && <PropsView {...props} />}
      {view === 'trade' && <TradeView {...props} />}
      {view === 'bankrupt' && <BankruptView {...props} />}
    </Sheet>
  );
}

interface ViewProps {
  game: GameState;
  me: Player;
  dispatch: Dispatch;
  finish: (a: Action) => void;
}

function Tile({ icon, label, sub, onClick, tone }: { icon: string; label: string; sub?: string; onClick: () => void; tone?: string }) {
  return (
    <button className={`tile ${tone ?? ''}`} onClick={onClick}>
      <span className="tile-icon" aria-hidden>
        {icon}
      </span>
      <span className="tile-label">{label}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </button>
  );
}

function Home({ game, me, finish, go }: ViewProps & { go: (v: View) => void }) {
  const s = game.settings;
  const owned = ownedBy(game, me.id).length;
  return (
    <div className="tiles">
      <Tile icon="➜" label="Pass GO" sub={`+${money(s.goSalary)}`} tone="good wide" onClick={() => finish({ type: 'passGo', player: me.id })} />
      {s.doubleGoOnLanding && (
        <Tile icon="⇉" label="Landed on GO" sub={`+${money(s.goSalary * 2)}`} tone="good" onClick={() => finish({ type: 'passGo', player: me.id, landed: true })} />
      )}
      <Tile icon="🏠" label="Pay rent" onClick={() => go('rent')} />
      <Tile icon="🏷️" label="Buy property" onClick={() => go('buy')} />
      <Tile icon="⇄" label="Pay / receive" sub="Players or bank" onClick={() => go('cash')} />
      <Tile icon="🧾" label="Tax" onClick={() => go('tax')} />
      <Tile icon="?" label="Chance" tone="chance" onClick={() => go('chance')} />
      <Tile icon="💰" label="Community Chest" tone="chest" onClick={() => go('chest')} />
      <Tile icon="🔒" label="Jail" sub={me.jailCards ? `${me.jailCards} free card` : `${money(s.jailFine)} fine`} onClick={() => go('jail')} />
      {s.freeParkingJackpot && (
        <Tile
          icon="🅿️"
          label="Free Parking"
          sub={game.parking ? `Collect ${money(game.parking)}` : 'Pot is empty'}
          tone={game.parking ? 'good' : ''}
          onClick={() => finish({ type: 'collectParking', player: me.id })}
        />
      )}
      <Tile icon="🏘️" label="Properties" sub={`${owned} owned · build, mortgage`} onClick={() => go('props')} />
      <Tile icon="🤝" label="Trade" onClick={() => go('trade')} />
      <Tile icon="✖" label="Bankrupt" tone="danger" onClick={() => go('bankrupt')} />
    </div>
  );
}

function ShortWarning({ me, amount }: { me: Player; amount: number }) {
  if (me.balance >= amount) return null;
  return (
    <p className="warn">
      {me.name} is {money(amount - me.balance)} short. The payment will put them in debt — sell buildings, mortgage, or trade to cover it.
    </p>
  );
}

function PropRow({ p, children, onClick, selected, disabled }: { p: Property; children?: ReactNode; onClick?: () => void; selected?: boolean; disabled?: boolean }) {
  return (
    <button className={`prop-row ${selected ? 'selected' : ''}`} onClick={onClick} disabled={disabled}>
      <GroupDot group={p.group} />
      <span className="prop-name">{p.name}</span>
      <span className="prop-meta">{children}</span>
    </button>
  );
}

function rentExplanation(game: GameState, p: Property): string {
  const h = game.holdings[p.id];
  if (p.kind === 'street') {
    if (h.houses === 5) return 'Hotel';
    if (h.houses) return `${h.houses} house${h.houses > 1 ? 's' : ''}`;
    return ownsWholeGroup(game, p.id) ? 'Full color set — double rent' : 'Unimproved';
  }
  const n = countOwnedInGroup(game, h.owner!, p.id);
  if (p.kind === 'railroad') return `${n} railroad${n > 1 ? 's' : ''} owned`;
  return n === 2 ? 'Both utilities — 10× dice' : 'One utility — 4× dice';
}

function RentView({ game, me, finish }: ViewProps) {
  const [sel, setSel] = useState<string | null>(null);
  const [dice, setDice] = useState(0);
  const [fromCard, setFromCard] = useState(false);
  const rentable = PROPERTIES.filter((p) => {
    const o = game.holdings[p.id].owner;
    return o && o !== me.id;
  });
  if (!rentable.length) return <p className="muted center">No one else owns property yet.</p>;
  const p = sel ? PROPERTY_BY_ID[sel] : null;
  const amount = p ? rentFor(game, p.id, { dice, fromCard }) : null;

  return (
    <div className="stack">
      {!p && <p className="muted small">Where did {me.name} land?</p>}
      {p ? (
        <div className="panel inset">
          <PropRow p={p} onClick={() => setSel(null)} selected>
            change
          </PropRow>
          <div className="kv">
            <span>Owner</span>
            <strong>{playerName(game, game.holdings[p.id].owner!)}</strong>
          </div>
          <div className="kv">
            <span>Rent</span>
            <span>{rentExplanation(game, p)}</span>
          </div>
          {p.kind !== 'street' && (
            <label className="check-row">
              <input type="checkbox" checked={fromCard} onChange={(e) => setFromCard(e.target.checked)} />
              Sent by Chance “advance to nearest {p.kind === 'railroad' ? 'Railroad' : 'Utility'}” ({p.kind === 'railroad' ? 'pay double' : '10× dice'})
            </label>
          )}
          {p.kind === 'utility' && (
            <>
              <p className="muted small">Dice total</p>
              <div className="dice">
                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                  <button key={n} className={dice === n ? 'on' : ''} onClick={() => setDice(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}
          {amount !== null && <ShortWarning me={me} amount={amount} />}
          <button
            className="btn primary big"
            disabled={amount === null}
            onClick={() => finish({ type: 'rent', payer: me.id, prop: p.id, dice, fromCard })}
          >
            {amount === null ? 'Pick the dice total' : `Pay ${money(amount)} to ${playerName(game, game.holdings[p.id].owner!)}`}
          </button>
        </div>
      ) : (
        <div className="list">
          {rentable.map((x) => {
            const h = game.holdings[x.id];
            const r = rentFor(game, x.id, {});
            return (
              <PropRow key={x.id} p={x} onClick={() => setSel(x.id)} disabled={h.mortgaged}>
                <span className="owner-chip" style={{ background: game.players.find((pl) => pl.id === h.owner)?.color }}>
                  {playerName(game, h.owner!)}
                </span>
                {h.mortgaged ? 'Mortgaged' : r === null ? 'dice' : money(r)}
              </PropRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BuyView({ game, me, finish }: ViewProps) {
  const [sel, setSel] = useState<string | null>(null);
  const [auction, setAuction] = useState(false);
  const [winner, setWinner] = useState(me.id);
  const [bid, setBid] = useState(0);
  const forSale = PROPERTIES.filter((p) => !game.holdings[p.id].owner);
  if (!forSale.length) return <p className="muted center">Every property has been sold.</p>;
  const p = sel ? PROPERTY_BY_ID[sel] : null;

  if (!p) {
    return (
      <div className="list">
        {forSale.map((x) => (
          <PropRow key={x.id} p={x} onClick={() => setSel(x.id)}>
            {money(x.price)}
          </PropRow>
        ))}
      </div>
    );
  }
  const winnerP = game.players.find((x) => x.id === winner)!;
  return (
    <div className="panel inset stack">
      <PropRow p={p} onClick={() => setSel(null)} selected>
        change
      </PropRow>
      <PropertyFacts p={p} />
      {!auction ? (
        <>
          {me.balance < p.price && <p className="warn">{me.name} only has {money(me.balance)}. Mortgage something first, or auction it.</p>}
          <button className="btn primary big" disabled={me.balance < p.price} onClick={() => finish({ type: 'buy', player: me.id, prop: p.id })}>
            Buy for {money(p.price)}
          </button>
          <button className="btn ghost" onClick={() => setAuction(true)}>
            Decline &amp; auction
          </button>
        </>
      ) : (
        <>
          <p className="muted small">Auction winner</p>
          <PlayerChips players={activePlayers(game)} value={winner} onChange={setWinner} />
          <AmountPad value={bid} onChange={setBid} />
          <button
            className="btn primary big"
            disabled={bid <= 0 || bid > winnerP.balance}
            onClick={() => finish({ type: 'buy', player: winner, prop: p.id, price: bid })}
          >
            {bid > winnerP.balance ? `${winnerP.name} can't afford that` : `Sell to ${winnerP.name} for ${money(bid)}`}
          </button>
        </>
      )}
    </div>
  );
}

function PropertyFacts({ p }: { p: Property }) {
  return (
    <div className="facts">
      {p.kind === 'street' && (
        <>
          <span>Rent {money(p.rent[0])}</span>
          <span>1–4 houses {p.rent.slice(1, 5).map(money).join(' / ')}</span>
          <span>Hotel {money(p.rent[5])}</span>
          <span>Houses cost {money(p.houseCost)} each</span>
        </>
      )}
      {p.kind === 'railroad' && <span>Rent $25 / $50 / $100 / $200 by railroads owned</span>}
      {p.kind === 'utility' && <span>Rent 4× dice, or 10× with both utilities</span>}
      <span>Mortgage {money(p.mortgage)}</span>
    </div>
  );
}

function CashView({ game, me, finish }: ViewProps) {
  const others = activePlayers(game).filter((p) => p.id !== me.id);
  const [mode, setMode] = useState<'player' | 'bank' | 'collect'>(others.length ? 'player' : 'bank');
  const [to, setTo] = useState(others[0]?.id ?? '');
  const [amount, setAmount] = useState(0);
  const [toPot, setToPot] = useState(game.settings.freeParkingJackpot);
  const target: Party = mode === 'player' ? to : mode === 'bank' ? (toPot && game.settings.freeParkingJackpot ? 'parking' : 'bank') : me.id;
  const from: Party = mode === 'collect' ? 'bank' : me.id;

  return (
    <div className="stack">
      <div className="segmented">
        {others.length > 0 && (
          <button className={mode === 'player' ? 'on' : ''} onClick={() => setMode('player')}>
            Pay player
          </button>
        )}
        <button className={mode === 'bank' ? 'on' : ''} onClick={() => setMode('bank')}>
          Pay bank
        </button>
        <button className={mode === 'collect' ? 'on' : ''} onClick={() => setMode('collect')}>
          From bank
        </button>
      </div>
      {mode === 'player' && <PlayerChips players={others} value={to} onChange={setTo} />}
      {mode === 'bank' && game.settings.freeParkingJackpot && (
        <label className="check-row">
          <input type="checkbox" checked={toPot} onChange={(e) => setToPot(e.target.checked)} />
          Put it in the Free Parking pot
        </label>
      )}
      <AmountPad value={amount} onChange={setAmount} />
      {mode !== 'collect' && <ShortWarning me={me} amount={amount} />}
      <button
        className="btn primary big"
        disabled={amount <= 0}
        onClick={() =>
          finish({
            type: 'transfer',
            from,
            to: target,
            amount,
            note: mode === 'collect' ? 'Collected from bank' : mode === 'bank' ? 'Paid the bank' : 'Payment',
          })
        }
      >
        {mode === 'collect' ? `Collect ${money(amount)}` : `Pay ${money(amount)} to ${playerName(game, target)}`}
      </button>
    </div>
  );
}

function TaxView({ game, me, finish }: ViewProps) {
  const s = game.settings;
  const sink = s.freeParkingJackpot ? ' → Free Parking' : '';
  return (
    <div className="tiles">
      <Tile icon="🧾" label="Income Tax" sub={`−${money(s.incomeTax)}${sink}`} tone="wide" onClick={() => finish({ type: 'tax', player: me.id, tax: 'income' })} />
      <Tile icon="💎" label="Luxury Tax" sub={`−${money(s.luxuryTax)}${sink}`} tone="wide" onClick={() => finish({ type: 'tax', player: me.id, tax: 'luxury' })} />
    </div>
  );
}

function cardAmount(game: GameState, me: Player, c: Card): string {
  const e = c.effect;
  const n = activePlayers(game).length - 1;
  switch (e.kind) {
    case 'collect':
      return `+${money(e.amount)}`;
    case 'pay':
      return `−${money(e.amount)}`;
    case 'collectEach':
      return `+${money(e.amount)} × ${n}`;
    case 'payEach':
      return `−${money(e.amount)} × ${n}`;
    case 'advanceToGo':
      return `+${money(game.settings.goSalary * (game.settings.doubleGoOnLanding ? 2 : 1))}`;
    case 'jailCard':
      return 'Keep';
    case 'repairs': {
      let total = 0;
      for (const p of ownedBy(game, me.id)) {
        const h = game.holdings[p.id].houses;
        total += h === 5 ? e.perHotel : h * e.perHouse;
      }
      return total ? `−${money(total)}` : money(0);
    }
  }
}

function CardsView({ game, me, finish, deck }: ViewProps & { deck: 'chance' | 'chest' }) {
  return (
    <div className="stack">
      <div className="list">
        {CARDS.filter((c) => c.deck === deck).map((c) => (
          <button key={c.id} className={`card-row ${deck}`} onClick={() => finish({ type: 'card', player: me.id, card: c.id })}>
            <span>
              {c.text}
              {c.effect.kind === 'repairs' && (
                <small>
                  {money(c.effect.perHouse)}/house · {money(c.effect.perHotel)}/hotel
                </small>
              )}
            </span>
            <strong>{cardAmount(game, me, c)}</strong>
          </button>
        ))}
      </div>
      <p className="muted small">
        Card moved you somewhere? Tap <b>Pass GO</b> if you passed it, then <b>Pay rent</b> or <b>Buy property</b>. For “nearest
        Railroad/Utility”, tick the Chance box in Pay rent.
      </p>
    </div>
  );
}

function JailView({ game, me, finish }: ViewProps) {
  return (
    <div className="tiles">
      <Tile icon="💵" label="Pay fine" sub={`−${money(game.settings.jailFine)}`} tone="wide" onClick={() => finish({ type: 'jailFine', player: me.id })} />
      <Tile
        icon="🔑"
        label="Use Get Out of Jail Free"
        sub={me.jailCards ? `${me.jailCards} held` : 'No card held'}
        tone="wide"
        onClick={() => finish({ type: 'useJailCard', player: me.id })}
      />
    </div>
  );
}

function Houses({ n }: { n: number }) {
  if (n === 5) return <span className="hotel" title="Hotel" />;
  return (
    <span className="houses">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="house" />
      ))}
    </span>
  );
}

function PropsView({ game, me, dispatch }: ViewProps) {
  const owned = ownedBy(game, me.id);
  if (!owned.length) return <p className="muted center">{me.name} doesn't own any property yet.</p>;
  const groups = [...new Set(owned.map((p) => p.group))];
  return (
    <div className="stack">
      <div className="kv panel inset">
        <span>Cash if everything were sold &amp; mortgaged</span>
        <strong>{money(netWorth(game, me.id))}</strong>
      </div>
      {groups.map((g) => {
        const full = GROUP_MEMBERS[g].every((id) => game.holdings[id].owner === me.id);
        return (
          <section key={g} className="prop-group">
            <h4>
              <GroupDot group={g} /> {GROUP_LABEL[g]}
              {full && <span className="badge">Full set</span>}
            </h4>
            {owned
              .filter((p) => p.group === g)
              .map((p) => {
                const h = game.holdings[p.id];
                const rent = rentFor(game, p.id, {});
                const groupBuilt = GROUP_MEMBERS[g].some((id) => game.holdings[id].houses > 0);
                return (
                  <div key={p.id} className={`owned-prop ${h.mortgaged ? 'mortgaged' : ''}`}>
                    <div className="owned-head">
                      <span className="prop-name">{p.name}</span>
                      {p.kind === 'street' && <Houses n={h.houses} />}
                      <span className="prop-meta">{h.mortgaged ? 'Mortgaged' : rent === null ? 'dice' : `Rent ${money(rent)}`}</span>
                    </div>
                    <div className="owned-actions">
                      {p.kind === 'street' && full && !h.mortgaged && (
                        <>
                          <button className="btn small" onClick={() => dispatch({ type: 'build', prop: p.id })} disabled={h.houses >= 5}>
                            + {h.houses === 4 ? 'Hotel' : 'House'} {money(p.houseCost)}
                          </button>
                          <button className="btn small" onClick={() => dispatch({ type: 'sellBuilding', prop: p.id })} disabled={!h.houses}>
                            − Sell +{money(buildingSaleValue(p))}
                          </button>
                        </>
                      )}
                      {h.mortgaged ? (
                        <button className="btn small" onClick={() => dispatch({ type: 'unmortgage', prop: p.id })}>
                          Unmortgage −{money(unmortgageCost(p))}
                        </button>
                      ) : (
                        <button className="btn small" onClick={() => dispatch({ type: 'mortgage', prop: p.id })} disabled={groupBuilt}>
                          Mortgage +{money(p.mortgage)}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}

function BankruptView({ game, me, finish }: ViewProps) {
  const others = activePlayers(game).filter((p) => p.id !== me.id);
  const [creditor, setCreditor] = useState<string>('bank');
  return (
    <div className="stack">
      <p>
        Who does {me.name} owe? Buildings are sold back to the bank at half price, then{' '}
        {creditor === 'bank'
          ? 'all cash goes to the bank and properties return to the bank unmortgaged (auction them off).'
          : `all cash, properties and Get Out of Jail Free cards go to ${playerName(game, creditor)}. They pay 10% interest on any mortgaged property.`}
      </p>
      <div className="chips">
        <button className={`chip-btn ${creditor === 'bank' ? 'on' : ''}`} onClick={() => setCreditor('bank')}>
          Bank
        </button>
      </div>
      <PlayerChips players={others} value={creditor} onChange={setCreditor} />
      <button className="btn danger big" onClick={() => finish({ type: 'bankrupt', player: me.id, creditor })}>
        Declare {me.name} bankrupt
      </button>
    </div>
  );
}
