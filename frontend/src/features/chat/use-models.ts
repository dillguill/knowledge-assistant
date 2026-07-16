import { useEffect, useState } from "react";

export type ApiModel = {
  id: string;
  name: string;
  context_length: number | null;
};

export function useModels(baseUrl: string | null) {
  const [models, setModels] = useState<ApiModel[]>([]);

  useEffect(() => {
    if (!baseUrl) return;
    const controller = new AbortController();
    fetch(`${baseUrl}/api/models`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((data: { models: ApiModel[] }) => setModels(data.models))
      .catch(() => setModels([]));
    return () => controller.abort();
  }, [baseUrl]);

  return models;
}
