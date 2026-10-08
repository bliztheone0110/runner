import {
  BufferGeometry,
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type MeshStandardMaterialParameters,
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
  private readonly floorTexture: Texture;
  private readonly floorVariantTexture: Texture;
  private readonly rockTexture: Texture;
  private readonly lavaTexture: Texture;
  private floorCompositeTexture?: CanvasTexture;
  private readonly lineMaterial = new LineBasicMaterial({
    color: 0xf3efe2,
    transparent: true,
    opacity: 0.3,
  });
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly floorMaterials = new Set<MeshStandardMaterial>();
  private disposed = false;
  constructor(private readonly scene: Scene) {
    const loader = typeof document === 'undefined' ? undefined : new TextureLoader();
    this.floorTexture = loader
      ? loader.load('/assets/textures/floor_stone_pattern.png', () => this.updateFloorTexture())
      : new Texture();
    this.floorVariantTexture = loader
      ? loader.load('/assets/textures/floor_stone_pattern_depth.png', () =>
          this.updateFloorTexture(),
        )
      : new Texture();
    this.rockTexture = loader ? loader.load('/assets/textures/wall_rock.png') : new Texture();
    this.lavaTexture = loader ? loader.load('/assets/textures/lava.jpg') : new Texture();
    for (const texture of [this.floorTexture, this.rockTexture, this.lavaTexture]) {
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
    }
    this.floorVariantTexture.colorSpace = SRGBColorSpace;
    this.floorVariantTexture.wrapS = RepeatWrapping;
    this.floorVariantTexture.wrapT = RepeatWrapping;
  }
  create(boxes: readonly LevelBox[]): ChunkView {
    const root = new Group();
    const geometries: BufferGeometry[] = [];
    for (const box of boxes) {
      const isCheckpoint = box.kind === 'checkpoint';
      let textureName = box.texture;
      if (box.kind === 'floor') {
        textureName = 'floorStone';
      } else if (!textureName && (box.kind === 'wall' || box.kind === 'obstacle')) {
        textureName = 'wallRock';
      }
      const materialKey = textureName
        ? `${textureName}:${isCheckpoint}`
        : `${box.color}:${isCheckpoint}`;
      let material = this.materials.get(materialKey);
      if (!material) {
        const isFloorStone = textureName === 'floorStone';
        const isTextured = textureName !== undefined;
        let map: Texture | undefined;
        if (textureName === 'floorStone') {
          map = this.floorCompositeTexture ?? this.floorTexture;
        } else if (textureName === 'wallRock') {
          map = this.rockTexture;
        } else if (textureName === 'lava') {
          map = this.lavaTexture;
        }
        const materialOptions: MeshStandardMaterialParameters = {
          color: isTextured ? 0xffffff : box.color,
          roughness: 0.85,
          transparent: isCheckpoint,
          opacity: isCheckpoint ? 0.05 : 1,
          depthWrite: !isCheckpoint,
        };
        if (textureName === 'lava') {
          materialOptions.emissive = 0xff4b05;
          materialOptions.emissiveIntensity = 0.65;
        }
        if (map) {
          materialOptions.map = map;
        }
        if (isCheckpoint) {
          materialOptions.side = DoubleSide;
        }
        material = new MeshStandardMaterial(materialOptions);
        this.materials.set(materialKey, material);
        if (isFloorStone) {
          this.floorMaterials.add(material);
        }
      }
      const tileSize = textureName === 'floorStone' || textureName === 'lava' ? 8 : 2;
      let geometry: BufferGeometry = this.geometry;
      if (box.kind === 'ramp') {
        geometry = this.createRampGeometry(box.size, tileSize);
      } else if (box.kind === 'rampRoof') {
        geometry = this.createTiledGeometry(box.size, tileSize);
      } else if (textureName) {
        geometry = this.createTiledGeometry(box.size, tileSize);
      }
      if (geometry !== this.geometry) {
        geometries.push(geometry);
      }
      const mesh = new Mesh(geometry, material);
      mesh.position.set(box.center.x, box.center.y, box.center.z);
      if (box.kind === 'ramp') {
        mesh.rotation.y = box.yaw ?? 0;
      } else if (box.kind === 'rampRoof') {
        mesh.rotation.set(box.pitch ?? 0, box.yaw ?? 0, 0);
        mesh.scale.set(box.size.x, box.size.y, box.size.z);
      } else {
        mesh.scale.set(box.size.x, box.size.y, box.size.z);
      }
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
        for (const geometry of geometries) {
          geometry.dispose();
        }
      },
    };
  }
  private updateFloorTexture(): void {
    if (this.disposed) {
      return;
    }
    const baseImage = this.floorTexture.image as HTMLImageElement;
    const variantImage = this.floorVariantTexture.image as HTMLImageElement;
    if (
      !baseImage ||
      !variantImage ||
      !baseImage.complete ||
      !variantImage.complete ||
      baseImage.naturalWidth === 0 ||
      variantImage.naturalWidth === 0
    ) {
      return;
    }
    const columns = 4;
    const rows = 4;
    const cellWidth = baseImage.naturalWidth;
    const cellHeight = baseImage.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = cellWidth * columns;
    canvas.height = cellHeight * rows;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const cellIndex = row * columns + column;
        const image = cellIndex === 5 || cellIndex === 14 ? variantImage : baseImage;
        context.drawImage(image, column * cellWidth, row * cellHeight, cellWidth, cellHeight);
      }
    }

    const composite = new CanvasTexture(canvas);
    composite.colorSpace = SRGBColorSpace;
    composite.wrapS = RepeatWrapping;
    composite.wrapT = RepeatWrapping;
    this.floorCompositeTexture?.dispose();
    this.floorCompositeTexture = composite;
    for (const material of this.floorMaterials) {
      material.map = composite;
      material.needsUpdate = true;
    }
  }
  private createTiledGeometry(size: Vec3, tileSize: number): BoxGeometry {
    const geometry = this.geometry.clone();
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    for (let index = 0; index < uv.count; index++) {
      let uScale = size.x / tileSize;
      let vScale = size.y / tileSize;
      if (Math.abs(normal.getX(index)) > 0.5) {
        uScale = size.z / tileSize;
        vScale = size.y / tileSize;
      } else if (Math.abs(normal.getY(index)) > 0.5) {
        uScale = size.x / tileSize;
        vScale = size.z / tileSize;
      }
      uv.setXY(index, uv.getX(index) * uScale, uv.getY(index) * vScale);
    }
    uv.needsUpdate = true;
    return geometry;
  }
  private createRampGeometry(size: Vec3, tileSize: number): BufferGeometry {
    const halfWidth = size.x / 2;
    const halfHeight = size.y / 2;
    const halfDepth = size.z / 2;
    const startLeft = [-halfWidth, -halfHeight, halfDepth];
    const startRight = [halfWidth, -halfHeight, halfDepth];
    const endLeft = [-halfWidth, halfHeight, -halfDepth];
    const endRight = [halfWidth, halfHeight, -halfDepth];
    const bottomLeft = [-halfWidth, -halfHeight, -halfDepth];
    const bottomRight = [halfWidth, -halfHeight, -halfDepth];
    const triangles = [
      startLeft,
      startRight,
      endRight,
      startLeft,
      endRight,
      endLeft,
      startLeft,
      endLeft,
      bottomLeft,
      startRight,
      bottomRight,
      endRight,
      startLeft,
      bottomLeft,
      bottomRight,
      startLeft,
      bottomRight,
      startRight,
      endLeft,
      endRight,
      bottomRight,
      endLeft,
      bottomRight,
      bottomLeft,
    ];
    const positions = new Float32Array(triangles.flat());
    const uvs = new Float32Array(
      triangles.flatMap(([x, , z]) => [(x + halfWidth) / tileSize, (halfDepth - z) / tileSize]),
    );
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }
  dispose(): void {
    this.disposed = true;
    this.geometry.dispose();
    this.edges.dispose();
    this.lineMaterial.dispose();
    this.floorTexture.dispose();
    this.floorVariantTexture.dispose();
    this.rockTexture.dispose();
    this.lavaTexture.dispose();
    this.floorCompositeTexture?.dispose();
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
    this.floorMaterials.clear();
  }
}
