export const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

export const PLAYER_COLORS = ['#d62828', '#2563eb', '#059669', '#b45309', '#7c3aed', '#ea580c', '#db2777', '#0f766e'];

/** A stable fake card number suffix for a player. */
export const cardDigits = (id: string, name: string) => {
  let h = 7;
  for (const c of id + name) h = (h * 31 + c.charCodeAt(0)) % 10000;
  return String(h).padStart(4, '0');
};
