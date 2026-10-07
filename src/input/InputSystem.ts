import { settings } from '../config/settings';
import type { GameSystem } from '../core/types';
import { emptyInput, type InputState, type MovementInput } from './InputState';

/** One snapshot shared by all gameplay systems for this simulation tick. */
export class InputSystem implements GameSystem {
  snapshot: MovementInput = emptyInput();
  constructor(private readonly state: InputState) {}
  fixedUpdate(): void {
    this.snapshot = this.state.consume(settings.keys);
  }
  clear(): void {
    this.state.clear();
    this.snapshot = emptyInput();
  }
}
