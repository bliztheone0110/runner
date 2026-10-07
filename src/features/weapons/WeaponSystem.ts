import { settings } from '../../config/settings';
import { copy, type GameSystem, type Vec3 } from '../../core/types';
import type { InputSystem } from '../../input/InputSystem';
import type { CollisionWorld, SegmentHit } from '../../physics/CollisionWorld';
import type { PlayerState } from '../player/PlayerState';
import type { MovementController } from '../player/MovementController';
import type { HealthState } from '../health/HealthState';
import { applyExplosion, type ExplosionState } from './Explosion';
import { silentEvents, type EventSink } from '../../core/GameEvents';
import { translate } from '../../world/CorridorGenerator';

export interface RocketState {
  id: number;
  position: Vec3;
  previousPosition: Vec3;
  direction: Vec3;
  age: number;
}

export class WeaponSystem implements GameSystem {
  readonly rockets: RocketState[] = [];
  readonly explosions: ExplosionState[] = [];
  private nextId = 0;
  private cooldown = 0;

  constructor(
    private readonly player: PlayerState,
    private readonly movement: MovementController,
    private readonly health: HealthState,
    private readonly input: InputSystem,
    private readonly world: CollisionWorld,
    private readonly events: EventSink = silentEvents,
    private readonly contains: (position: Vec3) => boolean = () => true,
  ) {}

  fixedUpdate(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (let index = this.explosions.length - 1; index >= 0; index--) {
      this.explosions[index].age += dt;
      if (this.explosions[index].age >= settings.weapons.explosionDuration) {
        this.explosions.splice(index, 1);
      }
    }
    if (this.input.snapshot.firePressed && this.cooldown <= 1e-8 && !this.health.dead) {
      this.fire();
    }
    for (let index = this.rockets.length - 1; index >= 0; index--) {
      const rocket = this.rockets[index];
      if (!this.contains(rocket.position)) {
        this.rockets.splice(index, 1);
        continue;
      }
      copy(rocket.previousPosition, rocket.position);
      const duration = Math.min(dt, settings.weapons.rocketLifetime - rocket.age);
      const next = {
        x: rocket.position.x + rocket.direction.x * settings.weapons.rocketSpeed * duration,
        y: rocket.position.y + rocket.direction.y * settings.weapons.rocketSpeed * duration,
        z: rocket.position.z + rocket.direction.z * settings.weapons.rocketSpeed * duration,
      };
      const hit = this.world.traceSegment(rocket.position, next, settings.weapons.rocketRadius);
      rocket.age += duration;
      if (hit) {
        this.explode(hit);
        this.rockets.splice(index, 1);
      } else if (rocket.age >= settings.weapons.rocketLifetime - 1e-8) {
        this.rockets.splice(index, 1);
      } else if (!this.contains(next)) {
        this.rockets.splice(index, 1);
      } else {
        copy(rocket.position, next);
      }
    }
  }

  reset(): void {
    this.rockets.length = this.explosions.length = 0;
    this.cooldown = 0;
  }
  shiftOrigin(delta: Vec3): void {
    for (const rocket of this.rockets) {
      translate(rocket.position, delta);
      translate(rocket.previousPosition, delta);
    }
    for (const explosion of this.explosions) {
      translate(explosion.position, delta);
    }
  }
  dispose(): void {
    this.reset();
  }

  private fire(): void {
    this.cooldown = settings.weapons.cooldown;
    this.events.emit({ type: 'rocket.fired' });
    const yaw = this.player.yaw;
    const pitch = this.player.pitch;
    const direction = {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
    const eye = {
      x: this.player.position.x,
      y: this.player.position.y + settings.camera.eyeHeight,
      z: this.player.position.z,
    };
    const position = {
      x: eye.x + direction.x * settings.weapons.muzzleOffset,
      y: eye.y + direction.y * settings.weapons.muzzleOffset,
      z: eye.z + direction.z * settings.weapons.muzzleOffset,
    };
    const hit = this.world.traceSegment(eye, position, settings.weapons.rocketRadius);
    if (hit) {
      this.explode(hit);
      return;
    }
    this.rockets.push({
      id: this.nextId++,
      position,
      previousPosition: { ...position },
      direction,
      age: 0,
    });
  }

  private explode(hit: SegmentHit): void {
    this.events.emit({ type: 'rocket.exploded', position: { ...hit.point } });
    this.explosions.push({
      id: this.nextId++,
      position: { ...hit.point },
      normal: { ...hit.normal },
      age: 0,
    });
    applyExplosion(hit.point, hit.normal, this.player, this.movement, this.health, this.world);
  }
}
