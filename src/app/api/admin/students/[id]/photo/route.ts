import { apiErrorResponse, ApiError, getClientIp, logAudit, requireRole } from "@/lib/server/supabase-admin";
import {
  canonicalStudentPhotoPath,
  removeStudentPhotoObjects,
  removeSupersededStudentPhotoObjects,
  STUDENT_PHOTO_BUCKET,
} from "@/lib/server/student-photo-storage";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, profile: operator } = await requireRole(request, ["admin", "receptionist"]);
    const { id } = await context.params;
    const { data: student, error: studentError } = await admin
      .from("students")
      .select("id, full_name, photo_url")
      .eq("id", id)
      .single();
    if (studentError || !student) throw new ApiError("Aluno não encontrado.", 404);

    const formData = await request.formData();
    const photo = formData.get("photo");
    if (!(photo instanceof File)) throw new ApiError("Envie uma foto válida.", 400);
    if (!ALLOWED_PHOTO_TYPES.has(photo.type)) {
      throw new ApiError("Use uma foto nos formatos JPEG, PNG ou WebP.", 400);
    }
    if (photo.size <= 0 || photo.size > MAX_PHOTO_BYTES) {
      throw new ApiError("A foto deve ter no máximo 8 MB.", 400);
    }

    const path = canonicalStudentPhotoPath(id);
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const { error: uploadError } = await admin.storage.from(STUDENT_PHOTO_BUCKET).upload(path, bytes, {
      contentType: photo.type || "image/jpeg",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw new ApiError(`Não foi possível armazenar a foto: ${uploadError.message}`, 500);

    const { data: publicPhoto } = admin.storage.from(STUDENT_PHOTO_BUCKET).getPublicUrl(path);
    const photoUrl = `${publicPhoto.publicUrl}?v=${Date.now()}`;
    const { error: updateError } = await admin
      .from("students")
      .update({ photo_url: photoUrl, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) throw new ApiError(`Não foi possível vincular a foto ao aluno: ${updateError.message}`, 500);

    const removedSuperseded = await removeSupersededStudentPhotoObjects(admin, id, path, student.photo_url);
    await logAudit(admin, {
      userId: operator.id,
      action: "UPDATE",
      entity: "student_photo",
      entityId: id,
      details: {
        student_name: student.full_name,
        path,
        superseded_photos_removed: removedSuperseded,
      },
      ip: getClientIp(request),
    });

    return Response.json({ ok: true, photoUrl, path, removedSuperseded });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, profile: operator } = await requireRole(request, ["admin", "receptionist"]);
    const { id } = await context.params;
    const { data: student, error: studentError } = await admin
      .from("students")
      .select("id, full_name, photo_url")
      .eq("id", id)
      .single();
    if (studentError || !student) throw new ApiError("Aluno não encontrado.", 404);

    const { error: updateError } = await admin
      .from("students")
      .update({ photo_url: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) throw new ApiError(`Não foi possível remover o vínculo da foto: ${updateError.message}`, 500);

    const removedPaths = await removeStudentPhotoObjects(admin, id, student.photo_url);
    await logAudit(admin, {
      userId: operator.id,
      action: "DELETE",
      entity: "student_photo",
      entityId: id,
      details: {
        student_name: student.full_name,
        removed_paths: removedPaths,
      },
      ip: getClientIp(request),
    });

    return Response.json({ ok: true, removedPaths });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}
