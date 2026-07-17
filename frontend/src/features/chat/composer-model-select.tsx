import { API_URL, useBackend, useModelSelection } from "./chat-provider";
import { ModelSelect } from "./model-select";
import { useModels } from "./use-models";

/** Model picker rendered inside the composer — chat state, not app chrome. */
export function ComposerModelSelect() {
  const status = useBackend();
  const { model, setModel } = useModelSelection();
  const models = useModels(status === "online" ? API_URL : null);
  return <ModelSelect models={models} value={model} onChange={setModel} />;
}
