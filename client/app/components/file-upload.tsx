'use client';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { CheckCircle, FileText, Loader2, Upload, XCircle } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import * as React from 'react';

type UploadState = 'idle' | 'uploading' | 'processing' | 'ready' | 'error';

const FileUploadComponent: React.FC = () => {
  const { getToken } = useAuth();
  const [state, setState] = React.useState<UploadState>('idle');
  const [fileName, setFileName] = React.useState<string | null>(null);
  const socketRef = React.useRef<Socket | null>(null);

  const cleanupSocket = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
  };

  React.useEffect(() => () => cleanupSocket(), []);

  const subscribeToStatus = (jobId: string) => {
    cleanupSocket();
    const socket = io('http://localhost:8000');
    socketRef.current = socket;

    socket.emit('subscribe', jobId);

    socket.on('job:status', ({ status }: { status: string }) => {
      if (status === 'completed') {
        setState('ready');
      } else if (status === 'failed') {
        setState('error');
      }
      cleanupSocket();
    });

    socket.on('connect_error', () => {
      setState('error');
      cleanupSocket();
    });
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setState('uploading');
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('pdf', file);
      const res = await fetch('http://localhost:8000/upload/pdf', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error();
      const { jobId } = await res.json();
      setState('processing');
      subscribeToStatus(jobId);
    } catch {
      setState('error');
    }
  };

  const openPicker = () => {
    if (state === 'uploading' || state === 'processing') return;
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'application/pdf';
    el.addEventListener('change', () => {
      if (el.files?.[0]) handleFile(el.files[0]);
    });
    el.click();
  };

  const reset = (e: React.MouseEvent) => {
    e.stopPropagation();
    cleanupSocket();
    setState('idle');
    setFileName(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        onClick={openPicker}
        className={`
          flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
          px-4 py-8 text-center transition-colors
          ${state === 'idle' ? 'border-border hover:border-primary cursor-pointer hover:bg-muted/50' : ''}
          ${state === 'uploading' || state === 'processing' ? 'border-border bg-muted/30 cursor-wait' : ''}
          ${state === 'ready' ? 'border-border bg-muted/30 cursor-pointer' : ''}
          ${state === 'error' ? 'border-destructive bg-destructive/5 cursor-pointer' : ''}
        `}
      >
        {state === 'idle' && (
          <>
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <Upload className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Click to upload PDF</p>
              <p className="text-xs text-muted-foreground mt-0.5">Only .pdf files accepted</p>
            </div>
          </>
        )}

        {state === 'uploading' && (
          <>
            <Loader2 className="size-8 text-primary animate-spin" />
            <div>
              <p className="text-sm font-medium text-foreground">Uploading…</p>
              {fileName && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[160px]">
                  {fileName}
                </p>
              )}
            </div>
          </>
        )}

        {state === 'processing' && (
          <>
            <Loader2 className="size-8 text-primary animate-spin" />
            <div>
              <p className="text-sm font-medium text-foreground">Processing PDF…</p>
              {fileName && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  <FileText className="size-3" />
                  <span className="truncate max-w-[150px]">{fileName}</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">Generating embeddings…</p>
            </div>
          </>
        )}

        {state === 'ready' && (
          <>
            <CheckCircle className="size-8 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Ready to chat!</p>
              {fileName && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  <FileText className="size-3" />
                  <span className="truncate max-w-[150px]">{fileName}</span>
                </p>
              )}
            </div>
            <Button size="xs" variant="outline" onClick={reset}>
              Upload another
            </Button>
          </>
        )}

        {state === 'error' && (
          <>
            <XCircle className="size-8 text-destructive" />
            <div>
              <p className="text-sm font-medium text-foreground">Upload failed</p>
              <p className="text-xs text-muted-foreground mt-0.5">Please try again</p>
            </div>
            <Button size="xs" variant="outline" onClick={reset}>
              Retry
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default FileUploadComponent;
