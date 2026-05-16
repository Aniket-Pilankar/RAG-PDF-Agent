'use client';

import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Bot, ChevronDown, Download, FileText, Send, User } from 'lucide-react';
import * as React from 'react';

interface Doc {
  pageContent?: string;
  id?: string;
  metadata?: {
    loc?: { pageNumber?: number };
    source?: string;
    pdf?: { info?: { Title?: string }; totalPages?: number };
  };
}

interface IMessage {
  role: 'assistant' | 'user';
  content?: string;
  documents?: Doc[];
}

function extractDisplayName(source: string): string {
  const raw = source.split('/').pop() ?? source;
  const parts = raw.split('-');
  return parts.length > 2 ? parts.slice(2).join('-') : raw;
}

function SourcesAccordion({ docs }: { docs: Doc[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mt-2 rounded-lg border border-border overflow-hidden text-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted hover:bg-muted/70 text-muted-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <FileText className="size-3.5" />
          {docs.length} source{docs.length !== 1 ? 's' : ''}
        </span>
        <ChevronDown
          className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="divide-y divide-border bg-card">
          {docs.map((doc, i) => {
            const source = doc.metadata?.source ?? '';
            const displayName = extractDisplayName(source);
            const rawTitle = doc.metadata?.pdf?.info?.Title ?? '';
            const title = rawTitle.replace(/^Microsoft Word - /, '') || displayName;
            const page = doc.metadata?.loc?.pageNumber;

            return (
              <div key={doc.id ?? i} className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{title}</p>
                  {page !== undefined && (
                    <p className="text-xs text-muted-foreground">Page {page}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                    {doc.pageContent?.trim()}
                  </p>
                </div>
                <Button asChild size="xs" variant="outline" className="shrink-0 mt-0.5">
                  <a href={`http://localhost:8000/${source}`} download={displayName}>
                    <Download />
                    PDF
                  </a>
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted border border-border">
        <Bot className="size-4 text-muted-foreground" />
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-muted border border-border px-4 py-3">
        <div className="flex gap-1.5 items-center h-4">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

interface ChatProps {
  selectedPdfIds?: string[];
  sessionId?: string | null;
  onSessionCreated?: (id: string) => void;
}

const ChatComponent: React.FC<ChatProps> = ({ selectedPdfIds, sessionId, onSessionCreated }) => {
  const { getToken } = useAuth();
  const [message, setMessage] = React.useState('');
  const [messages, setMessages] = React.useState<IMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);


  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  React.useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const res = await fetch(`http://localhost:8000/chat/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      const data: { role: string; content: string }[] = await res.json();
      if (!cancelled) {
        setMessages(data.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })));
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const sendMessage = async () => {
    const text = message.trim();
    if (!text || loading) return;
    setMessage('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const token = await getToken();
      let currentSessionId = sessionId ?? null;

      if (!currentSessionId) {
        const res = await fetch('http://localhost:8000/chat/sessions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 80) }),
        });
        const created = await res.json();
        currentSessionId = created.id;
        onSessionCreated?.(created.id);
      }

      const pdfParam = selectedPdfIds?.length ? `&pdfIds=${selectedPdfIds.join(',')}` : '';
      const sessionParam = `&sessionId=${currentSessionId}`;
      const res = await fetch(`http://localhost:8000/chat?message=${encodeURIComponent(text)}${pdfParam}${sessionParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data?.message, documents: data?.docs },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 min-h-0">
        {messages.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground select-none">
            <Bot className="size-10 opacity-20" />
            <p className="text-sm">Ask a question about your uploaded PDF</p>
          </div>
        )}

        {messages.map((msg, index) => {
          if (msg.role === 'user') {
            return (
              <div key={index} className="flex items-end justify-end gap-2.5">
                <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed">
                  {msg.content}
                </div>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary">
                  <User className="size-4 text-primary-foreground" />
                </div>
              </div>
            );
          }

          return (
            <div key={index} className="flex items-end gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted border border-border">
                <Bot className="size-4 text-muted-foreground" />
              </div>
              <div className="max-w-[75%]">
                <div className="rounded-2xl rounded-bl-sm bg-card border border-border text-card-foreground px-4 py-2.5 text-sm leading-relaxed">
                  {msg.content}
                </div>
                {msg.documents && msg.documents.length > 0 && (
                  <SourcesAccordion docs={msg.documents} />
                )}
              </div>
            </div>
          );
        })}

        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border bg-background px-4 py-3">
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something about your PDF…"
            disabled={loading}
            className="h-9 text-sm"
          />
          <Button
            onClick={sendMessage}
            disabled={!message.trim() || loading}
            size="icon-lg"
          >
            <Send />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChatComponent;
