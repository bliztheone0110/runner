import {
  BoxGeometry,
  EdgesGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  type Scene,
} from 'three';
import type { LevelBox } from './trainingLevel';
import type { Vec3 } from '../core/types';

export interface ChunkView {
  shiftOrigin(delta: Vec3): void;
  dispose(): void;
}
export interface ChunkPresentation {
  create(boxes: readonly LevelBox[]): ChunkView;
  dispose(): void;
}

/** A fixed set of shared GPU resources; deleting chunks only deletes instances. */
export class ChunkRenderer implements ChunkPresentation {
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly edges = new EdgesGeometry(this.geometry);
  private readonly lineMaterial = new LineBasicMaterial({
    color: 0xf3efe2,
    transparent: true,
    opacity: 0.3,
  });
  private readonly materials = new Map<string, MeshStandardMaterial>();
  constructor(private readonly scene: Scene) {}
  create(boxes: readonly LevelBox[]): ChunkView {
    const root = new Group();
    for (const box of boxes) {
      const isCheckpoint = box.kind === 'checkpoint';
      const materialKey = `${box.color}:${isCheckpoint}`;
      let material = this.materials.get(materialKey);
      if (!material) {
        material = new MeshStandardMaterial({
          color: box.color,
          roughness: 0.85,
          transparent: isCheckpoint,
          opacity: isCheckpoint ? 0.05 : 1,
          depthWrite: !isCheckpoint,
          side: isCheckpoint ? DoubleSide : undefined,
        });
        this.materials.set(materialKey, material);
      }
      const mesh = new Mesh(this.geometry, material);
      mesh.position.set(box.center.x, box.center.y, box.center.z);
      mesh.scale.set(box.size.x, box.size.y, box.size.z);
      if (box.kind === 'obstacle') {
        mesh.add(new LineSegments(this.edges, this.lineMaterial));
      }
      root.add(mesh);
    }
    this.scene.add(root);
    return {
      shiftOrigin(delta) {
        root.position.x -= delta.x;
        root.position.y -= delta.y;
        root.position.z -= delta.z;
      },
      dispose() {
        root.removeFromParent();
        root.clear();
      },
    };
  }
  dispose(): void {
    this.geometry.dispose();
    this.edges.dispose();
    this.lineMaterial.dispose();
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
  }
}
