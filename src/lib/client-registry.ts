/**
 * Client registry — CLI01-04, CLI06 (PRD §11). CLI05 is R1.
 *
 * The hard part of this module is CLI02:
 *
 *   "Match identifiers through a restricted master data process. Normal staff
 *    receive a NONREVEALING duplicate warning where another practice owns the
 *    match."
 *
 * Both halves matter. Staff must be warned — otherwise they create a duplicate
 * party and the firm ends up with two versions of one client. But they must not
 * learn *whose* client it is, because that is exactly the cross-practice
 * disclosure the whole system exists to prevent. So a match outside the
 * caller's scope returns a flag and nothing else: no name, no id, no practice.
 */

import type { FieldSource, IdentifierKind, VerificationStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getAccessiblePracticeIds } from "@/lib/practice-scope";
import { recordEvent } from "@/lib/audit";

// ---------------------------------------------------------------- CLI02

export type DuplicateMatch =
  | {
      /** The caller may see this one: it is in a practice they belong to. */
      visibility: "IN_SCOPE";
      kind: IdentifierKind;
      partyId: string;
      legalName: string;
      clientRelationshipIds: string[];
    }
  | {
      /**
       * A match exists elsewhere in the tenant. Deliberately carries NO
       * identifying detail — not the party id, not the name, not which
       * practice. Enough to stop a duplicate being created, nothing more.
       */
      visibility: "OUT_OF_SCOPE";
      kind: IdentifierKind;
      message: string;
    };

export type DuplicateCheckResult = {
  hasMatch: boolean;
  matches: DuplicateMatch[];
};

/**
 * CLI02 duplicate detection, run at intake before a party is created.
 * `tenantId` bounds the search: identifiers are never matched across tenants.
 */
export async function checkForDuplicates(params: {
  userId: string;
  tenantId: string;
  identifiers: { kind: IdentifierKind; value: string }[];
}): Promise<DuplicateCheckResult> {
  const accessible = await getAccessiblePracticeIds(params.userId);
  const matches: DuplicateMatch[] = [];

  for (const identifier of params.identifiers) {
    const value = normaliseIdentifier(identifier.value);
    if (!value) continue;

    const hits = await prisma.partyIdentifier.findMany({
      where: {
        kind: identifier.kind,
        value,
        archivedAt: null,
        party: { tenantId: params.tenantId, archivedAt: null },
      },
      select: {
        partyId: true,
        party: {
          select: {
            legalName: true,
            relationships: {
              where: { archivedAt: null },
              select: { id: true, practiceId: true },
            },
          },
        },
      },
    });

    for (const hit of hits) {
      const inScope = hit.party.relationships.filter((r) =>
        accessible.includes(r.practiceId),
      );

      if (inScope.length > 0) {
        matches.push({
          visibility: "IN_SCOPE",
          kind: identifier.kind,
          partyId: hit.partyId,
          legalName: hit.party.legalName,
          clientRelationshipIds: inScope.map((r) => r.id),
        });
      } else {
        matches.push({
          visibility: "OUT_OF_SCOPE",
          kind: identifier.kind,
          message:
            `This ${identifier.kind} is already recorded elsewhere in the firm. ` +
            `Ask a master-data administrator to check before creating a new client record.`,
        });

        // The attempt is worth recording: repeated probing with guessed
        // identifiers is a way to test whether a company is a client.
        await recordEvent({
          action: "DUPLICATE_MATCH_OUT_OF_SCOPE",
          targetType: "PartyIdentifier",
          targetId: `${identifier.kind}:${maskIdentifier(value)}`,
          result: "SUCCESS",
          actorUserId: params.userId,
          reason: "Non-revealing duplicate warning shown to staff",
        });
      }
    }
  }

  return { hasMatch: matches.length > 0, matches };
}

