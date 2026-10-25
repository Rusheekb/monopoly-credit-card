import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { apply, playerName, undo, type Action, type GameState, type PlayerId } from '../game/engine';
import { saveGame, saveSession } from '../storage';
import { guestMayPerform } from './permissions';
import {
  PROTOCOL_VERSION,
  peerIdFor,
  type GuestGame,
  type PendingTrade,
  type RoomView,
  type ToGuest,
  type ToHost,
} from './protocol';

export type Mode = 'local' | 'host' | 'guest';
export type Status = 'online' | 'connecting' | 'reconnecting' | 'ended';

export interface View {
  mode: Mode;
  /** Null only for a guest still waiting for the host's first update. */
  game: GameState | null;
  room: RoomView | null;
  status: Status;
  statusText?: string;
  clientId: string;
  /** The player this device is playing as, if any. */
  seat: PlayerId | null;
  /** May act on every player's card (single-device games and the host). */
  isBanker: boolean;
  canUndo: boolean;
}

export interface Notice {
  text: string;
  error?: boolean;
}

export interface Controller {
  getView(): View;
  subscribe(fn: () => void): () => void;
  onNotice(fn: (n: Notice) => void): () => void;
  /** Validates and performs an action. Returns false (and posts a notice) if it was rejected. */
  dispatch(a: Action): boolean;
  undo(): void;
  claimSeat(seat: PlayerId | null): void;
  replyTrade(id: number, accept: boolean): void;
  cancelTrade(id: number): void;
  destroy(): void;
}

const GUEST_LOG_LIMIT = 200;
const PING_MS = 4000;
const STALE_MS = 15000;

/** PeerJS signaling server: the free public one, or `?peer=host:port` for a self-hosted server. */
function peerOptions(): PeerOptions {
  const custom = new URLSearchParams(window.location.search).get('peer');
  if (!custom) return {};
  const [host, port] = custom.split(':');
  const secure = window.location.protocol === 'https:' && host !== 'localhost';
  return { host, port: Number(port) || (secure ? 443 : 80), path: '/', secure };
}

abstract class Store implements Pick<Controller, 'getView' | 'subscribe' | 'onNotice'> {
  protected abstract view: View;
  private subs = new Set<() => void>();
  private noticeSubs = new Set<(n: Notice) => void>();

  getView = () => this.view;

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };

  onNotice = (fn: (n: Notice) => void) => {
    this.noticeSubs.add(fn);
    return () => void this.noticeSubs.delete(fn);
  };

  protected set(patch: Partial<View>) {
    this.view = { ...this.view, ...patch };
    for (const fn of this.subs) fn();
  }

  protected notice(text: string, error = false) {
    for (const fn of this.noticeSubs) fn({ text, error });
  }
}

// ---------------------------------------------------------------------------
// One device passed around the table.

export class LocalController extends Store implements Controller {
  protected view: View;

  constructor(game: GameState, clientId: string) {
    super();
    this.view = { mode: 'local', game, room: null, status: 'online', clientId, seat: null, isBanker: true, canUndo: game.past.length > 0 };
    saveSession({ mode: 'local' });
    saveGame(game);
  }

  private commit(game: GameState) {
    saveGame(game);
    this.set({ game, canUndo: game.past.length > 0 });
  }

  dispatch(a: Action): boolean {
    const r = apply(this.view.game!, a);
    if (!r.ok) {
      this.notice(r.error, true);
      return false;
    }
    this.commit(r.state);
    return true;
  }

  undo() {
    const prev = undo(this.view.game!);
    if (prev) this.commit(prev);
  }

  claimSeat() {}
  replyTrade() {}
  cancelTrade() {}
  destroy() {}
}

// ---------------------------------------------------------------------------
// The host keeps the real game and relays it to every guest.

export class HostController extends Store implements Controller {
  protected view: View;
  private game: GameState;
  private code: string;
  private seats: Record<PlayerId, string>;
  private trade: PendingTrade | null = null;
  private nextTradeId = 1;
  /** clientId behind each undo snapshot, aligned with game.past. */
  private actors: string[];
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private lastHeard = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private destroyed = false;

