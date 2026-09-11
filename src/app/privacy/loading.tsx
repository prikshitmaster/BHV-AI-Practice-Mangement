import { LoadingState, Screen } from "@/components/states";

/** NAV03 loading: streamed while incidents, registers and requests load. */
export default function Loading() {
  return (
    <Screen title="Privacy and incidents">
      <LoadingState label="Loading incidents, registers and erasure requests" rows={6} />
    </Screen>
  );
}
