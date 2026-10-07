import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { settings } from '../../config/settings';
import type { GameSystem } from '../../core/types';
import type { WeaponSystem } from './WeaponSystem';

export class WeaponVisuals implements GameSystem {
  private readonly root = new Group();
  private readonly rockets = new Map<number, Group>();
  private readonly blasts = new Map<number, Mesh<SphereGeometry, MeshBasicMaterial>>();
  private readonly rocketGeometry = new SphereGeometry(settings.weapons.rocketRadius, 12, 8);
  private readonly trailGeometry = new CylinderGeometry(0.07, 0, 0.9, 8);
  private readonly blastGeometry = new SphereGeometry(1, 20, 12);
  private readonly rocketMaterial = new MeshBasicMaterial({ color: 0xfff3b0 });
  private readonly trailMaterial = new MeshBasicMaterial({
    color: 0xff9a37,
    transparent: true,
    opacity: 0.65,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly up = new Vector3(0, 1, 0);
  private readonly direction = new Vector3();

  constructor(
    scene: Scene,
    private readonly weapons: WeaponSystem,
  ) {
    scene.add(this.root);
  }

  update(_dt: number, alpha: number): void {
    const activeRockets = new Set(this.weapons.rockets.map((rocket) => rocket.id));
    for (const [id, mesh] of this.rockets) {
      if (!activeRockets.has(id)) {
        this.root.remove(mesh);
        this.rockets.delete(id);
      }
    }
    for (const rocket of this.weapons.rockets) {
      let mesh = this.rockets.get(rocket.id);
      if (!mesh) {
        mesh = new Group();
        mesh.add(new Mesh(this.rocketGeometry, this.rocketMaterial));
        const trail = new Mesh(this.trailGeometry, this.trailMaterial);
        trail.position.y = -0.5;
        mesh.add(trail);
        this.root.add(mesh);
        this.rockets.set(rocket.id, mesh);
      }
      mesh.position.set(
        rocket.previousPosition.x + (rocket.position.x - rocket.previousPosition.x) * alpha,
        rocket.previousPosition.y + (rocket.position.y - rocket.previousPosition.y) * alpha,
        rocket.previousPosition.z + (rocket.position.z - rocket.previousPosition.z) * alpha,
      );
      mesh.quaternion.setFromUnitVectors(
        this.up,
        this.direction.set(rocket.direction.x, rocket.direction.y, rocket.direction.z),
      );
    }
    const activeBlasts = new Set(this.weapons.explosions.map((blast) => blast.id));
    for (const [id, mesh] of this.blasts) {
      if (!activeBlasts.has(id)) {
        mesh.material.dispose();
        this.root.remove(mesh);
        this.blasts.delete(id);
      }
    }
    for (const blast of this.weapons.explosions) {
      let mesh = this.blasts.get(blast.id);
      if (!mesh) {
        const material = new MeshBasicMaterial({
          color: 0xffa052,
          transparent: true,
          opacity: 0.7,
          blending: AdditiveBlending,
          depthWrite: false,
        });
        mesh = new Mesh(this.blastGeometry, material);
        mesh.position.set(blast.position.x, blast.position.y, blast.position.z);
        this.root.add(mesh);
        this.blasts.set(blast.id, mesh);
      }
      const progress = blast.age / settings.weapons.explosionDuration;
      mesh.position.set(blast.position.x, blast.position.y, blast.position.z);
      mesh.scale.setScalar(0.15 + progress * 2.7);
      mesh.material.opacity = (1 - progress) ** 2 * 0.75;
    }
  }

  reset(): void {
    for (const mesh of this.blasts.values()) {
      mesh.material.dispose();
    }
    this.blasts.clear();
    this.rockets.clear();
    this.root.clear();
  }
  dispose(): void {
    this.reset();
    this.root.removeFromParent();
    this.rocketGeometry.dispose();
    this.trailGeometry.dispose();
    this.blastGeometry.dispose();
    this.rocketMaterial.dispose();
    this.trailMaterial.dispose();
  }
}
