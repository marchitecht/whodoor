import type { World } from './world.ts';

export const MAX_PLAYERS = 8;
export const TICK_HZ = 60;
export const SNAP_EVERY = 3; // 20 snapshots per second
export const WIN_PAUSE_MS = 2500;
export const COLORS = ['#E5322D', '#10935F', '#E8A300', '#7B4DDB', '#E0428F', '#0F9AA8', '#F26B1D', '#4A4E5A'];

export interface LobbyPlayer { id: string; name: string; color: string; score: number; deaths: number; bot?: boolean }

/** Compact player state relayed to everyone: [id, x, y, face, alive(0/1)] */
export type PSnap = [string, number, number, number, number];

export type C2S =
  | { t: 'join'; name: string; room?: string }
  | { t: 'start' }
  | { t: 'restart' }
  | { t: 'bot'; add: boolean }
  | { t: 'st'; x: number; y: number; f: number; g: 0 | 1; a: 0 | 1 }
  | { t: 'die'; m: string }
  | { t: 'door'; lvl: number }
  | { t: 'poke' }
  | { t: 'skip' }
  | { t: 'draw'; pts: [number, number][] }
  | { t: 'ans'; i: number };

export type Phase = 'lobby' | 'play' | 'won' | 'end';

export type S2C =
  | { t: 'hi'; id: string; room: string }
  | { t: 'lobby'; code: string; host: string; phase: Phase; players: LobbyPlayer[] }
  | { t: 'lvl'; w: World }
  | { t: 'snap'; w: World; ps: PSnap[] }
  | { t: 'fx'; k: 'die' | 'bub'; id: string; m: string }
  | { t: 'won'; id: string; lvl: number }
  | { t: 'end' }
  | { t: 'err'; m: string };
