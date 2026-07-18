import { useCallback, useEffect, useState } from "react";
import { listCollections, listFiles, type Collection, type KbFile } from "./api";

export function useCollections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const refresh = useCallback(() => {
    listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);
  useEffect(refresh, [refresh]);
  return { collections, refresh };
}

export function useFiles(collectionId: number | null) {
  const [files, setFiles] = useState<KbFile[]>([]);
  const refresh = useCallback(() => {
    if (collectionId === null) return setFiles([]);
    listFiles(collectionId).then(setFiles).catch(() => setFiles([]));
  }, [collectionId]);
  useEffect(refresh, [refresh]);
  return { files, refresh };
}
