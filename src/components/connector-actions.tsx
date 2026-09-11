"use client";

/**
 * INT01 screen actions. Same contract as the privacy actions: the result shown
 * is the SERVER's answer (NAV04), a failed save keeps the draft (NAV03 error),
 * and a 409 version conflict shows the conflict wording.
 */

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "@/lib/client-fetch";
import { ConflictState, ErrorState } from "@/components/states";

type Failure = { message: string; conflict: boolean; code?: string };

function useSubmit(what: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(
    path: string,
    body: Record<string, unknown>,
    success: (data: Record<string, unknown>) => string,
    onOk?: () => void,
  ) {
    if (pending) return;
    setPending(true);
    setFailure(null);
    setDone(null);
    const response = await mutate(path, { method: "POST", body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      return setFailure({
        message: data.error ?? "The action did not complete.",
        conflict: response.status === 409 && data.code === "VERSION_CONFLICT",
        code: data.code,
      });
    }
    setDone(success(data));
    onOk?.();
    router.refresh();
  }
  const notice = (
    <>
      {failure?.conflict ? <ConflictState what={what} /> : null}
      {failure && !failure.conflict ? (
        <ErrorState title="Not saved" body={failure.message} detail={failure.code} />
      ) : null}
      {done ? <p role="status" className="muted">{done}</p> : null}
    </>
  );
  return { pending, run, notice };
}

export function CreateConnectorForm({
  practiceId,
  members,
}: {
  practiceId: string;
  members: { id: string; fullName: string }[];
}) {
  const id = useId();
  const [f, setF] = useState({
    name: "",
    provider: "",
    purpose: "",
    ownerUserId: members[0]?.id ?? "",
    environment: "DEVELOPMENT",
    scope: "",
    credentialRef: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const { pending, run, notice } = useSubmit("this connector");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(
      "/api/connectors",
      { practiceId, ...f, scope: f.scope.split(",").map((s) => s.trim()).filter(Boolean) },
      () => "Connector saved as Draft. Run a connection test before activating it.",
      () => setF({ ...f, name: "", purpose: "", scope: "", credentialRef: "" }),
    );
  }

  return (
    <form onSubmit={submit} className="stack">
      {notice}
      <label className="field" htmlFor={`${id}-n`}>
        <span className="field-label">Name</span>
        <input id={`${id}-n`} className="field-input" value={f.name} onChange={set("name")} required />
      </label>
      <label className="field" htmlFor={`${id}-p`}>
        <span className="field-label">Provider (for example smtp, csv-import)</span>
        <input id={`${id}-p`} className="field-input" value={f.provider} onChange={set("provider")} required />
      </label>
      <label className="field" htmlFor={`${id}-u`}>
        <span className="field-label">Purpose — what this connector is approved to do</span>
        <input id={`${id}-u`} className="field-input" value={f.purpose} onChange={set("purpose")} required />
      </label>
      <label className="field" htmlFor={`${id}-o`}>
        <span className="field-label">Owner</span>
        <select id={`${id}-o`} className="field-input" value={f.ownerUserId} onChange={set("ownerUserId")} required>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.fullName}</option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-e`}>
        <span className="field-label">Environment</span>
        <select id={`${id}-e`} className="field-input" value={f.environment} onChange={set("environment")}>
          <option value="DEVELOPMENT">Development</option>
          <option value="TEST">Test</option>
          <option value="PRODUCTION">Production</option>
        </select>
      </label>
      <label className="field" htmlFor={`${id}-s`}>
        <span className="field-label">Scope — permissions it may use, comma separated</span>
        <input id={`${id}-s`} className="field-input" value={f.scope} onChange={set("scope")} required />
      </label>
      <label className="field" htmlFor={`${id}-c`}>
        <span className="field-label">
          Credential reference (env:NAME or vault:path). Never paste the password or token itself.
        </span>
        <input
          id={`${id}-c`}
          className="field-input"
          value={f.credentialRef}
          onChange={set("credentialRef")}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Save connector"}
      </button>
    </form>
  );
}

export function TestConnectorButton({ connectorId }: { connectorId: string }) {
  const { pending, run, notice } = useSubmit("this connector");
  return (
    <div className="stack">
      {notice}
      <button
        className="btn"
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          void run(`/api/connectors/${connectorId}`, { action: "test" }, (d) => {
            const r = d.result as string;
            const label = r === "PASSED" ? "Passed" : r === "FAILED" ? "Failed" : "Not attempted";
            return `${label}: ${String(d.message ?? "")}`;
          })
        }
      >
        {pending ? "Testing…" : "Test connection"}
      </button>
    </div>
  );
}

export function RotateCredentialForm({ connectorId, version }: { connectorId: string; version: number }) {
  const id = useId();
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const { pending, run, notice } = useSubmit("this connector");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          `/api/connectors/${connectorId}`,
          { action: "rotate", expectedVersion: version, newCredentialRef: ref, reason },
          () => "Rotated. Test the new credential before relying on it.",
          () => {
            setRef("");
            setReason("");
          },
        );
      }}
    >
      {notice}
      <label className="field" htmlFor={`${id}-r`}>
        <span className="field-label">New credential reference</span>
        <input id={`${id}-r`} className="field-input" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" spellCheck={false} required />
      </label>
      <label className="field" htmlFor={`${id}-w`}>
        <span className="field-label">Reason for rotation</span>
        <input id={`${id}-w`} className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      <button className="btn" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Rotating…" : "Rotate credential"}
      </button>
    </form>
  );
}

const NEXT_STATUS: Record<string, { status: string; label: string }[]> = {
  DRAFT: [{ status: "ACTIVE", label: "Activate" }, { status: "RETIRED", label: "Retire" }],
  ACTIVE: [{ status: "DISABLED", label: "Disable" }, { status: "RETIRED", label: "Retire" }],
  DISABLED: [{ status: "ACTIVE", label: "Re-activate" }, { status: "RETIRED", label: "Retire" }],
  RETIRED: [],
};

export function ConnectorStatusButtons({
  connectorId,
  version,
  status,
}: {
  connectorId: string;
  version: number;
  status: string;
}) {
  const { pending, run, notice } = useSubmit("this connector");
  const options = NEXT_STATUS[status] ?? [];
  if (!options.length) return null;
  return (
    <div className="stack">
      {notice}
      <div className="row">
        {options.map((o) => (
          <button
            key={o.status}
            type="button"
            className="btn"
            disabled={pending}
            onClick={() =>
              void run(
                `/api/connectors/${connectorId}`,
                { action: "status", expectedVersion: version, status: o.status },
                () => `Status changed to ${o.status.toLowerCase()}.`,
              )
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
