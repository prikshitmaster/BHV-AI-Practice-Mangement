"use client";

/**
 * PRV04/PRV06 screen actions. Same contract as the continuity actions: every
 * result comes from the SERVER's answer (NAV04), a failed save keeps the draft
 * (NAV03 error), and a 409 version conflict shows the conflict wording.
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
  return <ErrorState title="Not saved" body={failure.message} detail={failure.code} />;
}

/** `datetime-local` gives local wall time; send it as an absolute instant. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");

function useSubmit(what: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(path: string, body: Record<string, unknown>, success: string, onOk?: () => void) {
    if (pending) return;
    setPending(true);
    setFailure(null);
    setDone(null);
    const { response, data } = await postJson(path, body);
    setPending(false);
    if (!response.ok) return setFailure(failureFrom(response, data));
    setDone(success);
    onOk?.();
    router.refresh();
  }
  const notice = (
    <>
      <FailureNotice failure={failure} what={what} />
      {done ? <p role="status" className="muted">{done}</p> : null}
    </>
  );
  return { pending, run, notice };
}

// ---------------------------------------------------------------- incidents

export function ReportIncidentForm({ practiceId }: { practiceId: string }) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [track, setTrack] = useState<"SECURITY" | "ROUTINE_SUPPORT">("SECURITY");
  const [awareness, setAwareness] = useState("");
  const { pending, run, notice } = useSubmit("this incident");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(
      "/api/incidents",
      { practiceId, title, summary, track, awarenessAt: toIso(awareness) },
      "Incident recorded. Its clocks run from the awareness time you gave.",
      () => {
        setTitle("");
        setSummary("");
        setAwareness("");
      },
    );
  }

  return (
    <form onSubmit={submit} className="stack">
      {notice}
      <label className="field" htmlFor={`${id}-t`}>
        <span className="field-label">What happened, in a few words</span>
        <input id={`${id}-t`} className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className="field" htmlFor={`${id}-s`}>
        <span className="field-label">Summary — what you saw. Do not paste client documents or passwords.</span>
        <textarea id={`${id}-s`} className="field-input" value={summary} onChange={(e) => setSummary(e.target.value)} required rows={3} />
      </label>
      <label className="field" htmlFor={`${id}-a`}>
        <span className="field-label">When you (or anyone in the firm) first became aware</span>
        <input id={`${id}-a`} type="datetime-local" className="field-input" value={awareness} onChange={(e) => setAwareness(e.target.value)} required />
      </label>
      <fieldset className="field">
        <legend className="field-label">Kind</legend>
        <label>
          <input type="radio" name={`${id}-k`} checked={track === "SECURITY"} onChange={() => setTrack("SECURITY")} /> Possible
          security incident (reporting clocks apply)
        </label>
        <label>
          <input type="radio" name={`${id}-k`} checked={track === "ROUTINE_SUPPORT"} onChange={() => setTrack("ROUTINE_SUPPORT")} />{" "}
          Routine support problem (no reporting clock)
        </label>
      </fieldset>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Recording…" : "Report incident"}
      </button>
    </form>
  );
}

export function AssessCertInForm({ incidentId, version }: { incidentId: string; version: number }) {
  const id = useId();
  const [applicable, setApplicable] = useState<"yes" | "no">("yes");
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const { pending, run, notice } = useSubmit("this incident");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          `/api/incidents/${incidentId}`,
          { action: "assess", expectedVersion: version, applicable: applicable === "yes", category, reason },
          "Assessment recorded.",
        );
      }}
      className="stack"
    >
      {notice}
      <fieldset className="field">
        <legend className="field-label">Is it a specified cyber incident under the CERT-In directions?</legend>
        <label>
          <input type="radio" name={`${id}-ap`} checked={applicable === "yes"} onChange={() => setApplicable("yes")} /> Yes — report within 6 h of awareness
        </label>
        <label>
          <input type="radio" name={`${id}-ap`} checked={applicable === "no"} onChange={() => setApplicable("no")} /> No
        </label>
      </fieldset>
      {applicable === "yes" ? (
        <label className="field" htmlFor={`${id}-c`}>
          <span className="field-label">Category it falls under</span>
          <input id={`${id}-c`} className="field-input" value={category} onChange={(e) => setCategory(e.target.value)} required />
        </label>
      ) : null}
      <label className="field" htmlFor={`${id}-r`}>
        <span className="field-label">Reason for the assessment</span>
        <input id={`${id}-r`} className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Record assessment"}
      </button>
    </form>
  );
}

export function RecordReportForm({
  incidentId,
  regimes,
}: {
  incidentId: string;
  regimes: { regime: string; label: string }[];
}) {
  const id = useId();
  const [regime, setRegime] = useState(regimes[0]?.regime ?? "");
  const [reportedAt, setReportedAt] = useState("");
  const [reference, setReference] = useState("");
  const { pending, run, notice } = useSubmit("this incident");
  if (!regimes.length) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          `/api/incidents/${incidentId}`,
          { action: "report", regime, reportedAt: toIso(reportedAt), reference },
          "Report recorded.",
        );
      }}
      className="stack"
    >
      {notice}
      <label className="field" htmlFor={`${id}-g`}>
        <span className="field-label">Report made under</span>
        <select id={`${id}-g`} className="field-input" value={regime} onChange={(e) => setRegime(e.target.value)}>
          {regimes.map((r) => (
            <option key={r.regime} value={r.regime}>{r.label}</option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-w`}>
        <span className="field-label">When it was made</span>
        <input id={`${id}-w`} type="datetime-local" className="field-input" value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} required />
      </label>
      <label className="field" htmlFor={`${id}-ref`}>
        <span className="field-label">Acknowledgement or reference given by the authority</span>
        <input id={`${id}-ref`} className="field-input" value={reference} onChange={(e) => setReference(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Record report"}
      </button>
    </form>
  );
}

export function CorrectAwarenessForm({ incidentId, version }: { incidentId: string; version: number }) {
  const id = useId();
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const { pending, run, notice } = useSubmit("this incident");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          `/api/incidents/${incidentId}`,
          { action: "awareness", expectedVersion: version, awarenessAt: toIso(when), reason },
          "Awareness corrected; the earlier time is kept in the history.",
        );
      }}
      className="stack"
    >
      {notice}
      <p className="muted">Only an EARLIER time is accepted — a later one would extend a reporting deadline.</p>
      <label className="field" htmlFor={`${id}-w`}>
        <span className="field-label">Corrected awareness time</span>
        <input id={`${id}-w`} type="datetime-local" className="field-input" value={when} onChange={(e) => setWhen(e.target.value)} required />
      </label>
      <label className="field" htmlFor={`${id}-r`}>
        <span className="field-label">What shows it was earlier</span>
        <input id={`${id}-r`} className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Correct awareness time"}
      </button>
    </form>
  );
}

export function RootCauseForm({ incidentId, version, current }: { incidentId: string; version: number; current: string }) {
  const id = useId();
  const [rootCause, setRootCause] = useState(current);
  const [note, setNote] = useState("");
  const { pending, run, notice } = useSubmit("this incident");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(`/api/incidents/${incidentId}`, { action: "root-cause", expectedVersion: version, rootCause, note }, "Root cause updated. No clock moved.");
      }}
      className="stack"
    >
      {notice}
      <label className="field" htmlFor={`${id}-rc`}>
        <span className="field-label">Root cause investigation</span>
        <select id={`${id}-rc`} className="field-input" value={rootCause} onChange={(e) => setRootCause(e.target.value)}>
          <option value="UNKNOWN">Unknown</option>
          <option value="INVESTIGATING">Investigating</option>
          <option value="IDENTIFIED">Identified</option>
        </select>
      </label>
      <label className="field" htmlFor={`${id}-n`}>
        <span className="field-label">Note (required once identified)</span>
        <input id={`${id}-n`} className="field-input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Update root cause"}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ erasure

export function ErasureRequestForm({
  practiceId,
  engagements,
  contacts,
}: {
  practiceId: string;
  engagements: { id: string; label: string }[];
  contacts: { id: string; label: string }[];
}) {
  const id = useId();
  const [engagementId, setEngagementId] = useState(engagements[0]?.id ?? "");
  const [contactId, setContactId] = useState("");
  const [receivedVia, setReceivedVia] = useState("");
  const [requestText, setRequestText] = useState("");
  const { pending, run, notice } = useSubmit("this request");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          "/api/privacy/erasure",
          { practiceId, engagementId, contactId, receivedVia, requestText },
          "Request logged. Every item is listed below with what must be retained.",
          () => {
            setReceivedVia("");
            setRequestText("");
          },
        );
      }}
      className="stack"
    >
      {notice}
      <label className="field" htmlFor={`${id}-e`}>
        <span className="field-label">Engagement</span>
        <select id={`${id}-e`} className="field-input" value={engagementId} onChange={(e) => setEngagementId(e.target.value)} required>
          {engagements.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-c`}>
        <span className="field-label">Person asking (optional)</span>
        <select id={`${id}-c`} className="field-input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">— not a named contact —</option>
          {contacts.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-v`}>
        <span className="field-label">How it arrived</span>
        <input id={`${id}-v`} className="field-input" value={receivedVia} onChange={(e) => setReceivedVia(e.target.value)} required />
      </label>
      <label className="field" htmlFor={`${id}-t`}>
        <span className="field-label">What they asked for</span>
        <textarea id={`${id}-t`} className="field-input" rows={2} value={requestText} onChange={(e) => setRequestText(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Logging…" : "Log erasure request"}
      </button>
    </form>
  );
}

type ReviewItem = { id: string; label: string; mustRetainReason: string | null };

export function ErasureReviewForm({ requestId, version, items }: { requestId: string; version: number; items: ReviewItem[] }) {
  const id = useId();
  const [decisions, setDecisions] = useState<Record<string, { decision: "ERASE" | "RETAIN"; reason: string }>>(
    Object.fromEntries(
      items.map((i) => [i.id, { decision: "RETAIN" as const, reason: i.mustRetainReason ?? "" }]),
    ),
  );
  const { pending, run, notice } = useSubmit("this request");
  const set = (itemId: string, patch: Partial<{ decision: "ERASE" | "RETAIN"; reason: string }>) =>
    setDecisions((d) => ({ ...d, [itemId]: { ...d[itemId], ...patch } }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          `/api/privacy/erasure/${requestId}`,
          {
            action: "review",
            expectedVersion: version,
            decisions: items.map((i) => ({ itemId: i.id, ...decisions[i.id] })),
          },
          "Review recorded.",
        );
      }}
      className="stack"
    >
      {notice}
      {items.map((item, n) => (
        <fieldset key={item.id} className="field">
          <legend className="field-label">{item.label}</legend>
          {item.mustRetainReason ? (
            <p className="muted">Must be retained: {item.mustRetainReason}</p>
          ) : null}
          <label>
            <input
              type="radio"
              name={`${id}-${n}`}
              checked={decisions[item.id].decision === "RETAIN"}
              onChange={() => set(item.id, { decision: "RETAIN" })}
            />{" "}
            Retain
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-${n}`}
              disabled={!!item.mustRetainReason}
              checked={decisions[item.id].decision === "ERASE"}
              onChange={() => set(item.id, { decision: "ERASE" })}
            />{" "}
            Erase{item.mustRetainReason ? " (not available)" : ""}
          </label>
          <label className="field" htmlFor={`${id}-${n}-r`}>
            <span className="field-label">Reason</span>
            <input
              id={`${id}-${n}-r`}
              className="field-input"
              value={decisions[item.id].reason}
              onChange={(e) => set(item.id, { reason: e.target.value })}
              required
            />
          </label>
        </fieldset>
      ))}
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Record review"}
      </button>
    </form>
  );
}

export function ActionErasureButton({ requestId, version, eraseCount }: { requestId: string; version: number; eraseCount: number }) {
  const router = useRouter();
  return (
    <SafeAction
      label="Carry out the erase decisions"
      pendingLabel="Erasing…"
      danger
      confirm={{
        title: "Erase now?",
        body: `${eraseCount} item(s) will be erased and cannot be recovered from the live system. Retained items are not touched. Copies already in backups expire on the backup schedule.`,
        confirmLabel: "Erase",
      }}
      onConfirm={async (): Promise<ActionOutcome> => {
        const { response, data } = await postJson(`/api/privacy/erasure/${requestId}`, { action: "action", expectedVersion: version });
        if (!response.ok) {
          return { ok: false, message: data.error ?? "Not done.", conflict: response.status === 409 && data.code === "VERSION_CONFLICT" };
        }
        router.refresh();
        return { ok: true, message: data.summary ?? "Done." };
      }}
    />
  );
}
