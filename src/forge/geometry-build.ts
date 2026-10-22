import * as THREE from "three";
import type { GeometrySpec, MeshStats, Vec3 } from "./types.ts";

export function buildGeometry(spec: GeometrySpec): THREE.BufferGeometry {
  switch (spec.kind) {
    case "box":
      return new THREE.BoxGeometry(
        spec.width,
        spec.height,
        spec.depth,
        spec.widthSegments,
        spec.heightSegments,
        spec.depthSegments,
      );
    case "sphere":
      return new THREE.SphereGeometry(spec.radius, spec.widthSegments, spec.heightSegments);
    case "cylinder":
      return new THREE.CylinderGeometry(
        spec.radiusTop,
        spec.radiusBottom,
        spec.height,
        spec.radialSegments,
        1,
        spec.openEnded,
      );
    case "cone":
      return new THREE.ConeGeometry(spec.radius, spec.height, spec.radialSegments);
    case "torus":
      return new THREE.TorusGeometry(
        spec.radius,
        spec.tube,
        spec.radialSegments,
        spec.tubularSegments,
      );
    case "plane":
      return new THREE.PlaneGeometry(
        spec.width,
        spec.height,
        spec.widthSegments,
        spec.heightSegments,
      );
    case "capsule":
      return new THREE.CapsuleGeometry(
        spec.radius,
        spec.length,
        spec.capSegments,
        spec.radialSegments,
      );
    case "custom": {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(spec.positions, 3));
      if (spec.indices && spec.indices.length) geo.setIndex(spec.indices);
      if (spec.normals && spec.normals.length >= spec.positions.length) {
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(spec.normals, 3));
      } else {
        geo.computeVertexNormals();
      }
      if (spec.uvs && spec.uvs.length >= (spec.positions.length / 3) * 2) {
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(spec.uvs, 2));
      }
      return geo;
    }
    default: {
      const _never: never = spec;
      return _never;
    }
  }
}

export function computeMeshStats(spec: GeometrySpec): MeshStats {
  const geo = buildGeometry(spec);
  geo.computeBoundingBox();
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const triangles = index ? index.count / 3 : pos ? pos.count / 3 : 0;
  const box = geo.boundingBox;
  const min: Vec3 = box ? [box.min.x, box.min.y, box.min.z] : [0, 0, 0];
  const max: Vec3 = box ? [box.max.x, box.max.y, box.max.z] : [0, 0, 0];
  const stats: MeshStats = {
    vertices: pos ? pos.count : 0,
    triangles,
    hasUV: Boolean(geo.getAttribute("uv")),
    hasNormals: Boolean(geo.getAttribute("normal")),
    bboxMin: min,
    bboxMax: max,
  };
  geo.dispose();
  return stats;
}

export function defaultGeometry(kind: GeometrySpec["kind"]): GeometrySpec {
  switch (kind) {
    case "box":
      return {
        kind: "box",
        width: 1,
        height: 1,
        depth: 1,
        widthSegments: 1,
        heightSegments: 1,
        depthSegments: 1,
      };
    case "sphere":
      return { kind: "sphere", radius: 0.5, widthSegments: 32, heightSegments: 16 };
    case "cylinder":
      return {
        kind: "cylinder",
        radiusTop: 0.5,
        radiusBottom: 0.5,
        height: 1,
        radialSegments: 24,
        openEnded: false,
      };
    case "cone":
      return { kind: "cone", radius: 0.5, height: 1, radialSegments: 24 };
    case "torus":
      return { kind: "torus", radius: 0.45, tube: 0.16, radialSegments: 16, tubularSegments: 40 };
    case "plane":
      return { kind: "plane", width: 1, height: 1, widthSegments: 1, heightSegments: 1 };
    case "capsule":
      return { kind: "capsule", radius: 0.25, length: 0.8, capSegments: 4, radialSegments: 12 };
    case "custom":
      return {
        kind: "custom",
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 2],
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

/** Local Y so the primitive rests on the ground plane. */
export function restOffsetY(spec: GeometrySpec): number {
  switch (spec.kind) {
    case "box":
      return spec.height / 2;
    case "sphere":
      return spec.radius;
    case "cylinder":
    case "cone":
      return spec.height / 2;
    case "capsule":
      return spec.length / 2 + spec.radius;
    case "torus":
      return spec.radius + spec.tube;
    case "plane":
      return 0;
    case "custom":
      return 0;
    default:
      return 0;
  }
}

export function readNormals(spec: GeometrySpec): number[] {
  const geo = buildGeometry({ ...spec, normals: undefined } as GeometrySpec);
  geo.computeVertexNormals();
  const attr = geo.getAttribute("normal");
  const out = Array.from(attr.array as ArrayLike<number>);
  geo.dispose();
  return out;
}
