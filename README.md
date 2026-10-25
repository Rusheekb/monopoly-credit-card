# Bankroll — a debit card for Monopoly

A phone-friendly web app that replaces Monopoly's paper money. Every player gets a
"debit card" with a live balance, and one shared device acts as the bank. Tap a card
to open that player's terminal and handle any transaction in a couple of taps.

## What it handles

| Situation | How |
| --- | --- |
| Passing GO | One tap: **Pass GO** (+$200, or double for landing on GO as a house rule) |
| Buying property | **Buy property** → pick the space → buy at list price |
| Auctions | Decline the purchase → pick the winner and their bid |
| Rent | **Pay rent** → pick the space. Rent is calculated automatically: color sets double, houses/hotels, 1–4 railroads, utilities (4× / 10× the dice), and Chance's "nearest Railroad/Utility" cards |
| Taxes | Income Tax ($200) and Luxury Tax ($100) |
| Chance & Community Chest | Every money card: collect, pay, birthday (collect from everyone), chairman (pay everyone), repairs (charged per house/hotel you own), Get Out of Jail Free |
| Jail | Pay the $50 fine or use a Get Out of Jail Free card |
| Houses & hotels | Build and sell (half price) with even-building and the 32 house / 12 hotel shortage enforced |
| Mortgages | Mortgage for half the price; lift with 10% interest |
| Trades | Swap cash, properties and Get Out of Jail Free cards; 10% interest charged on mortgaged property received |
| Bankruptcy | To the bank or another player, with buildings sold off and assets transferred per the rules |
| Anything else | **Pay / receive** for a player, or the **⇄ Transfer** button for any account to any account |

Also: Free Parking jackpot house rule, configurable salary/taxes/fines, full transaction
history, unlimited-feeling **Undo** (last 100 actions), and the game auto-saves in the
browser so a refresh or closed tab doesn't lose anything. Payments that would overdraw a
player are allowed for forced payments (rent, tax, cards) and flag them **In debt** so
they can mortgage, sell or go bankrupt; voluntary purchases require the cash.

## Running it

```sh
npm install
npm run dev      # local dev server
npm test         # rules engine tests
npm run build    # static site in dist/
```

`dist/` is a fully static site (relative paths), so it can be hosted anywhere — GitHub
Pages, Netlify, or any web server. On a phone, use "Add to Home Screen" for a full-screen app.

## Code layout

- `src/game/board.ts` — title deed data for the US board
- `src/game/cards.ts` — Chance and Community Chest money cards
- `src/game/engine.ts` — pure rules engine: every transaction is an `Action` applied by `apply()`, with undo
- `src/components/` — React UI (player terminal, trade, setup, shared widgets)
