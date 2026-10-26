import { getSql } from "./db.ts";
import type { Project, SceneNode, AnimClip, TextureAsset, SceneSettings } from "../forge/types.ts";

export interface DBProjectRow {
  id: string;
  user_id: string;
  name: string;
  schema_version: string;
  api_version: string;
  app_version: string;
  code: string;
  scene_json: string;
  objects_json: string;
  clips_json: string;
  textures_json: string;
  engine?: string | null;
  native_babylon_scene_json?: string | null;
  created_at: number;
  updated_at: number;
}

export async function saveProjectToDb(userId: string, project: Project): Promise<Project> {
  const sql = await getSql();
  const now = Date.now();
  const updatedProject = { ...project, updatedAt: now };

  const sceneJson = JSON.stringify(updatedProject.scene);
  const objectsJson = JSON.stringify(updatedProject.objects);
  const clipsJson = JSON.stringify(updatedProject.clips);
  const texturesJson = JSON.stringify(updatedProject.textures);
  const engine = updatedProject.engine === "babylon" || updatedProject.engine === "three"
    ? updatedProject.engine
    : null;
  const nativeBabylonSceneJson = updatedProject.nativeBabylonScene
    ? JSON.stringify(updatedProject.nativeBabylonScene)
    : null;

  const persisted = await sql<{ id: string; user_id: string }>`
    INSERT INTO projects (
      id, user_id, name, schema_version, api_version, app_version,
      code, scene_json, objects_json, clips_json, textures_json,
      engine, native_babylon_scene_json, created_at, updated_at
    )
    VALUES (
      ${updatedProject.id}, ${userId}, ${updatedProject.name}, ${updatedProject.schemaVersion},
      ${updatedProject.apiVersion}, ${updatedProject.appVersion}, ${updatedProject.code},
      ${sceneJson}, ${objectsJson}, ${clipsJson}, ${texturesJson},
      ${engine}, ${nativeBabylonSceneJson}, ${updatedProject.createdAt}, ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      code = EXCLUDED.code,
      scene_json = EXCLUDED.scene_json,
      objects_json = EXCLUDED.objects_json,
      clips_json = EXCLUDED.clips_json,
      textures_json = EXCLUDED.textures_json,
      engine = EXCLUDED.engine,
      native_babylon_scene_json = EXCLUDED.native_babylon_scene_json,
      updated_at = EXCLUDED.updated_at
    WHERE projects.user_id = EXCLUDED.user_id
    RETURNING id, user_id
  `;
  if (persisted.length === 0 || persisted[0].user_id !== userId) {
    throw new Error("Project ownership conflict: this project id is not writable by the current user.");
  }

  return updatedProject;
}

export async function loadProjectFromDb(userId: string, projectId: string): Promise<Project | null> {
  const sql = await getSql();
  const rows = await sql<DBProjectRow>`
    SELECT * FROM projects WHERE id = ${projectId} AND user_id = ${userId}
  `;

  if (!rows || rows.length === 0) return null;
  const row = rows[0];

  try {
    const scene: SceneSettings = JSON.parse(row.scene_json);
    const objects: SceneNode[] = JSON.parse(row.objects_json);
    const clips: AnimClip[] = JSON.parse(row.clips_json || "[]");
    const textures: TextureAsset[] = JSON.parse(row.textures_json || "[]");
    const engine = row.engine === "babylon" || row.engine === "three" ? row.engine : undefined;
    const nativeValue = row.native_babylon_scene_json ? JSON.parse(row.native_babylon_scene_json) as unknown : null;
    const nativeBabylonScene = nativeValue && typeof nativeValue === "object" && !Array.isArray(nativeValue)
      ? nativeValue as Record<string, unknown>
      : null;

    return {
      id: row.id,
      name: row.name,
      schemaVersion: row.schema_version as any,
      apiVersion: row.api_version,
      appVersion: row.app_version,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      code: row.code,
      codeLanguage: "javascript",
      author: row.user_id,
      ...(engine ? { engine } : {}),
      ...(nativeBabylonScene ? { nativeBabylonScene } : {}),
      objects,
      textures,
      clips,
      scene,
      description: "",
    };
  } catch (err) {
    console.error("[db] Failed to deserialize project:", err);
    return null;
  }
}

export async function listUserProjectsFromDb(userId: string): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
  const sql = await getSql();
  const rows = await sql<{ id: string; name: string; updated_at: number }>`
    SELECT id, name, updated_at FROM projects WHERE user_id = ${userId} ORDER BY updated_at DESC
  `;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: Number(r.updated_at),
  }));
}

export async function deleteProjectFromDb(userId: string, projectId: string): Promise<boolean> {
  const sql = await getSql();
  const deleted = await sql<{ id: string }>`
    DELETE FROM projects
     WHERE id = ${projectId} AND user_id = ${userId}
    RETURNING id
  `;
  return deleted.length > 0;
}
