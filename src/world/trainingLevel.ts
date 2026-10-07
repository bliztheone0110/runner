import type { Vec3 } from '../core/types';
import type { BoxCollider } from '../physics/CollisionWorld';

export interface LevelBox {
  center: Vec3;
  size: Vec3;
  color: number;
  kind: 'floor' | 'wall' | 'obstacle' | 'marker' | 'checkpoint';
  collidable?: boolean;
}
export interface LevelDefinition {
  spawn: Vec3;
  boxes: readonly LevelBox[];
}

export const trainingLevel: LevelDefinition = {
  spawn: { x: 0, y: 0.00001, z: 25 },
  boxes: [
    {
      center: { x: 0, y: -1, z: 0 },
      size: { x: 160, y: 2, z: 160 },
      color: 0x28383f,
      kind: 'floor',
    },
    { center: { x: -80, y: 3, z: 0 }, size: { x: 2, y: 6, z: 162 }, color: 0x39494e, kind: 'wall' },
    { center: { x: 80, y: 3, z: 0 }, size: { x: 2, y: 6, z: 162 }, color: 0x39494e, kind: 'wall' },
    { center: { x: 0, y: 3, z: -80 }, size: { x: 162, y: 6, z: 2 }, color: 0x39494e, kind: 'wall' },
    { center: { x: 0, y: 3, z: 80 }, size: { x: 162, y: 6, z: 2 }, color: 0x39494e, kind: 'wall' },
    {
      center: { x: -14, y: 1, z: 0 },
      size: { x: 5, y: 2, z: 5 },
      color: 0xe7a04f,
      kind: 'obstacle',
    },
    {
      center: { x: 14, y: 1.5, z: -8 },
      size: { x: 4, y: 3, z: 10 },
      color: 0x3bb9a6,
      kind: 'obstacle',
    },
    {
      center: { x: -25, y: 0.5, z: -23 },
      size: { x: 10, y: 1, z: 5 },
      color: 0xe7a04f,
      kind: 'obstacle',
    },
    {
      center: { x: 25, y: 2, z: 18 },
      size: { x: 4, y: 4, z: 4 },
      color: 0x3bb9a6,
      kind: 'obstacle',
    },
  ],
};

export const levelColliders = (definition: LevelDefinition): BoxCollider[] =>
  definition.boxes
    .filter((box) => box.collidable !== false)
    .map(({ center, size }) => ({
      min: { x: center.x - size.x / 2, y: center.y - size.y / 2, z: center.z - size.z / 2 },
      max: { x: center.x + size.x / 2, y: center.y + size.y / 2, z: center.z + size.z / 2 },
    }));
