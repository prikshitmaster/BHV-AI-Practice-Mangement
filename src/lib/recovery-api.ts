import type { NextResponse } from "next/server";
import { apiError, errorResponse } from "@/lib/api";
import { BackupConfigurationError } from "@/lib/backup";
import { OutboundHoldError, RestoreSafetyError } from "@/lib/restore";

/**
 * Error mapping for the /api/recovery routes. Kept out of the shared
 * errorResponse so that every route in the app does not pull the restore
 * engine (child_process, a second Prisma client) into its bundle.
 *
 * These messages are shown only to system administrators and name
 * configuration variables and failed checks — never a credential or a record.
 */
export function recoveryErrorResponse(e: unknown): NextResponse {
  if (e instanceof OutboundHoldError) return apiError(409, "OUTBOUND_HOLD", e.message);
  if (e instanceof RestoreSafetyError) return apiError(409, "RESTORE_REFUSED", e.message);
  if (e instanceof BackupConfigurationError) return apiError(503, "BACKUP_NOT_CONFIGURED", e.message);
  return errorResponse(e);
}
