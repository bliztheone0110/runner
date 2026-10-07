import { settings } from '../../config/settings';

export class HealthState {
  current: number = settings.health.max;
  damageFlash = 0;
  lastDamage = 0;
  get dead(): boolean {
    return this.current <= 0;
  }
  damage(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0 || this.dead) {
      return;
    }
    this.lastDamage = Math.min(this.current, amount);
    this.current = Math.max(0, this.current - amount);
    this.damageFlash = settings.health.damageFlashDuration;
  }
  reset(): void {
    this.current = settings.health.max;
    this.damageFlash = this.lastDamage = 0;
  }
}
