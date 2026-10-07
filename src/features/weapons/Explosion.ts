import { settings } from '../../config/settings';
import { clamp, type Vec3 } from '../../core/types';
import type { CollisionWorld } from '../../physics/CollisionWorld';
import type { PlayerState } from '../player/PlayerState';
import type { MovementController } from '../player/MovementController';
import type { HealthState } from '../health/HealthState';

export interface ExplosionState {
  id: number;
  position: Vec3;
  normal: Vec3;
  age: number;
}

export function applyExplosion(
  position: Vec3,
  normal: Vec3,
  player: PlayerState,
  movement: MovementController,
  health: HealthState,
  world: CollisionWorld,
): void {
  const { radius, height } = settings.movement;
  const closest = {
    x: clamp(position.x, player.position.x - radius, player.position.x + radius),
    y: clamp(position.y, player.position.y, player.position.y + height),
    z: clamp(position.z, player.position.z - radius, player.position.z + radius),
  };
  const distance = Math.hypot(
    position.x - closest.x,
    position.y - closest.y,
    position.z - closest.z,
  );
  const factor = Math.max(0, 1 - distance / settings.weapons.blastRadius);
  if (factor <= 0 || health.dead) {
    return;
  }
  const center = { x: player.position.x, y: player.position.y + height / 2, z: player.position.z };
  const visibleFrom = {
    x: position.x + normal.x * 0.01,
    y: position.y + normal.y * 0.01,
    z: position.z + normal.z * 0.01,
  };
  if (world.traceSegment(visibleFrom, center)) {
    return;
  }
  const direction = {
    x: center.x - position.x,
    y: center.y - position.y,
    z: center.z - position.z,
  };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  const strength = settings.weapons.blastImpulse * factor;
  movement.applyImpulse(
    length > 1e-8
      ? {
          x: (direction.x / length) * strength,
          y: (direction.y / length) * strength,
          z: (direction.z / length) * strength,
        }
      : { x: 0, y: strength, z: 0 },
  );
  health.damage(settings.weapons.blastDamage * factor);
}
