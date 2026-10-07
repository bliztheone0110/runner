import { settings } from '../../config/settings';
import type { GameSystem } from '../../core/types';
import type { HealthState } from './HealthState';

export class HealthSystem implements GameSystem {
  constructor(
    private readonly state: HealthState,
    private readonly respawn: () => void,
  ) {}
  fixedUpdate(dt: number): void {
    if (this.state.dead) {
      this.respawn();
      return;
    }
    this.state.current = Math.min(
      settings.health.max,
      this.state.current + settings.health.regeneration * dt,
    );
    this.state.damageFlash = Math.max(0, this.state.damageFlash - dt);
  }
}
