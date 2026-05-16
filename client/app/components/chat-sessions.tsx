'use client';

import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatSessionsProps {
  activeSessionId: string | null;
  onSelect: (id: string | null) => void;
  refreshKey: number;
}

export default function ChatSessionsComponent({ activeSessionId, onSelect, refreshKey }: ChatSessionsProps) {
  const { getToken } = useAuth();
  const [sessions, setSessions] = React.useState<ChatSession[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const res = await fetch('http://localhost:8000/chat/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      setSessions(await res.json());
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const token = await getToken();
    await fetch(`http://localhost:8000/chat/sessions/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) onSelect(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Conversations
        </p>
        <Button size="icon-sm" variant="ghost" onClick={() => onSelect(null)} title="New chat">
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-0.5">
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground py-1">No conversations yet</p>
        )}
        {sessions.map((session) => {
          const isActive = activeSessionId === session.id;
          return (
            <div
              key={session.id}
              onClick={() => onSelect(session.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer group ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <MessageSquare className="size-3 shrink-0" />
              <span className="text-xs truncate flex-1">{session.title}</span>
              <button
                onClick={(e) => deleteSession(e, session.id)}
                className={`opacity-0 group-hover:opacity-100 shrink-0 transition-opacity hover:text-destructive ${
                  isActive ? 'text-primary-foreground' : ''
                }`}
                title="Delete conversation"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
