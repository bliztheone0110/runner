import type { GameSystem, Vec3 } from '../core/types';
import type { SpawnProvider } from './CorridorGenerator';

export type GameMode = 'corridor' | 'training';
export interface WorldStats {
  distance: number;
  checkpoint: number;
  activeChunks: number;
}
export interface GameWorld extends GameSystem, SpawnProvider, WorldStats {
  contains(position: Vec3): boolean;
  afterMovement(): void;
  dispose(): void;
}
