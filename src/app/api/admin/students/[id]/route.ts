import { apiErrorResponse, ApiError, requireRole, getClientIp, logAudit } from "@/lib/server/supabase-admin";
import { removeStudentPhotoObjects } from "@/lib/server/student-photo-storage";

/**
 * DELETE /api/admin/students/[id]
 * 
 * Cascade-deletes a student and ALL related data:
 * checkins → payments → contracts → contract_signing_requests → enrollments → student_classes → class_attendances → student
 * Also removes the auth user if one exists.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, profile: operator } = await requireRole(request, ["admin"]);
    const { id } = await context.params;
    const ip = getClientIp(request);

    // 1. Verify student exists
    const { data: student, error } = await admin.from("students").select("id, full_name, email, profile_id, photo_url").eq("id", id).single();
    if (error || !student) throw new ApiError("Aluno não encontrado.", 404);

    // 2. Fetch related enrollments for cascade
    const { data: enrollments } = await admin.from("enrollments").select("id").eq("student_id", id);
    const enrollmentIds = (enrollments || []).map(e => e.id);

    // 3. Fetch contracts for signing requests cascade
    const { data: contracts } = await admin.from("contracts").select("id").eq("student_id", id);
    const contractIds = (contracts || []).map(c => c.id);

    // 4. CASCADE DELETE in dependency order
    // 4a. Delete contract signing requests
    if (contractIds.length > 0) {
      await admin.from("contract_signing_requests").delete().in("contract_id", contractIds);
    }

    // 4b. Delete checkins
    await admin.from("checkins").delete().eq("student_id", id);

    // 4c. Delete payments (linked to enrollments)
    if (enrollmentIds.length > 0) {
      await admin.from("payments").delete().in("enrollment_id", enrollmentIds);
    }

    // 4d. Delete contracts
    await admin.from("contracts").delete().eq("student_id", id);

    // 4e. Delete enrollments
    await admin.from("enrollments").delete().eq("student_id", id);

    // 4f. Delete student_classes
    await admin.from("student_classes").delete().eq("student_id", id);

    // 4g. Delete class_attendances
    await admin.from("class_attendances").delete().eq("student_id", id);

    // 4h. Delete push subscriptions if student had a portal
    if (student.profile_id) {
      await admin.from("push_subscriptions").delete().eq("user_id", student.profile_id);
    }

    // 5. Delete the student record
    const { error: deleteError } = await admin.from("students").delete().eq("id", id);
    if (deleteError) throw new ApiError(`Erro ao excluir aluno: ${deleteError.message}`, 500);

    // 6. Remove auth user and profile if exists
    if (student.profile_id) {
      await admin.from("profiles").delete().eq("id", student.profile_id);
      try {
        await admin.auth.admin.deleteUser(student.profile_id);
      } catch {
        // Non-critical: auth user may not exist or already deleted
      }
    }

    // 7. Remove every facial photo owned by this student.
    let removedPhotoPaths: string[] = [];
    let photoCleanupError: string | null = null;
    try {
      removedPhotoPaths = await removeStudentPhotoObjects(admin, id, student.photo_url);
    } catch (reason) {
      photoCleanupError = reason instanceof Error ? reason.message : "Falha desconhecida ao remover foto facial.";
    }

    // 8. Audit log
    await logAudit(admin, {
      userId: operator.id,
      action: "DELETE",
      entity: "students",
      entityId: id,
      details: {
        student_name: student.full_name,
        email: student.email,
        enrollments_deleted: enrollmentIds.length,
        contracts_deleted: contractIds.length,
        profile_deleted: !!student.profile_id,
        facial_photo_paths_removed: removedPhotoPaths,
        facial_photo_cleanup_error: photoCleanupError,
      },
      ip,
    });

    return Response.json({
      ok: true,
      deleted: student.full_name,
      removedPhotoPaths,
      photoCleanupPending: Boolean(photoCleanupError),
    });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}