  constructor(game: GameState, code: string, clientId: string, seats: Record<PlayerId, string> = {}) {
    super();
    this.game = game;
    this.code = code;
    this.seats = seats;
    this.actors = game.past.map(() => clientId);
    this.view = {
      mode: 'host',
      game,
      room: null,
      status: 'connecting',
      clientId,
      seat: null,
      isBanker: true,
      canUndo: game.past.length > 0,
    };
    this.persist();
    this.publish();
    this.open();
    this.timer = setInterval(() => this.heartbeat(), PING_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  // --- networking ---

  private open() {
    if (this.destroyed) return;
    const peer = new Peer(peerIdFor(this.code), peerOptions());
    this.peer = peer;
    let opened = false;
    peer.on('open', () => {
      opened = true;
      this.attempts = 0;
      this.set({ status: 'online', statusText: undefined });
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (this.destroyed || peer.destroyed) return;
      this.set({ status: 'reconnecting', statusText: 'Lost the signaling server — players already connected can keep playing.' });
      setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 2000);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      if (err.type === 'unavailable-id') {
        // Usually our own previous session that the server hasn't timed out yet.
        this.set({ status: 'reconnecting', statusText: `Reclaiming room ${this.code}…` });
      } else {
        this.set({ status: 'reconnecting', statusText: 'Connection problem — retrying…' });
      }
      // Once registered, a lost signaling socket is handled by reconnect() above and
      // existing guest connections stay up. Start over only if we never got going.
      if (err.type === 'unavailable-id' || !opened || peer.destroyed) this.reopen();
    });
  }

  private reopen() {
    if (this.retry || this.destroyed) return;
    this.peer?.destroy();
    this.conns.clear();
    const delay = Math.min(2000 * 2 ** Math.min(this.attempts++, 3), 15000);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, delay);
  }

  private onVisible = () => {
    if (document.visibilityState !== 'visible' || !this.peer) return;
    if (this.peer.destroyed) this.reopen();
    else if (this.peer.disconnected) this.peer.reconnect();
    this.broadcast();
  };

