// Chance and Community Chest cards that move money. Movement-only cards
// (Go to Jail, Go Back 3 Spaces, ...) are omitted; cards that move you onto
// a property are handled through the Pass GO / Rent / Buy actions.

export type CardEffect =
  | { kind: 'collect'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'collectEach'; amount: number }
  | { kind: 'payEach'; amount: number }
  | { kind: 'repairs'; perHouse: number; perHotel: number }
  | { kind: 'advanceToGo' }
  | { kind: 'jailCard' };

export interface Card {
  id: string;
  deck: 'chance' | 'chest';
  text: string;
  effect: CardEffect;
}

export const CARDS: Card[] = [
  { id: 'ch-go', deck: 'chance', text: 'Advance to GO', effect: { kind: 'advanceToGo' } },
  { id: 'ch-dividend', deck: 'chance', text: 'Bank pays you dividend', effect: { kind: 'collect', amount: 50 } },
  { id: 'ch-loan', deck: 'chance', text: 'Your building loan matures', effect: { kind: 'collect', amount: 150 } },
  { id: 'ch-speeding', deck: 'chance', text: 'Speeding fine', effect: { kind: 'pay', amount: 15 } },
  { id: 'ch-chairman', deck: 'chance', text: 'Elected Chairman of the Board — pay each player', effect: { kind: 'payEach', amount: 50 } },
  { id: 'ch-repairs', deck: 'chance', text: 'Make general repairs on all your property', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 'ch-jail', deck: 'chance', text: 'Get Out of Jail Free', effect: { kind: 'jailCard' } },

  { id: 'cc-go', deck: 'chest', text: 'Advance to GO', effect: { kind: 'advanceToGo' } },
  { id: 'cc-bankerror', deck: 'chest', text: 'Bank error in your favor', effect: { kind: 'collect', amount: 200 } },
  { id: 'cc-doctor', deck: 'chest', text: "Doctor's fee", effect: { kind: 'pay', amount: 50 } },
  { id: 'cc-stock', deck: 'chest', text: 'From sale of stock you get', effect: { kind: 'collect', amount: 50 } },
  { id: 'cc-holiday', deck: 'chest', text: 'Holiday fund matures', effect: { kind: 'collect', amount: 100 } },
  { id: 'cc-taxrefund', deck: 'chest', text: 'Income tax refund', effect: { kind: 'collect', amount: 20 } },
  { id: 'cc-birthday', deck: 'chest', text: "It's your birthday — collect from every player", effect: { kind: 'collectEach', amount: 10 } },
  { id: 'cc-life', deck: 'chest', text: 'Life insurance matures', effect: { kind: 'collect', amount: 100 } },
  { id: 'cc-hospital', deck: 'chest', text: 'Pay hospital fees', effect: { kind: 'pay', amount: 100 } },
  { id: 'cc-school', deck: 'chest', text: 'Pay school fees', effect: { kind: 'pay', amount: 50 } },
  { id: 'cc-consult', deck: 'chest', text: 'Receive consultancy fee', effect: { kind: 'collect', amount: 25 } },
  { id: 'cc-street', deck: 'chest', text: 'Assessed for street repairs', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 'cc-beauty', deck: 'chest', text: 'Second prize in a beauty contest', effect: { kind: 'collect', amount: 10 } },
  { id: 'cc-inherit', deck: 'chest', text: 'You inherit', effect: { kind: 'collect', amount: 100 } },
  { id: 'cc-jail', deck: 'chest', text: 'Get Out of Jail Free', effect: { kind: 'jailCard' } },
];

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
