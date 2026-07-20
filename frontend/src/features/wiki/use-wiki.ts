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
  const refresh = useCallback(() => {
    getTree().then(setTree).catch(() => setTree(EMPTY_TREE));
  }, []);
  useEffect(refresh, [refresh]);
  return { tree, refresh };
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
  const refresh = useCallback(() => {
    listProposals(status).then(setProposals).catch(() => setProposals([]));
  }, [status]);
  useEffect(refresh, [refresh]);
  return { proposals, refresh };
}