  private accept(conn: DataConnection) {
    let id: string | null = null;
    conn.on('data', (raw) => {
      const msg = raw as ToHost;
      if (!id) {
        if (msg.t !== 'hello' || msg.v !== PROTOCOL_VERSION) {
          conn.send({ t: 'notice', text: 'This game is running a different version of the app. Refresh to update.', error: true } satisfies ToGuest);
          return;
        }
        id = msg.clientId;
        const old = this.conns.get(id);
        if (old && old !== conn) old.close();
        this.conns.set(id, conn);
        this.lastHeard.set(id, Date.now());
        this.publish();
        return;
      }
      this.lastHeard.set(id, Date.now());
      this.handle(id, msg);
    });
    const drop = () => {
      if (id && this.conns.get(id) === conn) {
        this.conns.delete(id);
        this.publish();
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private heartbeat() {
    const now = Date.now();
    for (const [id, conn] of this.conns) {
      if (now - (this.lastHeard.get(id) ?? 0) > STALE_MS) {
        this.conns.delete(id);
        conn.close();
        this.publish();
      } else {
        conn.send({ t: 'ping' } satisfies ToGuest);
      }
    }
  }

  private send(clientId: string, msg: ToGuest) {
    if (clientId === this.view.clientId) {
      if (msg.t === 'notice') this.notice(msg.text, msg.error);
      return;
    }
    const c = this.conns.get(clientId);
    if (c?.open) c.send(msg);
  }

  // --- room state ---

  private roomView(): RoomView {
    return {
      code: this.code,
      hostId: this.view.clientId,
      seats: this.seats,
      online: [this.view.clientId, ...this.conns.keys()],
      trade: this.trade,
      lastActor: this.actors.at(-1) ?? null,
    };
  }

  private guestGame(): GuestGame {
    const { past: _past, log, ...rest } = this.game;
    return { ...rest, log: log.slice(-GUEST_LOG_LIMIT) };
  }

  private seatOf(clientId: string): PlayerId | null {
    return Object.keys(this.seats).find((p) => this.seats[p] === clientId) ?? null;
  }

  /** Refresh our own view and push the state to every guest. */
  private publish() {
    const room = this.roomView();
    this.set({ game: this.game, room, seat: this.seatOf(this.view.clientId), canUndo: this.game.past.length > 0 });
    this.broadcast(room);
  }

  private broadcast(room = this.roomView()) {
    const msg: ToGuest = { t: 'state', game: this.guestGame(), room };
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  private persist() {
    saveGame(this.game);
    saveSession({ mode: 'host', code: this.code, seats: this.seats });
  }

  private isOnline(clientId: string) {
    return clientId === this.view.clientId || this.conns.has(clientId);
  }

  // --- actions from anyone (host included) ---

  private handle(from: string, msg: ToHost) {
    switch (msg.t) {
      case 'action':
        if (!guestMayPerform(this.game, this.seatOf(from), msg.action)) {
          this.send(from, { t: 'notice', text: 'You can only do that from your own card.', error: true });
          return;
        }
        this.submit(from, msg.action);
        return;
      case 'undo':
        this.undoFrom(from);
        return;
      case 'claim':
        this.claim(from, msg.seat);
        return;
      case 'tradeReply':
        this.reply(from, msg.id, msg.accept);
        return;
      case 'tradeCancel':
        this.cancel(from, msg.id);
        return;
      case 'hello':
      case 'ping':
        return;
    }
  }

  private submit(from: string, action: Action): boolean {
    if (action.type === 'trade') {
      const partner = this.seats[action.b];
      // If the other player is on their own device, they confirm the trade there.
      if (partner && partner !== from && this.isOnline(partner)) {
        const check = apply(this.game, action);
        if (!check.ok) {
          this.send(from, { t: 'notice', text: check.error, error: true });
          return false;
        }
        if (this.trade) {
          this.send(from, { t: 'notice', text: 'Another trade offer is still waiting for an answer.', error: true });
          return false;
        }
        this.trade = { id: this.nextTradeId++, action, by: from };
        this.send(from, { t: 'notice', text: `Trade offer sent to ${playerName(this.game, action.b)}` });
        this.publish();
        return true;
      }
    }
    const r = apply(this.game, action);
    if (!r.ok) {
      this.send(from, { t: 'notice', text: r.error, error: true });
      return false;
    }
    this.game = r.state;
    this.actors = [...this.actors, from].slice(-this.game.past.length);
    this.persist();
    this.publish();
    return true;
  }

  private undoFrom(from: string) {
    if (from !== this.view.clientId && this.actors.at(-1) !== from) {
      this.send(from, { t: 'notice', text: 'Only the host can undo other players’ actions.', error: true });
      return;
    }
    const prev = undo(this.game);
    if (!prev) return;
    this.game = prev;
    this.actors = this.actors.slice(0, -1);
    this.persist();
    this.publish();
  }

  private claim(from: string, seat: PlayerId | null) {
    if (seat) {
      const player = this.game.players.find((p) => p.id === seat);
      if (!player) return;
      const holder = this.seats[seat];
      if (holder && holder !== from && this.isOnline(holder)) {
        this.send(from, { t: 'notice', text: `${player.name} is already being played on another device.`, error: true });
        return;
      }
    }
    for (const p of Object.keys(this.seats)) if (this.seats[p] === from) delete this.seats[p];
    if (seat) this.seats[seat] = from;
    this.seats = { ...this.seats };
    this.persist();
    this.publish();
  }

  private reply(from: string, id: number, accept: boolean) {
    const t = this.trade;
    if (!t || t.id !== id) return;
    if (this.seats[t.action.b] !== from && from !== this.view.clientId) return;
    this.trade = null;
    if (!accept) {
      this.send(t.by, { t: 'notice', text: `${playerName(this.game, t.action.b)} declined the trade.`, error: true });
      this.publish();
      return;
    }
    if (!this.submitTrade(t)) this.publish();
  }

  private submitTrade(t: PendingTrade): boolean {
    const r = apply(this.game, t.action);
    if (!r.ok) {
      this.send(t.by, { t: 'notice', text: r.error, error: true });
      return false;
    }
    this.game = r.state;
    this.actors = [...this.actors, t.by].slice(-this.game.past.length);
    this.persist();
    this.publish();
    return true;
  }

  private cancel(from: string, id: number) {
    if (this.trade?.id !== id) return;
    if (this.trade.by !== from && from !== this.view.clientId) return;
    this.trade = null;
    this.publish();
  }

  // --- Controller API for the host's own screen ---

  dispatch(a: Action): boolean {
    return this.submit(this.view.clientId, a);
  }
  undo() {
    this.undoFrom(this.view.clientId);
  }
  claimSeat(seat: PlayerId | null) {
    this.claim(this.view.clientId, seat);
  }
  replyTrade(id: number, accept: boolean) {
    this.reply(this.view.clientId, id, accept);
  }
  cancelTrade(id: number) {
    this.cancel(this.view.clientId, id);
  }

  /** Tell guests the game is over, then shut down. */
  end() {
    for (const c of this.conns.values()) if (c.open) c.send({ t: 'ended' } satisfies ToGuest);
    setTimeout(() => this.destroy(), 300);
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.peer?.destroy();
  }
}

// ---------------------------------------------------------------------------
// A guest mirrors the host's game and sends it actions.

export class GuestController extends Store implements Controller {
  protected view: View;
  private code: string;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private lastHeard = 0;
  private everConnected = false;
  private timer: ReturnType<typeof setInterval>;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(code: string, clientId: string) {
    super();
    this.code = code;
    this.view = { mode: 'guest', game: null, room: null, status: 'connecting', clientId, seat: null, isBanker: false, canUndo: false };
    saveSession({ mode: 'guest', code });
    this.connect();
    this.timer = setInterval(() => this.heartbeat(), PING_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private connect() {
    if (this.destroyed) return;
    const peer = this.peer;
    if (!peer || peer.destroyed) {
      const p = new Peer(peerOptions());
      this.peer = p;
      p.on('open', () => this.dial());
      p.on('disconnected', () => !p.destroyed && setTimeout(() => !p.destroyed && p.disconnected && p.reconnect(), 2000));
      p.on('error', (err) => {
        if (this.destroyed) return;
        if (err.type === 'peer-unavailable') {
          this.set({
            status: this.everConnected ? 'reconnecting' : 'connecting',
            statusText: this.everConnected
              ? 'Waiting for the host’s device…'
              : `No game found with code ${this.code} yet. Check the code, and that the host has the app open.`,
          });
          this.schedule(3000);
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type) && !this.conn?.open) {
          p.destroy();
          this.set({ status: 'reconnecting', statusText: 'Connection problem — retrying…' });
          this.schedule(3000);
        }
      });
    } else if (peer.disconnected) {
      peer.reconnect();
      this.schedule(3000);
    } else if (peer.open) {
      this.dial();
    }
  }

  private dial() {
    if (this.destroyed || !this.peer?.open) return;
    this.conn?.close();
    const conn = this.peer.connect(peerIdFor(this.code), { reliable: true });
    this.conn = conn;
    conn.on('open', () => {
      this.lastHeard = Date.now();
      conn.send({ t: 'hello', v: PROTOCOL_VERSION, clientId: this.view.clientId } satisfies ToHost);
    });
    conn.on('data', (raw) => {
      if (conn !== this.conn) return;
      this.lastHeard = Date.now();
      this.handle(raw as ToGuest);
    });
    const lost = () => {
      if (conn !== this.conn || this.destroyed) return;
      this.conn = null;
      if (this.view.status !== 'ended') {
        this.set({ status: 'reconnecting', statusText: 'Reconnecting to the host…' });
        this.schedule(1500);
      }
    };
    conn.on('close', lost);
    conn.on('error', lost);
  }

  private schedule(ms: number) {
    if (this.retry || this.destroyed) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, ms);
  }

  private heartbeat() {
    if (!this.conn?.open) {
      if (!this.retry && this.view.status !== 'ended' && !this.dialing()) this.schedule(0);
      return;
    }
    if (Date.now() - this.lastHeard > STALE_MS) {
      const c = this.conn;
      this.conn = null;
      c.close();
      this.set({ status: 'reconnecting', statusText: 'Reconnecting to the host…' });
      this.schedule(0);
      return;
    }
    this.conn.send({ t: 'ping' } satisfies ToHost);
  }

  private dialing() {
    return !!this.conn && !this.conn.open;
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible' && !this.conn?.open) this.schedule(0);
  };

  private handle(msg: ToGuest) {
    switch (msg.t) {
      case 'state': {
        this.everConnected = true;
        const seat = Object.keys(msg.room.seats).find((p) => msg.room.seats[p] === this.view.clientId) ?? null;
        this.set({
          game: { ...msg.game, past: [] },
          room: msg.room,
          seat,
          status: 'online',
          statusText: undefined,
          canUndo: msg.room.lastActor === this.view.clientId,
        });
        return;
      }
      case 'notice':
        this.notice(msg.text, msg.error);
        return;
      case 'ended':
        this.set({ status: 'ended', statusText: 'The host ended this game.' });
        this.destroy();
        return;
      case 'ping':
        return;
    }
  }

  private send(msg: ToHost): boolean {
    if (!this.conn?.open) {
      this.notice('Not connected to the host right now — try again in a moment.', true);
      return false;
    }
    this.conn.send(msg);
    return true;
  }

  dispatch(a: Action): boolean {
    const game = this.view.game;
    if (!game) return false;
    if (!guestMayPerform(game, this.view.seat, a)) {
      this.notice(this.view.seat ? 'You can only do that from your own card.' : 'Pick which player you are first.', true);
      return false;
    }
    // Check locally for instant feedback; the host re-checks against the real game.
    const r = apply(game, a);
    if (!r.ok) {
      this.notice(r.error, true);
      return false;
    }
    return this.send({ t: 'action', action: a });
  }

  undo() {
    this.send({ t: 'undo' });
  }
  claimSeat(seat: PlayerId | null) {
    this.send({ t: 'claim', seat });
  }
  replyTrade(id: number, accept: boolean) {
    this.send({ t: 'tradeReply', id, accept });
  }
  cancelTrade(id: number) {
    this.send({ t: 'tradeCancel', id });
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    if (this.retry) clearTimeout(this.retry);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.conn?.close();
    this.peer?.destroy();
  }
}
