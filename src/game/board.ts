// Title deed data for the standard US board.

export type StreetGroup =
  | 'brown'
  | 'lightblue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'darkblue';

export type Group = StreetGroup | 'railroad' | 'utility';

interface BaseProperty {
  id: string;
  name: string;
  group: Group;
  price: number;
  mortgage: number;
}

export interface Street extends BaseProperty {
  kind: 'street';
  group: StreetGroup;
  houseCost: number;
  /** [unimproved, 1 house, 2, 3, 4, hotel] */
  rent: [number, number, number, number, number, number];
}

export interface Railroad extends BaseProperty {
  kind: 'railroad';
  group: 'railroad';
}

export interface Utility extends BaseProperty {
  kind: 'utility';
  group: 'utility';
}

export type Property = Street | Railroad | Utility;

const street = (
  id: string,
  name: string,
  group: StreetGroup,
  price: number,
  houseCost: number,
  rent: Street['rent'],
): Street => ({ kind: 'street', id, name, group, price, mortgage: price / 2, houseCost, rent });

const railroad = (id: string, name: string): Railroad => ({
  kind: 'railroad',
  id,
  name,
  group: 'railroad',
  price: 200,
  mortgage: 100,
});

const utility = (id: string, name: string): Utility => ({
  kind: 'utility',
  id,
  name,
  group: 'utility',
  price: 150,
  mortgage: 75,
});

/** All purchasable spaces, in board order. */
export const PROPERTIES: Property[] = [
  street('mediterranean', 'Mediterranean Avenue', 'brown', 60, 50, [2, 10, 30, 90, 160, 250]),
  street('baltic', 'Baltic Avenue', 'brown', 60, 50, [4, 20, 60, 180, 320, 450]),
  railroad('reading', 'Reading Railroad'),
  street('oriental', 'Oriental Avenue', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  street('vermont', 'Vermont Avenue', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  street('connecticut', 'Connecticut Avenue', 'lightblue', 120, 50, [8, 40, 100, 300, 450, 600]),
  street('stcharles', 'St. Charles Place', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  utility('electric', 'Electric Company'),
  street('states', 'States Avenue', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  street('virginia', 'Virginia Avenue', 'pink', 160, 100, [12, 60, 180, 500, 700, 900]),
  railroad('pennsylvaniarr', 'Pennsylvania Railroad'),
  street('stjames', 'St. James Place', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  street('tennessee', 'Tennessee Avenue', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  street('newyork', 'New York Avenue', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000]),
  street('kentucky', 'Kentucky Avenue', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  street('indiana', 'Indiana Avenue', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  street('illinois', 'Illinois Avenue', 'red', 240, 150, [20, 100, 300, 750, 925, 1100]),
  railroad('bo', 'B. & O. Railroad'),
  street('atlantic', 'Atlantic Avenue', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  street('ventnor', 'Ventnor Avenue', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  utility('water', 'Water Works'),
  street('marvin', 'Marvin Gardens', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200]),
  street('pacific', 'Pacific Avenue', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  street('northcarolina', 'North Carolina Avenue', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  street('pennsylvania', 'Pennsylvania Avenue', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  railroad('shortline', 'Short Line'),
  street('parkplace', 'Park Place', 'darkblue', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  street('boardwalk', 'Boardwalk', 'darkblue', 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];

export const PROPERTY_BY_ID: Record<string, Property> = Object.fromEntries(
  PROPERTIES.map((p) => [p.id, p]),
);

export const GROUP_MEMBERS: Record<Group, string[]> = PROPERTIES.reduce(
  (acc, p) => {
    (acc[p.group] ||= []).push(p.id);
    return acc;
  },
  {} as Record<Group, string[]>,
);

export const GROUP_ORDER: Group[] = [
  'brown',
  'lightblue',
  'pink',
  'orange',
  'red',
  'yellow',
  'green',
  'darkblue',
  'railroad',
  'utility',
];

export const GROUP_COLOR: Record<Group, string> = {
  brown: '#8b5a3c',
  lightblue: '#a8dcf0',
  pink: '#d63c8f',
  orange: '#f39324',
  red: '#e2262b',
  yellow: '#fbe122',
  green: '#1fa65a',
  darkblue: '#1f5aa8',
  railroad: '#2b2b2b',
  utility: '#b9c2cc',
};

export const GROUP_LABEL: Record<Group, string> = {
  brown: 'Brown',
  lightblue: 'Light Blue',
  pink: 'Pink',
  orange: 'Orange',
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  darkblue: 'Dark Blue',
  railroad: 'Railroads',
  utility: 'Utilities',
};

export const TOTAL_HOUSES = 32;
export const TOTAL_HOTELS = 12;
