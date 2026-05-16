'use client';

import * as React from 'react';
import ChatComponent from './components/chat';
import ChatSessionsComponent from './components/chat-sessions';
import FileUploadComponent from './components/file-upload';
import PdfListComponent from './components/pdf-list';

export default function Home() {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [selectedPdfIds, setSelectedPdfIds] = React.useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [sessionRefreshKey, setSessionRefreshKey] = React.useState(0);

  return (
    <div className="h-[calc(100vh-64px)] flex overflow-hidden bg-background">
      <aside className="w-72 shrink-0 border-r border-border flex flex-col p-5 gap-5 overflow-y-auto bg-card">
        <ChatSessionsComponent
          activeSessionId={activeSessionId}
          onSelect={setActiveSessionId}
          refreshKey={sessionRefreshKey}
        />

        <div className="border-t border-border" />

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Documents
          </p>
          <FileUploadComponent onUploadComplete={() => setRefreshKey((k) => k + 1)} />
        </div>

        <PdfListComponent
          refreshKey={refreshKey}
          onSelectionChange={setSelectedPdfIds}
        />

        <div className="rounded-lg bg-muted p-4 text-xs text-muted-foreground leading-relaxed">
          <p className="font-medium text-foreground mb-2">How it works</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Upload a PDF above</li>
            <li>Wait while it gets indexed</li>
            <li>Ask questions in the chat</li>
          </ol>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <ChatComponent
          selectedPdfIds={selectedPdfIds}
          sessionId={activeSessionId}
          onSessionCreated={(id) => {
            setActiveSessionId(id);
            setSessionRefreshKey((k) => k + 1);
          }}
        />
      </main>
    </div>
  );
}
