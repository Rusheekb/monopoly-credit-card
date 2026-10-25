import { useState } from 'react';
import { DEFAULT_SETTINGS, type NewPlayer, type Settings } from '../game/engine';
import { PLAYER_COLORS } from '../format';
import { NumberField, Toggle } from './ui';

export function SettingsForm({
  settings,
  onChange,
  inGame,
}: {
  settings: Settings;
  onChange: (s: Partial<Settings>) => void;
  inGame?: boolean;
}) {
  return (
    <div className="settings">
      <h3>Money</h3>
      {!inGame && <NumberField label="Starting cash" value={settings.startingCash} onChange={(v) => onChange({ startingCash: v })} />}
      <NumberField label="Salary for passing GO" value={settings.goSalary} onChange={(v) => onChange({ goSalary: v })} />
      <NumberField label="Income Tax" value={settings.incomeTax} onChange={(v) => onChange({ incomeTax: v })} />
      <NumberField label="Luxury Tax" value={settings.luxuryTax} onChange={(v) => onChange({ luxuryTax: v })} />
      <NumberField label="Jail fine" value={settings.jailFine} onChange={(v) => onChange({ jailFine: v })} />
      <h3>Rules</h3>
      <Toggle
        label="Free Parking jackpot"
        hint="Taxes, fines and card payments go into a pot. Land on Free Parking to collect it."
        checked={settings.freeParkingJackpot}
        onChange={(v) => onChange({ freeParkingJackpot: v })}
      />
      <Toggle
        label="Double salary for landing on GO"
        checked={settings.doubleGoOnLanding}
        onChange={(v) => onChange({ doubleGoOnLanding: v })}
      />
      <Toggle
        label="Build evenly"
        hint="Official rule: houses go up and come down one at a time across a color group."
        checked={settings.evenBuilding}
        onChange={(v) => onChange({ evenBuilding: v })}
      />
      <Toggle
        label="Housing shortage"
        hint="The bank has only 32 houses and 12 hotels."
        checked={settings.limitedBuildings}
        onChange={(v) => onChange({ limitedBuildings: v })}
      />
    </div>
  );
}

export function Setup({
  onStart,
  onBack,
  hosting,
}: {
  onStart: (players: NewPlayer[], settings: Settings) => void;
  onBack: () => void;
  hosting: boolean;
}) {
  const [players, setPlayers] = useState<NewPlayer[]>([
    { name: '', color: PLAYER_COLORS[0] },
    { name: '', color: PLAYER_COLORS[1] },
  ]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showRules, setShowRules] = useState(false);

  const update = (i: number, p: Partial<NewPlayer>) => setPlayers((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const nextColor = (c: string) => {
    const used = new Set(players.map((p) => p.color));
    const start = PLAYER_COLORS.indexOf(c);
    for (let i = 1; i <= PLAYER_COLORS.length; i++) {
      const cand = PLAYER_COLORS[(start + i) % PLAYER_COLORS.length];
      if (!used.has(cand)) return cand;
    }
    return c;
  };
  const add = () => {
    const used = new Set(players.map((p) => p.color));
    setPlayers((ps) => [...ps, { name: '', color: PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0] }]);
  };

  return (
    <main className="setup">
      <button className="link-back" onClick={onBack}>
        ‹ Back
      </button>
      <div className="hero">
        <h1 className="small-title">{hosting ? 'Host a game' : 'Single-device game'}</h1>
        <p>
          {hosting
            ? 'Add everyone who’s playing. Next you’ll get a code for the others to join from their phones.'
            : 'Add everyone who’s playing. This phone will be the bank.'}
        </p>
      </div>

      <section className="panel">
        <h3>Players</h3>
        {players.map((p, i) => (
          <div className="player-row" key={i}>
            <button
              className="color-swatch"
              style={{ background: p.color }}
              onClick={() => update(i, { color: nextColor(p.color) })}
              aria-label="Change color"
              title="Tap to change color"
            />
            <input
              value={p.name}
              placeholder={`Player ${i + 1}`}
              maxLength={16}
              onChange={(e) => update(i, { name: e.target.value })}
              aria-label={`Player ${i + 1} name`}
            />
            {players.length > 2 && (
              <button className="icon-btn" onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))} aria-label="Remove player">
                ×
              </button>
            )}
          </div>
        ))}
        {players.length < 8 && (
          <button className="btn ghost" onClick={add}>
            + Add player
          </button>
        )}
      </section>

      <section className="panel">
        <button className="disclosure" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
          <span>Rules &amp; house rules</span>
          <span>{showRules ? '−' : '+'}</span>
        </button>
        {!showRules && (
          <p className="muted small">
            ${settings.startingCash.toLocaleString()} each · ${settings.goSalary} for GO
            {settings.freeParkingJackpot ? ' · Free Parking jackpot' : ''}
          </p>
        )}
        {showRules && <SettingsForm settings={settings} onChange={(s) => setSettings((x) => ({ ...x, ...s }))} />}
      </section>

      <button className="btn primary big" onClick={() => onStart(players, settings)}>
        {hosting ? 'Create room' : 'Deal cards'}
      </button>
    </main>
  );
}
