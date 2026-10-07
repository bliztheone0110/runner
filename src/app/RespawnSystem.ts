import type { GameSystem, Vec3 } from '../core/types';
import { settings } from '../config/settings';
import type { InputSystem } from '../input/InputSystem';
import type { MovementController } from '../features/player/MovementController';
import type { HealthState } from '../features/health/HealthState';
import type { WeaponSystem } from '../features/weapons/WeaponSystem';
import { silentEvents, type EventSink } from '../core/GameEvents';
import type { SpawnProvider } from '../world/CorridorGenerator';

export class RespawnSystem implements GameSystem {
  constructor(
    private readonly movement: MovementController,
    private readonly health: HealthState,
    private readonly weapons: WeaponSystem,
    private readonly input: InputSystem,
    private readonly spawn: Vec3 | SpawnProvider,
    private readonly resetVisuals: () => void = () => {},
    private readonly events: EventSink = silentEvents,
  ) {}
  fixedUpdate(): void {
    const deathHeight =
      'getSpawn' in this.spawn ? this.spawn.deathHeight : settings.world.respawnHeight;
    if (this.input.snapshot.resetPressed || this.movement.state.position.y < deathHeight) {
      this.reset();
    }
  }
  reset(emitEvent = true): void {
    if ('getSpawn' in this.spawn) {
      this.spawn.restoreCheckpoint();
      const point = this.spawn.getSpawn();
      this.movement.reset(point.position, point.yaw);
    } else {
      this.movement.reset(this.spawn);
    }
    this.health.reset();
    this.weapons.reset();
    this.input.clear();
    this.resetVisuals();
    if (emitEvent) {
      this.events.emit({ type: 'player.respawned' });
    }
  }
}
