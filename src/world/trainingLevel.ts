import type { Vec3 } from '../core/types';
import type { WorldCollider } from '../physics/CollisionWorld';

export interface LevelBox {
  center: Vec3;
  size: Vec3;
  color: number;
  kind: 'floor' | 'wall' | 'obstacle' | 'ramp' | 'rampRoof' | 'lava' | 'marker' | 'checkpoint';
  texture?: 'floorStone' | 'wallRock' | 'lava' | 'timberTexture';
  collidable?: boolean;
  yaw?: number;
  pitch?: number;
  colliderSize?: Vec3;
  landingLength?: number;
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

export const levelColliders = (definition: LevelDefinition): WorldCollider[] =>
  definition.boxes.flatMap<WorldCollider>((box) => {
    if (box.collidable === false) {
      return [];
    }
    if (box.kind === 'ramp') {
      const forward = { x: -Math.sin(box.yaw ?? 0), z: -Math.cos(box.yaw ?? 0) };
      return [{
        kind: 'ramp' as const,
        start: {
          x: box.center.x - forward.x * box.size.z / 2,
          y: box.center.y - box.size.y / 2,
          z: box.center.z - forward.z * box.size.z / 2,
        },
        yaw: box.yaw ?? 0,
        width: box.size.x,
        length: box.size.z,
        rise: box.size.y,
        landingLength: box.landingLength ?? 0,
      }];
    }
    const colliderSize = box.colliderSize ?? box.size;
    return [{
      kind: 'box' as const,
      min: {
        x: box.center.x - colliderSize.x / 2,
        y: box.center.y - colliderSize.y / 2,
        z: box.center.z - colliderSize.z / 2,
      },
      max: {
        x: box.center.x + colliderSize.x / 2,
        y: box.center.y + colliderSize.y / 2,
        z: box.center.z + colliderSize.z / 2,
      },
    }];
  });
