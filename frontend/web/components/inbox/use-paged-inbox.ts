"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchInboxPage, fetchSentPage } from "@/services/inbox-service";

export function usePagedInbox(kind: "inbox" | "sent", tenantId: string, actorId: string, criterion: string) {
  return useInfiniteQuery({
    queryKey: [kind, actorId, tenantId, "pages", criterion.trim().toLocaleLowerCase("es")],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => kind === "inbox" ? fetchInboxPage(pageParam, signal) : fetchSentPage(pageParam, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: Boolean(tenantId && actorId),
    // A change of tenant/identity/filter starts from the first page, including when returning to an old filter.
    gcTime: 0,
  });
}
