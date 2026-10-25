import {
  GROUP_MEMBERS,
  PROPERTIES,
  PROPERTY_BY_ID,
  TOTAL_HOTELS,
  TOTAL_HOUSES,
  type Property,
} from './board';
import { CARD_BY_ID } from './cards';
import { money } from '../format';

export type PlayerId = string;
/** Anyone who can hold money: a player, the bank, or the Free Parking pot. */
export type Party = PlayerId | 'bank' | 'parking';

export interface Settings {
  startingCash: number;
  goSalary: number;
  /** House rule: landing exactly on GO pays double salary. */
  doubleGoOnLanding: boolean;
  /** House rule: taxes and fines go into a pot collected by landing on Free Parking. */
  freeParkingJackpot: boolean;
  /** Bank only has 32 houses and 12 hotels. */
  limitedBuildings: boolean;
  /** Houses must be built and sold evenly across a color group. */
  evenBuilding: boolean;
  incomeTax: number;
  luxuryTax: number;
  jailFine: number;
}

export const DEFAULT_SETTINGS: Settings = {
  startingCash: 1500,
  goSalary: 200,
  doubleGoOnLanding: false,
  freeParkingJackpot: false,
  limitedBuildings: true,
  evenBuilding: true,
  incomeTax: 200,
  luxuryTax: 100,
  jailFine: 50,
};

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  balance: number;
  bankrupt: boolean;
  jailCards: number;
}

export interface Holding {
  owner: PlayerId | null;
  mortgaged: boolean;
  /** 0–4 houses, 5 = hotel. */
  houses: number;
}

export interface Transfer {
  from: Party;
  to: Party;
  amount: number;
}

export interface Tx {
  id: number;
  time: number;
  label: string;
  transfers: Transfer[];
}

export interface Snapshot {
  settings: Settings;
  players: Player[];
  holdings: Record<string, Holding>;
  parking: number;
  nextTxId: number;
}

export interface GameState extends Snapshot {
  version: 1;
  log: Tx[];
  /** Earlier states for undo, oldest first. The log is restored by truncating it. */
  past: { snap: Snapshot; logLength: number }[];
}

export const MAX_UNDO = 100;

export interface TradeSide {
  cash: number;
  props: string[];
  jailCards: number;
}

export type Action =
  | { type: 'transfer'; from: Party; to: Party; amount: number; note?: string }
  | { type: 'passGo'; player: PlayerId; landed?: boolean }
  | { type: 'buy'; player: PlayerId; prop: string; price?: number }
  | { type: 'rent'; payer: PlayerId; prop: string; dice?: number; fromCard?: boolean }
  | { type: 'tax'; player: PlayerId; tax: 'income' | 'luxury' }
  | { type: 'card'; player: PlayerId; card: string }
  | { type: 'jailFine'; player: PlayerId }
  | { type: 'useJailCard'; player: PlayerId }
  | { type: 'collectParking'; player: PlayerId }
  | { type: 'build'; prop: string }
  | { type: 'sellBuilding'; prop: string }
  | { type: 'mortgage'; prop: string }
  | { type: 'unmortgage'; prop: string }
  | { type: 'trade'; a: PlayerId; b: PlayerId; aGives: TradeSide; bGives: TradeSide }
  | { type: 'bankrupt'; player: PlayerId; creditor: Party }
  | { type: 'settings'; settings: Partial<Settings> };

export type Result = { ok: true; state: GameState; tx?: Tx } | { ok: false; error: string };

export class GameError extends Error {}

function fail(msg: string): never {
  throw new GameError(msg);
}

// ---------------------------------------------------------------------------
// Setup

export interface NewPlayer {
  name: string;
  color: string;
}

export function newGame(players: NewPlayer[], settings: Partial<Settings> = {}): GameState {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const holdings: Record<string, Holding> = {};
  for (const p of PROPERTIES) holdings[p.id] = { owner: null, mortgaged: false, houses: 0 };
  return {
    version: 1,
    settings: s,
    players: players.map((p, i) => ({
      id: `p${i + 1}`,
      name: p.name.trim() || `Player ${i + 1}`,
      color: p.color,
      balance: s.startingCash,
      bankrupt: false,
      jailCards: 0,
    })),
    holdings,
    parking: 0,
    log: [],
    nextTxId: 1,
    past: [],
  };
}

