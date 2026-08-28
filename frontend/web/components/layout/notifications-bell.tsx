"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { apiClient } from "@/services/api-client";
import { useSession } from "@/store/session-store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Notification {
  id: string;
  title: string;
  body: string;
  href?: string | null;
  read: boolean;
  createdAt: string;
}

export function NotificationsBell() {
  const { signerId } = useSession();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications", signerId],
    queryFn: () => apiClient.get<Notification[]>(`/me/notifications?userId=${encodeURIComponent(signerId)}`),
    refetchInterval: 20_000,
  });
  const unread = (query.data ?? []).filter((n) => !n.read).length;
  const mark = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/me/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", signerId] }),
  });
  const markAll = useMutation({
    mutationFn: () => apiClient.post("/me/notifications/read-all", { userId: signerId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", signerId] }),
  });

  return (
    <Popover>
      <PopoverTrigger
        className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Notificaciones"
      >
        <Bell className="size-4" />
        {unread > 0 ? <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" /> : null}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Avisos</p>
          {unread > 0 ? (
            <button type="button" className="text-xs text-primary" onClick={() => markAll.mutate()}>
              Marcar leídos
            </button>
          ) : null}
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {(query.data ?? []).length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">Sin avisos.</li>
          ) : (
            (query.data ?? []).map((n) => (
              <li key={n.id} className={n.read ? "opacity-60" : ""}>
                <Link
                  href={(n.href ?? "/overview") as "/overview"}
                  className="block px-3 py-2.5 hover:bg-muted"
                  onClick={() => {
                    if (!n.read) mark.mutate(n.id);
                  }}
                >
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.body}</p>
                </Link>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
