import { useCallback, useEffect, useState } from "react";
import { listCollections, listFiles, type Collection, type KbFile } from "./api";

export function useCollections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    listCollections()
      .then(setCollections)
      .catch(() => setCollections([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(refresh, [refresh]);
  return { collections, loading, refresh };
}

export function useFiles(collectionId: number | null) {
  const [files, setFiles] = useState<KbFile[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(() => {
    if (collectionId === null) {
      setFiles([]);
      return;
    }
    setLoading(true);
    listFiles(collectionId)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [collectionId]);
  useEffect(refresh, [refresh]);
  return { files, loading, refresh };
}
