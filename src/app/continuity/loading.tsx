import { LoadingState, Screen } from "@/components/states";

/** NAV03 loading: streamed while the status board and recovery records load. */
export default function Loading() {
  return (
    <Screen title="Continuity">
      <LoadingState label="Loading service status and recovery records" rows={6} />
    </Screen>
  );
}
