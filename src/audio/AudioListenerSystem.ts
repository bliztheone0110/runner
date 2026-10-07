import { Vector3, type PerspectiveCamera } from 'three';
import type { GameSystem } from '../core/types';
import type { AudioSystem } from './AudioSystem';

export class AudioListenerSystem implements GameSystem {
  private readonly position = new Vector3();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly audio: AudioSystem,
  ) {}
  update(): void {
    this.camera.getWorldPosition(this.position);
    this.camera.getWorldDirection(this.forward);
    this.up.copy(this.camera.up).applyQuaternion(this.camera.quaternion);
    this.audio.setListener({ position: this.position, forward: this.forward, up: this.up });
  }
}
