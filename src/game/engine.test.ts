import { describe, expect, it } from 'vitest';
import { apply, buildingsInBank, newGame, rentFor, undo, type Action, type GameState, type Settings } from './engine';

const setup = (settings: Partial<Settings> = {}) =>
  newGame(
    [
      { name: 'Ann', color: '#f00' },
      { name: 'Bob', color: '#0f0' },
      { name: 'Cy', color: '#00f' },
    ],
    settings,
  );

function run(state: GameState, ...actions: Action[]): GameState {
  for (const a of actions) {
    const r = apply(state, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
    state = r.state;
  }
  return state;
}

function err(state: GameState, a: Action): string {
  const r = apply(state, a);
  if (r.ok) throw new Error('expected failure');
  return r.error;
}

const bal = (s: GameState) => s.players.map((p) => p.balance);

describe('basics', () => {
  it('starts everyone with starting cash', () => {
    expect(bal(setup())).toEqual([1500, 1500, 1500]);
    expect(bal(setup({ startingCash: 2000 }))).toEqual([2000, 2000, 2000]);
  });

  it('passes GO and handles the double-on-landing house rule', () => {
    expect(bal(run(setup(), { type: 'passGo', player: 'p1' }))[0]).toBe(1700);
    expect(bal(run(setup(), { type: 'passGo', player: 'p1', landed: true }))[0]).toBe(1700);
    expect(bal(run(setup({ doubleGoOnLanding: true }), { type: 'passGo', player: 'p1', landed: true }))[0]).toBe(1900);
  });

  it('transfers between any accounts and logs it', () => {
    const s = run(setup(), { type: 'transfer', from: 'p1', to: 'p2', amount: 75, note: 'Loan' });
    expect(bal(s)).toEqual([1425, 1575, 1500]);
    expect(s.log.at(-1)).toMatchObject({ label: 'Loan', transfers: [{ from: 'p1', to: 'p2', amount: 75 }] });
  });

  it('rejects bad amounts', () => {
    expect(err(setup(), { type: 'transfer', from: 'p1', to: 'p2', amount: 0 })).toMatch(/amount/);
    expect(err(setup(), { type: 'transfer', from: 'p1', to: 'p2', amount: 1.5 })).toMatch(/whole/);
    expect(err(setup(), { type: 'transfer', from: 'p1', to: 'p1', amount: 5 })).toMatch(/different/);
  });

  it('undoes actions', () => {
    const s = run(setup(), { type: 'passGo', player: 'p1' }, { type: 'buy', player: 'p1', prop: 'boardwalk' });
    const u = undo(s)!;
    expect(u.holdings.boardwalk.owner).toBeNull();
    expect(bal(u)[0]).toBe(1700);
    expect(u.log).toHaveLength(1);
    expect(bal(undo(u)!)[0]).toBe(1500);
    expect(undo(undo(u)!)).toBeNull();
  });
});

describe('property and rent', () => {
  it('buys at list price or auction price', () => {
    let s = run(setup(), { type: 'buy', player: 'p1', prop: 'boardwalk' });
    expect(bal(s)[0]).toBe(1100);
    expect(err(s, { type: 'buy', player: 'p2', prop: 'boardwalk' })).toMatch(/already owned/);
    s = run(s, { type: 'buy', player: 'p2', prop: 'parkplace', price: 10 });
    expect(bal(s)[1]).toBe(1490);
    expect(s.log.at(-1)!.label).toMatch(/auction/);
  });

  it("can't buy what you can't afford", () => {
    const s = run(setup({ startingCash: 100 }));
    expect(err(s, { type: 'buy', player: 'p1', prop: 'boardwalk' })).toMatch(/needs \$400/);
  });

  it('charges street rent, doubled with a full group', () => {
    let s = run(setup(), { type: 'buy', player: 'p1', prop: 'mediterranean' });
    expect(rentFor(s, 'mediterranean')).toBe(2);
    s = run(s, { type: 'buy', player: 'p1', prop: 'baltic' });
    expect(rentFor(s, 'mediterranean')).toBe(4);
    s = run(s, { type: 'rent', payer: 'p2', prop: 'baltic' });
    expect(bal(s)).toEqual([1380 + 8, 1492, 1500]);
    expect(err(s, { type: 'rent', payer: 'p1', prop: 'baltic' })).toMatch(/own/);
  });

  it('charges railroad rent by count, doubled from a card', () => {
    let s = run(setup(), { type: 'buy', player: 'p1', prop: 'reading' });
    expect(rentFor(s, 'reading')).toBe(25);
    s = run(s, { type: 'buy', player: 'p1', prop: 'bo' }, { type: 'buy', player: 'p1', prop: 'shortline' });
    expect(rentFor(s, 'reading')).toBe(100);
    expect(rentFor(s, 'reading', { fromCard: true })).toBe(200);
    s = run(s, { type: 'buy', player: 'p1', prop: 'pennsylvaniarr' });
    expect(rentFor(s, 'shortline')).toBe(200);
  });

  it('charges utility rent from dice', () => {
    let s = run(setup(), { type: 'buy', player: 'p1', prop: 'water' });
    expect(rentFor(s, 'water')).toBeNull();
    expect(rentFor(s, 'water', { dice: 7 })).toBe(28);
    expect(rentFor(s, 'water', { dice: 7, fromCard: true })).toBe(70);
    expect(err(s, { type: 'rent', payer: 'p2', prop: 'water' })).toMatch(/dice/);
    s = run(s, { type: 'buy', player: 'p1', prop: 'electric' }, { type: 'rent', payer: 'p2', prop: 'water', dice: 5 });
    expect(bal(s)[1]).toBe(1450);
  });

  it('charges no rent on mortgaged property', () => {
    const s = run(setup(), { type: 'buy', player: 'p1', prop: 'boardwalk' }, { type: 'mortgage', prop: 'boardwalk' });
    expect(err(s, { type: 'rent', payer: 'p2', prop: 'boardwalk' })).toMatch(/mortgaged/);
  });

  it('lets a payer go into debt on rent', () => {
    let s = run(setup(), { type: 'buy', player: 'p1', prop: 'mediterranean' }, { type: 'buy', player: 'p1', prop: 'baltic' });
    for (let i = 0; i < 4; i++) s = run(s, { type: 'build', prop: i % 2 ? 'baltic' : 'mediterranean' });
    s = run(s, { type: 'transfer', from: 'p2', to: 'p3', amount: 1450 }, { type: 'rent', payer: 'p2', prop: 'baltic' });
    expect(bal(s)[1]).toBe(50 - 60);
  });
});

describe('buildings', () => {
  const owningBrowns = () =>
    run(setup(), { type: 'buy', player: 'p1', prop: 'mediterranean' }, { type: 'buy', player: 'p1', prop: 'baltic' });

  it('requires a full group', () => {
    const s = run(setup(), { type: 'buy', player: 'p1', prop: 'mediterranean' });
    expect(err(s, { type: 'build', prop: 'mediterranean' })).toMatch(/every property/);
    expect(err(s, { type: 'build', prop: 'reading' })).toMatch(/streets/);
  });

  it('builds evenly and charges rent by houses', () => {
    let s = run(owningBrowns(), { type: 'build', prop: 'baltic' });
    expect(bal(s)[0]).toBe(1380 - 50);
    expect(rentFor(s, 'baltic')).toBe(20);
    expect(err(s, { type: 'build', prop: 'baltic' })).toMatch(/evenly/);
    s = run(s, { type: 'build', prop: 'mediterranean' }, { type: 'build', prop: 'baltic' });
    expect(err(s, { type: 'sellBuilding', prop: 'mediterranean' })).toMatch(/evenly/);
    s = run(s, { type: 'sellBuilding', prop: 'baltic' });
    expect(bal(s)[0]).toBe(1380 - 150 + 25);
  });

  it('allows uneven building when the rule is off', () => {
    const s = run(owningBrowns(), { type: 'settings', settings: { evenBuilding: false } }, { type: 'build', prop: 'baltic' }, { type: 'build', prop: 'baltic' });
    expect(s.holdings.baltic.houses).toBe(2);
  });

  it('builds hotels and returns houses to the bank', () => {
    let s = owningBrowns();
    for (let i = 0; i < 9; i++) s = run(s, { type: 'build', prop: i % 2 ? 'mediterranean' : 'baltic' });
    expect(s.holdings.baltic.houses).toBe(5);
    expect(buildingsInBank(s)).toEqual({ houses: 28, hotels: 11 });
    expect(rentFor(s, 'baltic')).toBe(450);
    expect(err(s, { type: 'build', prop: 'baltic' })).toMatch(/hotel/);
  });

  it('enforces the building shortage', () => {
    let s = owningBrowns();
    s.holdings.oriental = { owner: 'p2', mortgaged: false, houses: 4 };
    for (const id of ['vermont', 'connecticut', 'stcharles', 'states', 'virginia', 'stjames', 'tennessee']) {
      s.holdings[id] = { owner: 'p2', mortgaged: false, houses: 4 };
    }
    expect(buildingsInBank(s).houses).toBe(0);
    expect(err(s, { type: 'build', prop: 'baltic' })).toMatch(/no houses/);
    s = run(s, { type: 'settings', settings: { limitedBuildings: false } }, { type: 'build', prop: 'baltic' });
    expect(s.holdings.baltic.houses).toBe(1);
  });

  it('requires an unmortgaged group to build and bare group to mortgage', () => {
    let s = run(owningBrowns(), { type: 'mortgage', prop: 'mediterranean' });
    expect(bal(s)[0]).toBe(1380 + 30);
    expect(err(s, { type: 'build', prop: 'baltic' })).toMatch(/Unmortgage/);
    s = run(s, { type: 'unmortgage', prop: 'mediterranean' }, { type: 'build', prop: 'baltic' });
    expect(bal(s)[0]).toBe(1380 + 30 - 33 - 50);
    expect(err(s, { type: 'mortgage', prop: 'mediterranean' })).toMatch(/Sell all buildings/);
  });
});

describe('taxes, cards and jail', () => {
  it('pays taxes to the bank or the Free Parking pot', () => {
    expect(bal(run(setup(), { type: 'tax', player: 'p1', tax: 'income' }))[0]).toBe(1300);
    let s = run(setup({ freeParkingJackpot: true }), { type: 'tax', player: 'p1', tax: 'luxury' }, { type: 'jailFine', player: 'p2' });
    expect(s.parking).toBe(150);
    s = run(s, { type: 'collectParking', player: 'p3' });
    expect(s.parking).toBe(0);
    expect(bal(s)).toEqual([1400, 1450, 1650]);
    expect(err(s, { type: 'collectParking', player: 'p3' })).toMatch(/empty/);
  });

  it('applies money cards', () => {
    expect(bal(run(setup(), { type: 'card', player: 'p1', card: 'cc-bankerror' }))).toEqual([1700, 1500, 1500]);
    expect(bal(run(setup(), { type: 'card', player: 'p1', card: 'cc-birthday' }))).toEqual([1520, 1490, 1490]);
    expect(bal(run(setup(), { type: 'card', player: 'p1', card: 'ch-chairman' }))).toEqual([1400, 1550, 1550]);
    expect(bal(run(setup(), { type: 'card', player: 'p1', card: 'cc-doctor' }))).toEqual([1450, 1500, 1500]);
  });

  it('charges repairs per house and hotel', () => {
    let s = run(setup(), { type: 'buy', player: 'p1', prop: 'mediterranean' }, { type: 'buy', player: 'p1', prop: 'baltic' });
    for (let i = 0; i < 7; i++) s = run(s, { type: 'build', prop: i % 2 ? 'mediterranean' : 'baltic' });
    // baltic: 4 houses, mediterranean: 3 houses → then a hotel on baltic after one more
    s = run(s, { type: 'build', prop: 'mediterranean' }, { type: 'build', prop: 'baltic' });
    const before = s.players[0].balance;
    s = run(s, { type: 'card', player: 'p1', card: 'cc-street' });
    expect(before - s.players[0].balance).toBe(4 * 40 + 115);
  });

  it('tracks Get Out of Jail Free cards', () => {
    let s = run(setup(), { type: 'card', player: 'p1', card: 'ch-jail' }, { type: 'card', player: 'p2', card: 'cc-jail' });
    expect(err(s, { type: 'card', player: 'p3', card: 'cc-jail' })).toMatch(/already held/);
    s = run(s, { type: 'useJailCard', player: 'p1' });
    expect(s.players[0].jailCards).toBe(0);
    expect(err(s, { type: 'useJailCard', player: 'p1' })).toMatch(/no Get Out/);
  });
});

describe('trades and bankruptcy', () => {
  it('swaps cash, property and cards; charges interest on mortgaged property', () => {
    let s = run(
      setup(),
      { type: 'buy', player: 'p1', prop: 'boardwalk' },
      { type: 'buy', player: 'p2', prop: 'parkplace' },
      { type: 'mortgage', prop: 'parkplace' },
      { type: 'card', player: 'p2', card: 'cc-jail' },
    );
    s = run(s, {
      type: 'trade',
      a: 'p1',
      b: 'p2',
      aGives: { cash: 100, props: [], jailCards: 0 },
      bGives: { cash: 0, props: ['parkplace'], jailCards: 1 },
    });
    expect(s.holdings.parkplace.owner).toBe('p1');
    expect(s.players[0].jailCards).toBe(1);
    expect(bal(s)).toEqual([1100 - 100 - 18, 1150 + 175 + 100, 1500]);
  });

  it('blocks trading property with buildings in its group', () => {
    let s = run(setup(), { type: 'buy', player: 'p1', prop: 'mediterranean' }, { type: 'buy', player: 'p1', prop: 'baltic' }, { type: 'build', prop: 'baltic' });
    expect(
      err(s, { type: 'trade', a: 'p1', b: 'p2', aGives: { cash: 0, props: ['mediterranean'], jailCards: 0 }, bGives: { cash: 0, props: [], jailCards: 0 } }),
    ).toMatch(/buildings/);
    s = run(s, { type: 'sellBuilding', prop: 'baltic' });
    expect(err(s, { type: 'trade', a: 'p1', b: 'p2', aGives: { cash: 0, props: [], jailCards: 0 }, bGives: { cash: 0, props: [], jailCards: 0 } })).toMatch(/Add something/);
  });

  it('hands everything to a creditor player', () => {
    let s = run(
      setup(),
      { type: 'buy', player: 'p1', prop: 'mediterranean' },
      { type: 'buy', player: 'p1', prop: 'baltic' },
      { type: 'build', prop: 'baltic' },
      { type: 'buy', player: 'p1', prop: 'boardwalk' },
      { type: 'mortgage', prop: 'boardwalk' },
      { type: 'card', player: 'p1', card: 'ch-jail' },
    );
    // Ann now has 1500 - 120 - 50 - 400 + 200 = 1130; force her into debt to Bob.
    s = run(s, { type: 'transfer', from: 'p1', to: 'p2', amount: 1200 });
    s = run(s, { type: 'bankrupt', player: 'p1', creditor: 'p2' });
    const [ann, bob] = s.players;
    expect(ann).toMatchObject({ bankrupt: true, balance: 0, jailCards: 0 });
    expect(bob.jailCards).toBe(1);
    expect(s.holdings.baltic).toMatchObject({ owner: 'p2', houses: 0 });
    expect(s.holdings.boardwalk).toMatchObject({ owner: 'p2', mortgaged: true });
    // Bob: 1500 + 1200 received - 70 shortfall + 25 house sale - 20 interest on Boardwalk
    // (the house sale covers part of the shortfall, so $45 goes unpaid).
    expect(bob.balance).toBe(1500 + 1200 - 70 + 25 - 20);
    expect(s.log.at(-1)!.label).toBe('Ann went bankrupt to Bob ($45 unpaid)');
    expect(err(s, { type: 'passGo', player: 'p1' })).toMatch(/bankrupt/);
  });

  it('returns everything to the bank', () => {
    let s = run(setup(), { type: 'buy', player: 'p1', prop: 'boardwalk' }, { type: 'mortgage', prop: 'boardwalk' });
    s = run(s, { type: 'bankrupt', player: 'p1', creditor: 'bank' });
    expect(s.holdings.boardwalk).toEqual({ owner: null, mortgaged: false, houses: 0 });
    expect(s.players[0].balance).toBe(0);
  });

  it('skips bankrupt players for birthday collections', () => {
    let s = run(setup(), { type: 'bankrupt', player: 'p3', creditor: 'bank' });
    s = run(s, { type: 'card', player: 'p1', card: 'cc-birthday' });
    expect(bal(s)).toEqual([1510, 1490, 0]);
  });
});
