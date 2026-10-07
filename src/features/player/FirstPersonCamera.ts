import { PerspectiveCamera } from 'three';
import { settings } from '../../config/settings';
import type { GameSystem } from '../../core/types';
import type { PlayerState } from './PlayerState';

export class FirstPersonCamera implements GameSystem {
  readonly camera = new PerspectiveCamera(settings.camera.fov, 1, 0.05, 500);
  constructor(private readonly state: PlayerState) {
    this.camera.rotation.order = 'YXZ';
  }
  update(_dt: number, alpha: number): void {
    const previous = this.state.previousPosition;
    const current = this.state.position;
    this.camera.position.set(
      previous.x + (current.x - previous.x) * alpha,
      previous.y + (current.y - previous.y) * alpha + settings.camera.eyeHeight,
      previous.z + (current.z - previous.z) * alpha,
    );
    this.camera.rotation.set(this.state.pitch, this.state.yaw, 0, 'YXZ');
  }
}
