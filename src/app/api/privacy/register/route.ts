import { NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api";
import { assertCsrf } from "@/lib/csrf";
import { requireUserId } from "@/lib/session";
import { createProcessingActivity, listProcessingActivities } from "@/lib/privacy-register";
import type { LegalBasis, PracticeRole } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const BASES: LegalBasis[] = [
  "LEGAL_OBLIGATION",
  "PROFESSIONAL_DUTY",
  "CONTRACT_PERFORMANCE",
  "LEGITIMATE_USE",
  "CONSENT",
];

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** PRV01: this practice's processing register. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const practiceId = new URL(request.url).searchParams.get("practiceId");
    if (!practiceId) return badRequest("practiceId is required");
    return NextResponse.json({ activities: await listProcessingActivities(userId, practiceId) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PRV01: add a processing purpose. Consent rules are enforced in the library. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await assertCsrf(request);
    const body = await request.json().catch(() => ({}));
    if (typeof body.practiceId !== "string") return badRequest("practiceId is required");
    if (!BASES.includes(body.legalBasis)) return badRequest("Unknown legal basis");
    const row = await createProcessingActivity({
      actorUserId: userId,
      practiceId: body.practiceId,
      input: {
        name: String(body.name ?? ""),
        purpose: String(body.purpose ?? ""),
        dataCategories: list(body.dataCategories),
        source: String(body.source ?? ""),
        accessRoles: list(body.accessRoles) as PracticeRole[],
        recipients: list(body.recipients),
        vendor: typeof body.vendor === "string" ? body.vendor : null,
        hostingLocation: String(body.hostingLocation ?? ""),
        retentionClass: String(body.retentionClass ?? ""),
        legalBasis: body.legalBasis,
        legalAuthority: String(body.legalAuthority ?? ""),
        noticeReference: typeof body.noticeReference === "string" ? body.noticeReference : null,
        consentRecordReference:
          typeof body.consentRecordReference === "string" ? body.consentRecordReference : null,
        ownerName: String(body.ownerName ?? ""),
      },
    });
    return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
