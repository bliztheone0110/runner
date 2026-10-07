import type { GameSystem } from '../../core/types';
import type { InputSystem } from '../../input/InputSystem';
import type { MovementController } from './MovementController';

export class PlayerSystem implements GameSystem {
  constructor(
    private readonly movement: MovementController,
    private readonly input: InputSystem,
  ) {}
  fixedUpdate(dt: number): void {
    const input = this.input.snapshot;
    this.movement.step(dt, input);
  }
}
