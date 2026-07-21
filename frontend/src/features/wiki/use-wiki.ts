import { useCallback, useEffect, useState } from "react";
import {
  getPageBySlug,
  getTree,
  listProposals,
  listVersions,
  type WikiPage,
  type WikiProposal,
  type WikiTree,
  type WikiVersion,
} from "./api";

const EMPTY_TREE: WikiTree = { folders: [], pages: [] };

export function useWikiTree() {
  const [tree, setTree] = useState<WikiTree>(EMPTY_TREE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    getTree()
      .then((data) => {
        setTree(data);
        setLoading(false);
      })
      .catch(() => {
        setTree(EMPTY_TREE);
        setError("Failed to load wiki tree");
        setLoading(false);
      });
  }, []);
  useEffect(refresh, [refresh]);
  return { tree, loading, error, refresh };
}

export function useWikiPage(slug: string | null) {
  const [page, setPage] = useState<WikiPage | null>(null);
  const refresh = useCallback(() => {
    if (slug === null) return setPage(null);
    getPageBySlug(slug).then(setPage).catch(() => setPage(null));
  }, [slug]);
  useEffect(refresh, [refresh]);
  return { page, refresh };
}

export function useWikiVersions(pageId: number | null) {
  const [versions, setVersions] = useState<WikiVersion[]>([]);
  const refresh = useCallback(() => {
    if (pageId === null) return setVersions([]);
    listVersions(pageId).then(setVersions).catch(() => setVersions([]));
  }, [pageId]);
  useEffect(refresh, [refresh]);
  return { versions, refresh };
}

export function useWikiProposals(status?: string) {
  const [proposals, setProposals] = useState<WikiProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    listProposals(status)
      .then((data) => {
        setProposals(data);
        setLoading(false);
      })
      .catch(() => {
        setProposals([]);
        setLoading(false);
      });
  }, [status]);
  useEffect(refresh, [refresh]);
  return { proposals, loading, refresh };
}
