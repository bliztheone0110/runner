export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Systems are composed by the application, not discovered through globals. */
export interface GameSystem {
  fixedUpdate?(dt: number): void;
  update?(dt: number, alpha: number): void;
  dispose?(): void;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (target: Vec3, source: Vec3): void => {
  Object.assign(target, source);
};
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
export const approach = (value: number, target: number, amount: number): number =>
  value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
