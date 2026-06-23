import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const STUDENT_PHOTO_BUCKET = "student-photos";
const CANONICAL_EXTENSION = "jpg";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StorageObject {
  id?: string | null;
  name: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface StudentPhotoCleanupResult {
  scanned: number;
  referenced: number;
  removed: number;
  removedPaths: string[];
  protectedRecent: number;
}

export function canonicalStudentPhotoPath(studentId: string) {
  return `${studentId}.${CANONICAL_EXTENSION}`;
}

export function studentPhotoPathFromUrl(photoUrl?: string | null) {
  if (!photoUrl) return null;
  const marker = `/storage/v1/object/public/${STUDENT_PHOTO_BUCKET}/`;
  const markerIndex = photoUrl.indexOf(marker);
  if (markerIndex < 0) return null;

  const encodedPath = photoUrl.slice(markerIndex + marker.length).split(/[?#]/, 1)[0];
  try {
    const path = decodeURIComponent(encodedPath).replace(/^\/+/, "");
    return path && !path.split("/").includes("..") ? path : null;
  } catch {
    return null;
  }
}

async function listFolder(admin: SupabaseClient, folder = ""): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin.storage.from(STUDENT_PHOTO_BUCKET).list(folder, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;

    const entries = (data ?? []) as StorageObject[];
    for (const entry of entries) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      const isFolder = !entry.id && !entry.metadata;
      if (isFolder) paths.push(...await listFolder(admin, path));
      else if (entry.name !== ".emptyFolderPlaceholder") paths.push(path);
    }

    if (entries.length < 1000) break;
    offset += entries.length;
  }

  return paths;
}

async function listFolderObjects(admin: SupabaseClient, folder = ""): Promise<Array<StorageObject & { path: string }>> {
  const objects: Array<StorageObject & { path: string }> = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin.storage.from(STUDENT_PHOTO_BUCKET).list(folder, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;

    const entries = (data ?? []) as StorageObject[];
    for (const entry of entries) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      const isFolder = !entry.id && !entry.metadata;
      if (isFolder) objects.push(...await listFolderObjects(admin, path));
      else if (entry.name !== ".emptyFolderPlaceholder") objects.push({ ...entry, path });
    }

    if (entries.length < 1000) break;
    offset += entries.length;
  }

  return objects;
}

function belongsToStudent(path: string, studentId: string) {
  const filename = path.split("/").at(-1) ?? "";
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem === studentId || filename.startsWith(`${studentId}.`) || filename.startsWith(`${studentId}-`) || filename.startsWith(`${studentId}_`);
}

async function pathsReferencedByOtherStudents(admin: SupabaseClient, studentId: string) {
  const { data, error } = await admin
    .from("students")
    .select("photo_url")
    .neq("id", studentId)
    .not("photo_url", "is", null);
  if (error) throw error;

  return new Set(
    (data ?? [])
      .map((student) => studentPhotoPathFromUrl(student.photo_url))
      .filter((path): path is string => Boolean(path)),
  );
}

export async function removeStudentPhotoObjects(
  admin: SupabaseClient,
  studentId: string,
  photoUrl?: string | null,
) {
  if (!UUID_PATTERN.test(studentId)) return [];

  const knownPath = studentPhotoPathFromUrl(photoUrl);
  const allPaths = await listFolder(admin);
  const protectedPaths = await pathsReferencedByOtherStudents(admin, studentId);
  const paths = [...new Set([
    canonicalStudentPhotoPath(studentId),
    ...(knownPath ? [knownPath] : []),
    ...allPaths.filter((path) => belongsToStudent(path, studentId)),
  ])].filter((path) => !protectedPaths.has(path));

  if (!paths.length) return [];
  const { error } = await admin.storage.from(STUDENT_PHOTO_BUCKET).remove(paths);
  if (error) throw error;
  return paths;
}

export async function removeSupersededStudentPhotoObjects(
  admin: SupabaseClient,
  studentId: string,
  keepPath: string,
  previousPhotoUrl?: string | null,
) {
  const previousPath = studentPhotoPathFromUrl(previousPhotoUrl);
  const allPaths = await listFolder(admin);
  const protectedPaths = await pathsReferencedByOtherStudents(admin, studentId);
  const stalePaths = [...new Set([
    ...(previousPath ? [previousPath] : []),
    ...allPaths.filter((path) => belongsToStudent(path, studentId)),
  ])].filter((path) => path !== keepPath && !protectedPaths.has(path));

  if (!stalePaths.length) return [];
  const { error } = await admin.storage.from(STUDENT_PHOTO_BUCKET).remove(stalePaths);
  if (error) throw error;
  return stalePaths;
}

export async function cleanupOrphanedStudentPhotos(
  admin: SupabaseClient,
  minimumAgeMinutes = 60,
): Promise<StudentPhotoCleanupResult> {
  const { data: students, error: studentsError } = await admin.from("students").select("id, photo_url");
  if (studentsError) throw studentsError;

  const referencedPaths = new Set<string>();
  for (const student of students ?? []) {
    if (!student.photo_url) continue;
    const path = studentPhotoPathFromUrl(student.photo_url);
    referencedPaths.add(path ?? canonicalStudentPhotoPath(student.id));
  }

  const objects = await listFolderObjects(admin);
  const cutoff = Date.now() - Math.max(0, minimumAgeMinutes) * 60_000;
  const orphanPaths: string[] = [];
  let protectedRecent = 0;

  for (const object of objects) {
    if (referencedPaths.has(object.path)) continue;
    const timestamp = object.updated_at || object.created_at;
    const objectTime = timestamp ? new Date(timestamp).getTime() : Number.NaN;
    if (!Number.isFinite(objectTime) || objectTime > cutoff) {
      protectedRecent += 1;
      continue;
    }
    orphanPaths.push(object.path);
  }

  for (let index = 0; index < orphanPaths.length; index += 100) {
    const batch = orphanPaths.slice(index, index + 100);
    const { error } = await admin.storage.from(STUDENT_PHOTO_BUCKET).remove(batch);
    if (error) throw error;
  }

  return {
    scanned: objects.length,
    referenced: referencedPaths.size,
    removed: orphanPaths.length,
    removedPaths: orphanPaths,
    protectedRecent,
  };
}
