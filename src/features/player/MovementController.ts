import { settings, type MovementConfig } from '../../config/settings';
import { approach, clamp, copy, type Vec3 } from '../../core/types';
import type { MovementInput } from '../../input/InputState';
import type { CollisionWorld } from '../../physics/CollisionWorld';
import { type PlayerState } from './PlayerState';
import { silentEvents, type EventSink } from '../../core/GameEvents';

export class MovementController {
  private bufferedJump = 0;
  private externalImpulse = false;
  private landingBrakeRemaining = 0;
  constructor(
    readonly state: PlayerState,
    private readonly collisions: CollisionWorld,
    private readonly config: MovementConfig = settings.movement,
    private readonly events: EventSink = silentEvents,
  ) {}

  reset(spawn: Vec3, yaw = 0): void {
    copy(this.state.position, spawn);
    copy(this.state.previousPosition, spawn);
    copy(this.state.velocity, { x: 0, y: 0, z: 0 });
    this.state.yaw =
      this.state.pitch =
      this.state.jumps =
      this.state.peakSpeed =
      this.state.turnBonus =
        0;
    this.state.yaw = yaw;
    this.state.grounded = true;
    this.bufferedJump = 0;
    this.externalImpulse = false;
    this.landingBrakeRemaining = 0;
  }

  applyImpulse(impulse: Vec3): void {
    this.state.velocity.x += impulse.x;
    this.state.velocity.y += impulse.y;
    this.state.velocity.z += impulse.z;
    this.externalImpulse = true;
    if (this.state.velocity.y > 0) {
      this.state.grounded = false;
      this.landingBrakeRemaining = 0;
    }
    this.state.peakSpeed = Math.max(this.state.peakSpeed, this.state.speed);
  }

  step(dt: number, input: MovementInput): void {
    const state = this.state;
    const config = this.config;
    copy(state.previousPosition, state.position);
    state.yaw = Math.atan2(
      Math.sin(state.yaw + input.yawDelta),
      Math.cos(state.yaw + input.yawDelta),
    );
    state.pitch = clamp(
      state.pitch + input.pitchDelta,
      -settings.camera.pitchLimit,
      settings.camera.pitchLimit,
    );
    if (input.jumpPressed) {
      this.bufferedJump = config.jumpBuffer;
    }
    if (state.grounded && this.bufferedJump > 0) {
      this.jump();
    }

    const magnitude = Math.hypot(input.forward, input.right);
    const forward = magnitude > 0 ? input.forward / magnitude : 0;
    const right = magnitude > 0 ? input.right / magnitude : 0;
    const wishX = -Math.sin(state.yaw) * forward + Math.cos(state.yaw) * right;
    const wishZ = -Math.cos(state.yaw) * forward - Math.sin(state.yaw) * right;
    const turn =
      input.forward > 0 ? clamp(Math.abs(input.yawDelta) / dt / config.fullBonusTurnRate, 0, 1) : 0;
    state.turnBonus = turn;
    let speed = state.speed;
    const wasGrounded = state.grounded;

    if (state.grounded) {
      // A missed landing jump sheds all excess momentum in a fixed duration,
      // regardless of how much speed the previous bunnyhop chain accumulated.
      const landingBraking =
        this.landingBrakeRemaining > 0
          ? Math.max(0, speed - config.baseSpeed) / this.landingBrakeRemaining
          : 0;
      if (magnitude > 0) {
        const target =
          this.landingBrakeRemaining > 0
            ? config.baseSpeed
            : config.baseSpeed + config.groundTurnBonus * turn;
        const braking = this.landingBrakeRemaining > 0 ? landingBraking : config.excessBraking;
        speed = approach(
          speed,
          target,
          (speed > target ? braking : config.groundAcceleration) * dt,
        );
        if (this.externalImpulse && state.speed > 1e-8) {
          const currentAngle = Math.atan2(state.velocity.x, state.velocity.z);
          const targetAngle = Math.atan2(wishX, wishZ);
          const delta = Math.atan2(
            Math.sin(targetAngle - currentAngle),
            Math.cos(targetAngle - currentAngle),
          );
          const angle =
            currentAngle + clamp(delta, -config.airSteeringRate * dt, config.airSteeringRate * dt);
          state.velocity.x = Math.sin(angle) * speed;
          state.velocity.z = Math.cos(angle) * speed;
          if (speed <= target && Math.abs(delta) < config.airSteeringRate * dt) {
            this.externalImpulse = false;
          }
        } else {
          state.velocity.x = wishX * speed;
          state.velocity.z = wishZ * speed;
        }
      } else {
        const nextSpeed = approach(speed, 0, Math.max(config.braking, landingBraking) * dt);
        if (speed > 0) {
          state.velocity.x *= nextSpeed / speed;
          state.velocity.z *= nextSpeed / speed;
        }
      }
      this.landingBrakeRemaining = Math.max(0, this.landingBrakeRemaining - dt);
    } else if (magnitude > 0) {
      // Air steering changes direction without normalizing away accumulated momentum.
      const targetAngle = Math.atan2(wishX, wishZ);
      const currentAngle =
        speed > 1e-8 ? Math.atan2(state.velocity.x, state.velocity.z) : targetAngle;
      const angleDelta = Math.atan2(
        Math.sin(targetAngle - currentAngle),
        Math.cos(targetAngle - currentAngle),
      );
      const angle =
        currentAngle + clamp(angleDelta, -config.airSteeringRate * dt, config.airSteeringRate * dt);
      if (speed < config.baseSpeed) {
        speed = Math.min(config.baseSpeed, speed + config.airAcceleration * dt);
      }
      speed += config.airTurnAcceleration * turn * dt;
      state.velocity.x = Math.sin(angle) * speed;
      state.velocity.z = Math.cos(angle) * speed;
    }

    state.velocity.y -= config.gravity * dt;
    const result = this.collisions.move(
      {
        position: state.position,
        velocity: state.velocity,
        radius: config.radius,
        height: config.height,
      },
      { x: state.velocity.x * dt, y: state.velocity.y * dt, z: state.velocity.z * dt },
    );
    state.grounded = result.grounded;
    // A buffered landing jump occurs before any ground braking on the next tick.
    if (state.grounded && this.bufferedJump > 0) {
      this.jump();
    }
    if (!wasGrounded && state.grounded && state.speed > config.baseSpeed) {
      this.landingBrakeRemaining = config.landingSpeedResetDuration;
    }
    this.bufferedJump = Math.max(0, this.bufferedJump - dt);
    state.peakSpeed = Math.max(state.peakSpeed, state.speed);
  }

  private jump(): void {
    this.state.velocity.y = Math.max(this.state.velocity.y, this.config.jumpSpeed);
    this.state.grounded = false;
    this.landingBrakeRemaining = 0;
    this.state.jumps++;
    this.events.emit({ type: 'player.jumped' });
    this.bufferedJump = 0;
  }
}
