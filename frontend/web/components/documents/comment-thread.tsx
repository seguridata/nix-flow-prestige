"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/services/api-client";
import { useSession } from "@/store/session-store";

interface Comment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export function CommentThread({ documentId }: { documentId: string }) {
  const { signerId, name } = useSession();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const comments = useQuery({
    queryKey: ["comments", documentId],
    queryFn: () => apiClient.get<Comment[]>(`/documents/${documentId}/comments`),
  });
  const add = useMutation({
    mutationFn: () =>
      apiClient.post(`/documents/${documentId}/comments`, {
        authorId: signerId,
        authorName: name,
        body,
      }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["comments", documentId] });
    },
  });

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Comentarios del expediente</h3>
      <ul className="mt-3 flex max-h-40 flex-col gap-2 overflow-y-auto text-sm">
        {(comments.data ?? []).map((c) => (
          <li key={c.id} className="rounded-md bg-muted/60 px-3 py-2">
            <span className="font-medium">{c.authorName}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {new Date(c.createdAt).toLocaleString("es-MX")}
            </span>
            <p className="mt-1">{c.body}</p>
          </li>
        ))}
        {(comments.data ?? []).length === 0 ? (
          <li className="text-xs text-muted-foreground">Sin comentarios todavía.</li>
        ) : null}
      </ul>
      <div className="mt-3 flex gap-2">
        <input
          className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm"
          placeholder="Nota para el expediente…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button size="sm" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}>
          Publicar
        </Button>
      </div>
    </div>
  );
}
