import { LoadingState, Screen } from "@/components/states";

/** NAV03 loading: streamed while the connector list loads. */
export default function Loading() {
  return (
    <Screen title="Connectors">
      <LoadingState label="Loading connectors" rows={4} />
    </Screen>
  );
}
