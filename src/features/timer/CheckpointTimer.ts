import { settings } from '../../config/settings';
import type { EventSink } from '../../core/GameEvents';
import type { GameSystem } from '../../core/types';
import type { GameMode } from '../../world/GameWorld';

interface TimerWorld {
  readonly mode: GameMode;
  readonly checkpoint: number;
}
export interface CheckpointTimerState {
  readonly enabled: boolean;
  readonly remaining: number;
  readonly limit: number;
  readonly expired: boolean;
}

/** Countdown uses simulation time and the last reached checkpoint, never render time. */
export class CheckpointTimer implements GameSystem, CheckpointTimerState {
  remaining = settings.checkpointTimer.initial as number;
  limit = settings.checkpointTimer.initial as number;
  expired = false;
  private checkpoint: number;
  private mode: GameMode;
  constructor(
    private readonly world: TimerWorld,
    private readonly events: EventSink,
    private readonly onExpired: () => void = () => {},
  ) {
    this.checkpoint = world.checkpoint;
    this.mode = world.mode;
    this.reset();
  }
  get enabled(): boolean {
    return this.world.mode === 'corridor';
  }
  reset(): void {
    this.checkpoint = this.world.checkpoint;
    this.mode = this.world.mode;
    this.limit = checkpointTimeLimit(this.checkpoint);
    this.remaining = this.limit;
    this.expired = false;
  }
  fixedUpdate(dt: number): void {
    if (this.mode !== this.world.mode || this.checkpoint !== this.world.checkpoint) {
      this.reset();
      if (this.remaining > 0) {
        return;
      }
    }
    if (!this.enabled || this.expired) {
      return;
    }
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining <= 1e-8) {
      this.remaining = 0;
      this.expired = true;
      this.onExpired();
      this.events.emit({ type: 'timer.expired' });
    }
  }
}

export function checkpointTimeLimit(checkpoint: number): number {
  const { initial, threshold, largeDecrease, smallDecrease, minimum } = settings.checkpointTimer;
  const reached = Math.max(0, checkpoint - 1);
  const largeSteps = Math.ceil((initial - threshold) / largeDecrease);
  return Math.max(
    minimum,
    initial -
      Math.min(reached, largeSteps) * largeDecrease -
      Math.max(0, reached - largeSteps) * smallDecrease,
  );
}
