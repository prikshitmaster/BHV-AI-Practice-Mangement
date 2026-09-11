"use client";

/**
 * BCP04/BCP06 screen actions. Every one resolves from the SERVER's answer
 * (NAV04 — no success message before the transaction commits), keeps the
 * user's draft on failure (NAV03 error state), and turns a 409 into the
 * conflict wording rather than a generic error.
 */

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "@/lib/client-fetch";
import { SafeAction, type ActionOutcome } from "@/components/safe-action";
import { ConflictState, ErrorState } from "@/components/states";

type Failure = { message: string; conflict: boolean; code?: string };

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await mutate(path, { method: "POST", body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function failureFrom(response: Response, data: { error?: string; code?: string }): Failure {
  return {
    message: data.error ?? "The action did not complete.",
    conflict: response.status === 409 && data.code === "VERSION_CONFLICT",
    code: data.code,
  };
}

function FailureNotice({ failure, what }: { failure: Failure | null; what: string }) {
  if (!failure) return null;
  if (failure.conflict) return <ConflictState what={what} />;
  return <ErrorState title="Not done" body={failure.message} detail={failure.code} />;
}

// ------------------------------------------------------------------ status

export function ProbeButton() {
  const router = useRouter();
  return (
    <SafeAction
      label="Re-check services now"
      pendingLabel="Checking database, object store and queue…"
      onConfirm={async (): Promise<ActionOutcome> => {
        const { response, data } = await postJson("/api/continuity/status", { action: "probe" });
        if (!response.ok) return { ok: false, message: data.error ?? "Could not run the check." };
        router.refresh();
        return { ok: true, message: "Checked just now." };
      }}
    />
  );
}

const SERVICES_REPORTABLE = ["INTERNET", "EMAIL", "AI", "CONNECTOR"] as const;
const STATES = ["OPERATIONAL", "DEGRADED", "OFFLINE", "UNKNOWN"] as const;

export function ReportStatusForm() {
  const router = useRouter();
  const id = useId();
  const [service, setService] = useState<string>("EMAIL");
  const [state, setState] = useState<string>("OFFLINE");
  const [detail, setDetail] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    setDone(null);
    const { response, data } = await postJson("/api/continuity/status", { service, state, detail });
    setPending(false);
    if (!response.ok) return setFailure(failureFrom(response, data));
    setDone(`${service} recorded as ${state}.`);
    setDetail("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} aria-describedby={`${id}-hint`}>
      <p id={`${id}-hint`} className="field-hint">
        For services this system cannot measure. The database, object store and queue are
        measured by the check above and cannot be set by hand.
      </p>
      <FailureNotice failure={failure} what="this status" />
      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="field" htmlFor={`${id}-service`}>
          <span className="field-label">Service</span>
          <select id={`${id}-service`} className="field-input" value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICES_REPORTABLE.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`${id}-state`}>
          <span className="field-label">State</span>
          <select id={`${id}-state`} className="field-input" value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field" htmlFor={`${id}-detail`}>
        <span className="field-label">What was observed</span>
        <input id={`${id}-detail`} className="field-input" value={detail} onChange={(e) => setDetail(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Recording…" : "Record status"}
      </button>
      {done ? <p role="status">{done}</p> : null}
    </form>
  );
}

// ---------------------------------------------------------------- downtime

type Line = { occurredAt: string; description: string; service: string };
const blankLine = (): Line => ({ occurredAt: "", description: "", service: "" });

export function DowntimeForm({ practiceId }: { practiceId: string }) {
  const router = useRouter();
  const id = useId();
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    setDone(null);
    const { response, data } = await postJson("/api/continuity/downtime", {
      practiceId,
      entries: lines.map((l) => ({
        // datetime-local has no zone; the browser's own zone is what the person meant.
        occurredAt: l.occurredAt ? new Date(l.occurredAt).toISOString() : "",
        description: l.description,
        service: l.service || null,
      })),
    });
    setPending(false);
    // The sheet stays on screen on failure — nothing typed is lost.
    if (!response.ok) return setFailure(failureFrom(response, data));
    setDone(`${data.ids.length} line${data.ids.length === 1 ? "" : "s"} entered. They stay outstanding until reconciled.`);
    setLines([blankLine()]);
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <FailureNotice failure={failure} what="the downtime sheet" />
      {lines.map((line, i) => (
        <fieldset key={i} className="card" style={{ marginBottom: 12 }}>
          <legend>Line {i + 1}</legend>
          <label className="field" htmlFor={`${id}-${i}-when`}>
            <span className="field-label">When the work was done</span>
            <input
              id={`${id}-${i}-when`}
              className="field-input"
              type="datetime-local"
              value={line.occurredAt}
              onChange={(e) => update(i, { occurredAt: e.target.value })}
              required
            />
          </label>
          <label className="field" htmlFor={`${id}-${i}-what`}>
            <span className="field-label">What was done</span>
            <textarea
              id={`${id}-${i}-what`}
              className="field-input"
              rows={2}
              value={line.description}
              onChange={(e) => update(i, { description: e.target.value })}
              required
            />
          </label>
          <label className="field" htmlFor={`${id}-${i}-svc`}>
            <span className="field-label">Service that was down (optional)</span>
            <select
              id={`${id}-${i}-svc`}
              className="field-input"
              value={line.service}
              onChange={(e) => update(i, { service: e.target.value })}
            >
              <option value="">Not recorded</option>
              {["DATABASE", "OBJECT_STORE", "QUEUE", "INTERNET", "EMAIL", "AI", "CONNECTOR"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          {lines.length > 1 ? (
            <button type="button" className="btn" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              Remove line {i + 1}
            </button>
          ) : null}
        </fieldset>
      ))}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, blankLine()])}>
          Add a line
        </button>
        <button className="btn btn--primary" type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Entering the sheet…" : "Enter the downtime sheet"}
        </button>
      </div>
      {done ? <p role="status">{done}</p> : null}
    </form>
  );
}

/** A note plus a button, posted with the version the screen loaded (API02). */
export function NoteAction({
  path,
  label,
  pendingLabel,
  noteLabel,
  noteField,
  version,
  what,
}: {
  path: string;
  label: string;
  pendingLabel: string;
  noteLabel: string;
  noteField: "note" | "reason";
  version: number;
  what: string;
}) {
  const router = useRouter();
  const id = useId();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    const { response, data } = await postJson(path, { expectedVersion: version, [noteField]: note });
    setPending(false);
    if (!response.ok) return setFailure(failureFrom(response, data));
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <FailureNotice failure={failure} what={what} />
      <label className="field" htmlFor={`${id}-note`} style={{ marginBottom: 8 }}>
        <span className="field-label">{noteLabel}</span>
        <input id={`${id}-note`} className="field-input" value={note} onChange={(e) => setNote(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}

// ------------------------------------------------------- emergency export

export function EmergencyExportForm({ practiceId, practiceName }: { practiceId: string; practiceName: string }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [result, setResult] = useState<{ rows: string; sha: string; url: string; filename: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFailure(null);
    setResult(null);

    setPending("Confirming your authenticator code…");
    const step = await postJson("/api/auth/step-up", { purpose: "EXPORT", code });
    if (!step.response.ok) {
      setPending(null);
      return setFailure(failureFrom(step.response, step.data));
    }

    setPending("Preparing the export…");
    const response = await mutate("/api/continuity/emergency-export", {
      method: "POST",
      body: JSON.stringify({ practiceId, reason }),
    });
    setPending(null);
    setCode("");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return setFailure(failureFrom(response, data));
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "emergency-obligations.csv";
    setResult({
      rows: response.headers.get("x-bhv-export-row-count") ?? "?",
      sha: response.headers.get("x-bhv-export-sha256") ?? "",
      url: URL.createObjectURL(blob),
      filename,
    });
  }

  return (
    <form onSubmit={submit}>
      <p className="field-hint">
        Open obligations in {practiceName} only, with every statutory and internal date in its own
        column, as a plain CSV that opens without this system. Confirmed with your authenticator
        code and recorded on the audit trail with your reason.
      </p>
      <FailureNotice failure={failure} what="the export" />
      <label className="field" htmlFor={`${id}-reason`}>
        <span className="field-label">Reason</span>
        <input id={`${id}-reason`} className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      <label className="field" htmlFor={`${id}-code`}>
        <span className="field-label">Authenticator code</span>
        <input
          id={`${id}-code`}
          className="field-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
        />
      </label>
      <button className="btn btn--primary" type="submit" disabled={pending !== null} aria-busy={pending !== null}>
        {pending ?? "Export open obligations"}
      </button>
      {result ? (
        <p role="status">
          {result.rows} obligation{result.rows === "1" ? "" : "s"} exported.{" "}
          <a href={result.url} download={result.filename}>
            Save {result.filename}
          </a>
          <br />
          <span className="muted">
            SHA-256 <code>{result.sha}</code> — the same digest is on the audit trail.
          </span>
        </p>
      ) : null}
    </form>
  );
}

// ------------------------------------------------------------- recovery

export function RunBackupButton() {
  const router = useRouter();
  return (
    <SafeAction
      label="Take a backup now"
      pendingLabel="Backing up database, files and audit trail…"
      confirm={{
        title: "Take a full backup now?",
        body: <>Every table, every stored file and the audit trail are read and encrypted. This can take a few minutes.</>,
        confirmLabel: "Take backup",
      }}
      onConfirm={async (): Promise<ActionOutcome> => {
        const { response, data } = await postJson("/api/recovery/backups", {});
        if (!response.ok) return { ok: false, message: data.error ?? "The backup did not complete." };
        router.refresh();
        return {
          ok: true,
          message: `Backup taken${data.offsite ? " with an offsite copy" : " — NO offsite copy"}; ${data.gaps.length} gap(s) reported.`,
        };
      }}
    />
  );
}

const SCENARIOS = [
  ["PRIMARY_SERVER_LOSS", "Loss of the primary server (restores from the offsite copy)"],
  ["KEY_SERVICE_UNAVAILABLE", "Key service unavailable"],
  ["SOLE_ADMINISTRATOR_DEPARTED", "The only administrator has left"],
  ["SCHEDULED_QUARTERLY", "Scheduled quarterly restore"],
] as const;

type DrillResult = {
  clean: boolean;
  missingItems: string[];
  exceptions: string[];
  evidence: string[];
  achievedRpoSeconds: number | null;
  achievedRtoSeconds: number | null;
};

export function RunDrillForm() {
  const router = useRouter();
  const id = useId();
  const [scenario, setScenario] = useState<string>(SCENARIOS[0][0]);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [escrowBy, setEscrowBy] = useState("");
  const [escrowFp, setEscrowFp] = useState("");
  const [custodians, setCustodians] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [result, setResult] = useState<DrillResult | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    setResult(null);
    const { response, data } = await postJson("/api/recovery/drills", {
      scenario,
      remediationOwnerName: owner,
      remediationDueAt: due ? new Date(`${due}T00:00:00Z`).toISOString() : null,
      notes,
      escrow: escrowBy && escrowFp ? { retrievedByName: escrowBy, keyFingerprint: escrowFp } : null,
      keyCustodianNames: custodians.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setPending(false);
    if (!response.ok) return setFailure(failureFrom(response, data));
    setResult(data);
    router.refresh();
  }

  const needsKeys = scenario === "KEY_SERVICE_UNAVAILABLE" || scenario === "SOLE_ADMINISTRATOR_DEPARTED";

  return (
    <form onSubmit={submit}>
      <FailureNotice failure={failure} what="the drill" />
      <label className="field" htmlFor={`${id}-scenario`}>
        <span className="field-label">Scenario</span>
        <select id={`${id}-scenario`} className="field-input" value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {SCENARIOS.map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-owner`}>
        <span className="field-label">Remediation owner</span>
        <input id={`${id}-owner`} className="field-input" value={owner} onChange={(e) => setOwner(e.target.value)} required />
      </label>
      <label className="field" htmlFor={`${id}-due`}>
        <span className="field-label">Remediation due date</span>
        <span className="field-hint">Findings without a due date are recorded as an exception.</span>
        <input id={`${id}-due`} className="field-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      {needsKeys ? (
        <>
          {scenario === "KEY_SERVICE_UNAVAILABLE" ? (
            <>
              <label className="field" htmlFor={`${id}-escrow-by`}>
                <span className="field-label">Escrowed key retrieved by</span>
                <input id={`${id}-escrow-by`} className="field-input" value={escrowBy} onChange={(e) => setEscrowBy(e.target.value)} />
              </label>
              <label className="field" htmlFor={`${id}-escrow-fp`}>
                <span className="field-label">Fingerprint of the retrieved key</span>
                <span className="field-hint">
                  Checked against the key the backups were actually written under — a mismatch is recorded as missing.
                </span>
                <input id={`${id}-escrow-fp`} className="field-input" value={escrowFp} onChange={(e) => setEscrowFp(e.target.value)} />
              </label>
            </>
          ) : null}
          <label className="field" htmlFor={`${id}-custodians`}>
            <span className="field-label">Named key custodians (comma separated)</span>
            <input id={`${id}-custodians`} className="field-input" value={custodians} onChange={(e) => setCustodians(e.target.value)} />
          </label>
        </>
      ) : null}
      <label className="field" htmlFor={`${id}-notes`}>
        <span className="field-label">Notes</span>
        <textarea id={`${id}-notes`} className="field-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="btn btn--primary" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Running the drill — a restore can take a few minutes…" : "Run drill"}
      </button>
      {result ? (
        <div role="status" className="card" style={{ marginTop: 12 }}>
          <p className="state-title">{result.clean ? "Drill passed with no findings" : "Drill recorded findings"}</p>
          {result.achievedRtoSeconds !== null ? (
            <p>Achieved RPO {result.achievedRpoSeconds} s, RTO {result.achievedRtoSeconds} s.</p>
          ) : null}
          {result.missingItems.length ? (
            <>
              <p><strong>Missing</strong></p>
              <ul>{result.missingItems.map((m) => <li key={m}>{m}</li>)}</ul>
            </>
          ) : null}
          {result.exceptions.length ? (
            <>
              <p><strong>Exceptions</strong></p>
              <ul>{result.exceptions.map((m) => <li key={m}>{m}</li>)}</ul>
            </>
          ) : null}
          <p><strong>What was checked</strong></p>
          <ul>{result.evidence.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      ) : null}
    </form>
  );
}