export function normaliseIdentifier(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/** Never log a full identifier back out — the last 4 is enough to correlate. */
function maskIdentifier(value: string): string {
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}

// ---------------------------------------------------------------- CLI03

/**
 * Format validation ONLY. CLI03 is explicit that this "is not proof of
 * identity or registration status", so a pass here yields FORMAT_CHECKED —
 * never VERIFIED.
 */
export function formatCheck(kind: IdentifierKind, value: string): VerificationStatus {
  const v = normaliseIdentifier(value);

  const patterns: Partial<Record<IdentifierKind, RegExp>> = {
    PAN: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    GSTIN: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/,
    TAN: /^[A-Z]{4}[0-9]{5}[A-Z]$/,
    CIN: /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/,
    LLPIN: /^[A-Z]{3}-[0-9]{4}$/,
  };

  const pattern = patterns[kind];
  if (!pattern) return "UNVERIFIED";

  return pattern.test(v) ? "FORMAT_CHECKED" : "FAILED_VERIFICATION";
}

/** CLI03: which fields a given service actually needs. Nothing more is asked. */
const SERVICE_REQUIRED_FIELDS: Record<string, string[]> = {
  GST: ["legalName", "type", "PAN", "GSTIN"],
  AUDIT: ["legalName", "type", "PAN", "CIN"],
  ITR: ["legalName", "type", "PAN"],
  TDS: ["legalName", "type", "PAN", "TAN"],
  ACCOUNTING: ["legalName", "type"],
};

export function requiredFieldsForService(serviceCode: string): string[] {
  return SERVICE_REQUIRED_FIELDS[serviceCode] ?? ["legalName", "type"];
}

export function missingFieldsFor(serviceCode: string, provided: Record<string, unknown>): string[] {
  return requiredFieldsForService(serviceCode).filter((f) => {
    const v = provided[f];
    return v === undefined || v === null || v === "";
  });
}

// ---------------------------------------------------------------- CLI04

/**
 * Conflict screening across BOTH practices, returning a summary that is safe
 * to show the requesting staff member: counts and flags, never names.
 * "Screen related entities and both BHV practices without disclosing
 *  restricted details unnecessarily."
 */
export async function screenForConflicts(params: {
  tenantId: string;
  partyId: string;
  requestingPracticeId: string;
}) {
  const party = await prisma.party.findUniqueOrThrow({
    where: { id: params.partyId },
    select: {
      id: true,
      groupParentOf: { where: { archivedAt: null }, select: { childPartyId: true } },
      groupChildOf: { where: { archivedAt: null }, select: { parentPartyId: true } },
    },
  });

  const relatedPartyIds = [
    party.id,
    ...party.groupParentOf.map((l) => l.childPartyId),
    ...party.groupChildOf.map((l) => l.parentPartyId),
  ];

  const relationships = await prisma.clientRelationship.findMany({
    where: {
      partyId: { in: relatedPartyIds },
      archivedAt: null,
      practice: { tenantId: params.tenantId },
    },
    select: { practiceId: true, partyId: true, acceptanceStatus: true },
  });

  const otherPracticeCount = relationships.filter(
    (r) => r.practiceId !== params.requestingPracticeId,
  ).length;

  return {
    relatedEntitiesScreened: relatedPartyIds.length,
    existingRelationshipsInThisPractice: relationships.filter(
      (r) => r.practiceId === params.requestingPracticeId,
    ).length,
    // A count, and a flag telling the partner to consult master data. No
    // names, no ids, no practice identification.
    existingRelationshipsElsewhereInFirm: otherPracticeCount,
    requiresMasterDataReview: otherPracticeCount > 0,
    screenedAt: new Date().toISOString(),
  };
}

export class AcceptanceRequiredError extends Error {
  readonly code = "ACCEPTANCE_REQUIRED";
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceRequiredError";
  }
}

/**
 * CLI04: "Before active engagement, record ... and partner decision."
 * Called before a relationship may be marked ACCEPTED.
 */
export async function assertAcceptanceComplete(clientRelationshipId: string): Promise<void> {
  const check = await prisma.acceptanceCheck.findFirst({
    where: { clientRelationshipId },
    orderBy: { createdAt: "desc" },
  });

  if (!check) {
    throw new AcceptanceRequiredError(
      "An acceptance and conflict check must be recorded before this client can be engaged.",
    );
  }
  if (check.decision !== "ACCEPTED") {
    throw new AcceptanceRequiredError(
      `Acceptance is ${check.decision}. A partner decision of ACCEPTED is required first.`,
    );
  }
  if (!check.partnerUserId) {
    throw new AcceptanceRequiredError("The acceptance decision must name the deciding partner.");
  }
}

// ---------------------------------------------------------------- CLI01/CLI03

/** Create a party with its identifiers, recording status and source per field. */
export async function createClient(params: {
  userId: string;
  tenantId: string;
  practiceId: string;
  legalName: string;
  type: Parameters<typeof prisma.party.create>[0]["data"]["type"];
  identifiers: {
    kind: IdentifierKind;
    value: string;
    stateCode?: string;
    label?: string;
    source: FieldSource;
    sourceEvidence?: string;
  }[];
  contacts?: {
    fullName: string;
    email?: string;
    phone?: string;
    designation?: string;
    source: FieldSource;
  }[];
}) {
  const party = await prisma.party.create({
    data: {
      tenantId: params.tenantId,
      legalName: params.legalName,
      type: params.type,
      identifiers: {
        create: params.identifiers.map((i) => ({
          kind: i.kind,
          value: normaliseIdentifier(i.value),
          stateCode: i.stateCode,
          label: i.label,
          // A format check is the most this can claim without an external check.
          verificationStatus: formatCheck(i.kind, i.value),
          source: i.source,
          sourceEvidence: i.sourceEvidence,
          effectiveFrom: new Date(),
        })),
      },
      contacts: {
        create: (params.contacts ?? []).map((c) => ({
          fullName: c.fullName,
          email: c.email,
          phone: c.phone,
          designation: c.designation,
          source: c.source,
          // Imported channels stay unverified until actually checked.
          emailVerificationStatus: "UNVERIFIED",
          phoneVerificationStatus: "UNVERIFIED",
        })),
      },
    },
    include: { identifiers: true, contacts: true },
  });

  const relationship = await prisma.clientRelationship.create({
    data: {
      practiceId: params.practiceId,
      partyId: party.id,
      acceptanceStatus: "PROSPECT",
    },
  });

  await recordEvent({
    action: "CLIENT_CREATED",
    targetType: "Party",
    targetId: party.id,
    result: "SUCCESS",
    actorUserId: params.userId,
    tenantId: params.tenantId,
    practiceId: params.practiceId,
    afterMeta: {
      legalName: party.legalName,
      identifierKinds: party.identifiers.map((i) => i.kind),
      clientRelationshipId: relationship.id,
    },
  });

  return { party, relationship };
}
