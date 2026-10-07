import { settings } from '../../config/settings';
import type { GameSystem } from '../../core/types';
import type { EventSink } from '../../core/GameEvents';
import type { PlayerState } from './PlayerState';

export class FallingSystem implements GameSystem {
  private falling = false;
  constructor(
    private readonly state: PlayerState,
    private readonly events: EventSink,
    private readonly respawn: () => void,
  ) {}
  fixedUpdate(): void {
    if (this.state.grounded) {
      this.falling = false;
    }
    if (
      !this.falling &&
      this.state.position.y < settings.corridor.fallingHeight &&
      this.state.velocity.y < 0
    ) {
      this.falling = true;
      this.events.emit({ type: 'player.falling' });
    }
    if (this.state.position.y <= settings.corridor.deathHeight) {
      this.respawn();
    }
  }
  reset(): void {
    this.falling = false;
  }
}
