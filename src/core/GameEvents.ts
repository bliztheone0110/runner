import type { Vec3 } from './types';

export type GameEvent =
  | { type: 'game.started' }
  | { type: 'player.jumped' }
  | { type: 'rocket.fired' }
  | { type: 'rocket.exploded'; position: Vec3 }
  | { type: 'player.respawned' }
  | { type: 'player.falling' }
  | { type: 'timer.expired' };

export interface EventSink {
  emit(event: GameEvent): void;
}
export const silentEvents: EventSink = { emit() {} };

/** Per-tick presentation events; no browser dependencies in gameplay. */
export class GameEvents implements EventSink {
  private pending: GameEvent[] = [];
  emit(event: GameEvent): void {
    this.pending.push(event);
  }
  drain(): GameEvent[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }
  clear(): void {
    this.pending.length = 0;
  }
  shiftOrigin(delta: Vec3): void {
    for (const event of this.pending) {
      if (event.type === 'rocket.exploded') {
        event.position.x -= delta.x;
        event.position.y -= delta.y;
        event.position.z -= delta.z;
      }
    }
  }
}