// ---------------------------------------------------------------------------
// Queries

export const unmortgageCost = (p: Property) => Math.ceil(p.mortgage * 1.1);
export const mortgageInterest = (p: Property) => Math.ceil(p.mortgage * 0.1);
export const buildingSaleValue = (p: Property) => (p.kind === 'street' ? p.houseCost / 2 : 0);

export function playerName(state: Snapshot, party: Party): string {
  if (party === 'bank') return 'Bank';
  if (party === 'parking') return 'Free Parking';
  return state.players.find((p) => p.id === party)?.name ?? '?';
}

export function ownsWholeGroup(state: Snapshot, propId: string): boolean {
  const prop = PROPERTY_BY_ID[propId];
  const owner = state.holdings[propId].owner;
  return owner !== null && GROUP_MEMBERS[prop.group].every((id) => state.holdings[id].owner === owner);
}

export function countOwnedInGroup(state: Snapshot, owner: PlayerId, propId: string): number {
  const prop = PROPERTY_BY_ID[propId];
  return GROUP_MEMBERS[prop.group].filter((id) => state.holdings[id].owner === owner).length;
}

export function buildingsInBank(state: Snapshot): { houses: number; hotels: number } {
  let houses = 0;
  let hotels = 0;
  for (const h of Object.values(state.holdings)) {
    if (h.houses === 5) hotels++;
    else houses += h.houses;
  }
  return { houses: TOTAL_HOUSES - houses, hotels: TOTAL_HOTELS - hotels };
}

export function ownedBy(state: Snapshot, player: PlayerId): Property[] {
  return PROPERTIES.filter((p) => state.holdings[p.id].owner === player);
}

/** Cash plus everything that could be raised by selling buildings and mortgaging. */
export function netWorth(state: Snapshot, player: PlayerId): number {
  const pl = state.players.find((p) => p.id === player);
  if (!pl) return 0;
  let total = pl.balance;
  for (const prop of ownedBy(state, player)) {
    const h = state.holdings[prop.id];
    if (prop.kind === 'street') total += h.houses * buildingSaleValue(prop);
    if (!h.mortgaged) total += prop.mortgage;
  }
  return total;
}

export interface RentOptions {
  dice?: number;
  /** Chance "advance to nearest Railroad/Utility": railroads pay double, utilities pay 10× dice. */
  fromCard?: boolean;
}

/** Rent owed on a property. Utilities need a dice total; returns null if missing. */
export function rentFor(state: Snapshot, propId: string, opts: RentOptions = {}): number | null {
  const prop = PROPERTY_BY_ID[propId];
  const h = state.holdings[propId];
  if (!h.owner || h.mortgaged) return 0;
  switch (prop.kind) {
    case 'street':
      if (h.houses > 0) return prop.rent[h.houses];
      return ownsWholeGroup(state, propId) ? prop.rent[0] * 2 : prop.rent[0];
    case 'railroad': {
      const n = countOwnedInGroup(state, h.owner, propId);
      const rent = 25 * 2 ** (n - 1);
      return opts.fromCard ? rent * 2 : rent;
    }
    case 'utility': {
      if (!opts.dice) return null;
      const n = countOwnedInGroup(state, h.owner, propId);
      return opts.dice * (opts.fromCard || n === 2 ? 10 : 4);
    }
  }
}

// ---------------------------------------------------------------------------
// Reducer

export function apply(state: GameState, action: Action): Result {
  const { past, log, version: _, ...snap } = state;
  const draft: Snapshot = structuredClone(snap);
  const pending: Transfer[] = [];
  let label = '';
  try {
    label = run(draft, action, pending);
  } catch (e) {
    if (e instanceof GameError) return { ok: false, error: e.message };
    throw e;
  }
  let tx: Tx | undefined;
  if (label) {
    tx = { id: draft.nextTxId++, time: Date.now(), label, transfers: pending.filter((t) => t.amount > 0) };
  }
  return {
    ok: true,
    tx,
    state: {
      version: 1,
      ...draft,
      log: tx ? [...log, tx] : log,
      past: [...past, { snap, logLength: log.length }].slice(-MAX_UNDO),
    },
  };
}

export function undo(state: GameState): GameState | null {
  const prev = state.past.at(-1);
  if (!prev) return null;
  return { version: 1, ...prev.snap, log: state.log.slice(0, prev.logLength), past: state.past.slice(0, -1) };
}

