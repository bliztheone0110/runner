import { vec3, type Vec3 } from '../../core/types';

export class PlayerState {
  readonly position: Vec3 = vec3();
  readonly previousPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  yaw = 0;
  pitch = 0;
  grounded = true;
  jumps = 0;
  peakSpeed = 0;
  turnBonus = 0;
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
}
