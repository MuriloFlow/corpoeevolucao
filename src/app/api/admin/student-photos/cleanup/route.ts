import { apiErrorResponse, getClientIp, logAudit, requireRole } from "@/lib/server/supabase-admin";
import { cleanupOrphanedStudentPhotos } from "@/lib/server/student-photo-storage";

export async function POST(request: Request) {
  try {
    const { admin, profile: operator } = await requireRole(request, ["admin"]);
    const result = await cleanupOrphanedStudentPhotos(admin, 60);

    await logAudit(admin, {
      userId: operator.id,
      action: "DELETE",
      entity: "student_photo_orphans",
      details: {
        scanned: result.scanned,
        removed: result.removed,
        protected_recent: result.protectedRecent,
        removed_paths: result.removedPaths,
      },
      ip: getClientIp(request),
    });

    return Response.json({ ok: true, ...result });
  } catch (reason) {
    return apiErrorResponse(reason);
  }
}