function player(s: Snapshot, id: PlayerId): Player {
  const p = s.players.find((x) => x.id === id);
  if (!p) return fail('Unknown player');
  if (p.bankrupt) return fail(`${p.name} is bankrupt`);
  return p;
}

function prop(id: string): Property {
  return PROPERTY_BY_ID[id] ?? fail('Unknown property');
}

function move(s: Snapshot, pending: Transfer[], from: Party, to: Party, amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) fail('Enter a whole-dollar amount');
  if (from === to) fail('Choose two different accounts');
  if (from === 'parking') {
    if (s.parking < amount) fail('Not that much in Free Parking');
    s.parking -= amount;
  } else if (from !== 'bank') {
    player(s, from).balance -= amount;
  }
  if (to === 'parking') s.parking += amount;
  else if (to !== 'bank') player(s, to).balance += amount;
  pending.push({ from, to, amount });
}

function requireCash(p: Player, amount: number) {
  if (p.balance < amount) fail(`${p.name} needs $${amount} but only has $${p.balance}`);
}

/** Where fees to the bank go: the Free Parking pot when that house rule is on. */
const feeSink = (s: Snapshot): Party => (s.settings.freeParkingJackpot ? 'parking' : 'bank');

function run(s: Snapshot, a: Action, t: Transfer[]): string {
  switch (a.type) {
    case 'transfer': {
      if (a.amount <= 0) fail('Enter an amount');
      move(s, t, a.from, a.to, a.amount);
      return a.note?.trim() || 'Payment';
    }

    case 'passGo': {
      const p = player(s, a.player);
      const amount = s.settings.goSalary * (a.landed && s.settings.doubleGoOnLanding ? 2 : 1);
      move(s, t, 'bank', p.id, amount);
      return a.landed && s.settings.doubleGoOnLanding ? 'Landed on GO (double salary)' : 'Passed GO';
    }

    case 'buy': {
      const p = player(s, a.player);
      const pr = prop(a.prop);
      const h = s.holdings[pr.id];
      if (h.owner) fail(`${pr.name} is already owned by ${playerName(s, h.owner)}`);
      const price = a.price ?? pr.price;
      requireCash(p, price);
      move(s, t, p.id, 'bank', price);
      h.owner = p.id;
      return a.price !== undefined && a.price !== pr.price ? `Won auction: ${pr.name}` : `Bought ${pr.name}`;
    }

    case 'rent': {
      const pr = prop(a.prop);
      const h = s.holdings[pr.id];
      if (!h.owner) fail(`${pr.name} is not owned`);
      if (h.owner === a.payer) fail('You own this property');
      if (h.mortgaged) fail(`${pr.name} is mortgaged — no rent is due`);
      player(s, a.payer);
      const amount = rentFor(s, pr.id, a) ?? fail('Enter the dice total');
      move(s, t, a.payer, h.owner, amount);
      return `Rent: ${pr.name}`;
    }

    case 'tax': {
      const p = player(s, a.player);
      const amount = a.tax === 'income' ? s.settings.incomeTax : s.settings.luxuryTax;
      move(s, t, p.id, feeSink(s), amount);
      return a.tax === 'income' ? 'Income Tax' : 'Luxury Tax';
    }

    case 'card': {
      const card = CARD_BY_ID[a.card] ?? fail('Unknown card');
      const p = player(s, a.player);
      const others = s.players.filter((x) => !x.bankrupt && x.id !== p.id);
      const deck = card.deck === 'chance' ? 'Chance' : 'Community Chest';
      const e = card.effect;
      switch (e.kind) {
        case 'collect':
          move(s, t, 'bank', p.id, e.amount);
          break;
        case 'pay':
          move(s, t, p.id, feeSink(s), e.amount);
          break;
        case 'collectEach':
          for (const o of others) move(s, t, o.id, p.id, e.amount);
          break;
        case 'payEach':
          for (const o of others) move(s, t, p.id, o.id, e.amount);
          break;
        case 'repairs': {
          let houses = 0;
          let hotels = 0;
          for (const pr of ownedBy(s, p.id)) {
            const n = s.holdings[pr.id].houses;
            if (n === 5) hotels++;
            else houses += n;
          }
          move(s, t, p.id, feeSink(s), houses * e.perHouse + hotels * e.perHotel);
          break;
        }
        case 'advanceToGo':
          move(s, t, 'bank', p.id, s.settings.goSalary * (s.settings.doubleGoOnLanding ? 2 : 1));
          break;
        case 'jailCard': {
          const held = s.players.reduce((n, x) => n + x.jailCards, 0);
          if (held >= 2) fail('Both Get Out of Jail Free cards are already held');
          p.jailCards++;
          break;
        }
      }
      return `${deck}: ${card.text}`;
    }

    case 'jailFine': {
      const p = player(s, a.player);
      move(s, t, p.id, feeSink(s), s.settings.jailFine);
      return 'Paid to get out of Jail';
    }

    case 'useJailCard': {
      const p = player(s, a.player);
      if (p.jailCards < 1) fail(`${p.name} has no Get Out of Jail Free card`);
      p.jailCards--;
      return 'Used Get Out of Jail Free card';
    }

    case 'collectParking': {
      const p = player(s, a.player);
      if (!s.parking) fail('The Free Parking pot is empty');
      move(s, t, 'parking', p.id, s.parking);
      return 'Free Parking jackpot';
    }

    case 'build': {
      const pr = prop(a.prop);
      if (pr.kind !== 'street') fail('You can only build on color-group streets');
      const h = s.holdings[pr.id];
      const p = player(s, h.owner ?? fail(`${pr.name} is not owned`));
      if (!ownsWholeGroup(s, pr.id)) fail('Own every property in the color group before building');
      const group = GROUP_MEMBERS[pr.group];
      if (group.some((id) => s.holdings[id].mortgaged)) fail('Unmortgage the whole group before building');
      if (h.houses >= 5) fail(`${pr.name} already has a hotel`);
      if (s.settings.evenBuilding) {
        const min = Math.min(...group.map((id) => s.holdings[id].houses));
        if (h.houses > min) fail('Build evenly — add to the other properties in this group first');
      }
      if (s.settings.limitedBuildings) {
        const bank = buildingsInBank(s);
        if (h.houses === 4 && bank.hotels < 1) fail('The bank has no hotels left');
        if (h.houses < 4 && bank.houses < 1) fail('The bank has no houses left');
      }
      requireCash(p, pr.houseCost);
      move(s, t, p.id, 'bank', pr.houseCost);
      h.houses++;
      return h.houses === 5 ? `Built a hotel on ${pr.name}` : `Built a house on ${pr.name}`;
    }

    case 'sellBuilding': {
      const pr = prop(a.prop);
      if (pr.kind !== 'street') fail('Nothing to sell');
      const h = s.holdings[pr.id];
      const p = player(s, h.owner ?? fail(`${pr.name} is not owned`));
      if (h.houses === 0) fail(`${pr.name} has no buildings`);
      if (s.settings.evenBuilding) {
        const max = Math.max(...GROUP_MEMBERS[pr.group].map((id) => s.holdings[id].houses));
        if (h.houses < max) fail('Sell evenly — sell from the other properties in this group first');
      }
      if (h.houses === 5 && s.settings.limitedBuildings && buildingsInBank(s).houses < 4) {
        fail('The bank needs 4 houses to break down a hotel');
      }
      const wasHotel = h.houses === 5;
      h.houses--;
      move(s, t, 'bank', p.id, buildingSaleValue(pr));
      return wasHotel ? `Sold hotel on ${pr.name}` : `Sold a house on ${pr.name}`;
    }

    case 'mortgage': {
      const pr = prop(a.prop);
      const h = s.holdings[pr.id];
      const p = player(s, h.owner ?? fail(`${pr.name} is not owned`));
      if (h.mortgaged) fail(`${pr.name} is already mortgaged`);
      if (GROUP_MEMBERS[pr.group].some((id) => s.holdings[id].houses > 0)) {
        fail('Sell all buildings in this group before mortgaging');
      }
      h.mortgaged = true;
      move(s, t, 'bank', p.id, pr.mortgage);
      return `Mortgaged ${pr.name}`;
    }

    case 'unmortgage': {
      const pr = prop(a.prop);
      const h = s.holdings[pr.id];
      const p = player(s, h.owner ?? fail(`${pr.name} is not owned`));
      if (!h.mortgaged) fail(`${pr.name} is not mortgaged`);
      const cost = unmortgageCost(pr);
      requireCash(p, cost);
      h.mortgaged = false;
      move(s, t, p.id, 'bank', cost);
      return `Lifted mortgage on ${pr.name}`;
    }

    case 'trade': {
      const A = player(s, a.a);
      const B = player(s, a.b);
      if (A.id === B.id) fail('Choose two different players');
      const sides: [Player, Player, TradeSide][] = [
        [A, B, a.aGives],
        [B, A, a.bGives],
      ];
      for (const [giver, , side] of sides) {
        if (side.cash < 0 || side.jailCards < 0) fail('Amounts cannot be negative');
        requireCash(giver, side.cash);
        if (side.jailCards > giver.jailCards) fail(`${giver.name} doesn't have that many jail cards`);
        for (const id of side.props) {
          const pr = prop(id);
          if (s.holdings[id].owner !== giver.id) fail(`${giver.name} doesn't own ${pr.name}`);
          if (GROUP_MEMBERS[pr.group].some((g) => s.holdings[g].houses > 0)) {
            fail(`Sell the buildings in ${pr.name}'s group before trading it`);
          }
        }
      }
      if (!a.aGives.cash && !a.bGives.cash && !a.aGives.props.length && !a.bGives.props.length && !a.aGives.jailCards && !a.bGives.jailCards) {
        fail('Add something to the trade');
      }
      for (const [giver, receiver, side] of sides) {
        if (side.cash) move(s, t, giver.id, receiver.id, side.cash);
        giver.jailCards -= side.jailCards;
        receiver.jailCards += side.jailCards;
        for (const id of side.props) s.holdings[id].owner = receiver.id;
      }
      // Receiving a mortgaged property costs 10% interest right away.
      for (const [, receiver, side] of sides) {
        for (const id of side.props) {
          if (s.holdings[id].mortgaged) move(s, t, receiver.id, 'bank', mortgageInterest(prop(id)));
        }
      }
      return `Trade: ${A.name} ⇄ ${B.name}`;
    }

    case 'bankrupt': {
      const p = player(s, a.player);
      const creditor = a.creditor === 'parking' ? 'bank' : a.creditor;
      if (creditor === p.id) fail('Choose who the debt is owed to');
      const owned = ownedBy(s, p.id);
      let shortfall = 0;
      // Buildings go back to the bank at half price; proceeds join the debtor's assets.
      for (const pr of owned) {
        const h = s.holdings[pr.id];
        if (h.houses > 0) {
          move(s, t, 'bank', p.id, h.houses * buildingSaleValue(pr));
          h.houses = 0;
        }
      }
      if (creditor === 'bank') {
        if (p.balance > 0) move(s, t, p.id, 'bank', p.balance);
        for (const pr of owned) s.holdings[pr.id] = { owner: null, mortgaged: false, houses: 0 };
      } else {
        const c = player(s, creditor);
        // Hand over whatever is left. A negative balance is the part of the debt that can't be paid,
        // so the creditor gives back what they were credited but never really received.
        if (p.balance > 0) move(s, t, p.id, c.id, p.balance);
        else if (p.balance < 0) {
          shortfall = -p.balance;
          c.balance -= shortfall;
        }
        for (const pr of owned) {
          s.holdings[pr.id].owner = c.id;
          if (s.holdings[pr.id].mortgaged) move(s, t, c.id, 'bank', mortgageInterest(pr));
        }
        c.jailCards += p.jailCards;
      }
      p.balance = 0;
      p.jailCards = 0;
      p.bankrupt = true;
      const label = `${p.name} went bankrupt to ${playerName(s, creditor)}`;
      return shortfall ? `${label} (${money(shortfall)} unpaid)` : label;
    }

    case 'settings': {
      s.settings = { ...s.settings, ...a.settings };
      return '';
    }
  }
}

/** Short human description of a transaction's money flow, e.g. "Ann → Bob $50". */
export function describeTransfers(state: Snapshot, tx: Tx): string[] {
  return tx.transfers.map((t) => `${playerName(state, t.from)} → ${playerName(state, t.to)} ${money(t.amount)}`);
}

export function activePlayers(state: Snapshot): Player[] {
  return state.players.filter((p) => !p.bankrupt);
}
