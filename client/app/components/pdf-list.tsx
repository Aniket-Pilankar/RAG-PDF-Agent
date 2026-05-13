'use client';

import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { FileText, Loader2, Trash2 } from 'lucide-react';
import * as React from 'react';

interface Pdf {
  id: string;
  filename: string;
  status: 'processing' | 'ready' | 'failed';
  uploadedAt: string;
}

interface PdfListProps {
  refreshKey: number;
  onSelectionChange: (selectedIds: string[]) => void;
}

const PdfListComponent: React.FC<PdfListProps> = ({ refreshKey, onSelectionChange }) => {
  const { getToken } = useAuth();
  const [pdfs, setPdfs] = React.useState<Pdf[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [deleting, setDeleting] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let cancelled = false;
    const fetchPdfs = async () => {
      const token = await getToken();
      const res = await fetch('http://localhost:8000/pdfs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      const data: Pdf[] = await res.json();
      if (cancelled) return;
      setPdfs(data);
      setSelected((prev) => {
        const readyIds = new Set(data.filter((p) => p.status === 'ready').map((p) => p.id));
        // Keep existing selections that are still valid; auto-select new ready PDFs
        const next = new Set<string>();
        readyIds.forEach((id) => {
          if (prev.has(id) || !prev.size) next.add(id);
          // new PDF — auto-select it
          else if (!prev.has(id)) next.add(id); 
        });
        return next;
      });
    };
    fetchPdfs();
    return () => { cancelled = true; };
  }, [refreshKey]);

  React.useEffect(() => {
    onSelectionChange(Array.from(selected));
  }, [selected]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deletePdf = async (pdf: Pdf) => {
    setDeleting((prev) => new Set(prev).add(pdf.id));
    try {
      const token = await getToken();
      const res = await fetch(`http://localhost:8000/pdfs/${pdf.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      setPdfs((prev) => prev.filter((p) => p.id !== pdf.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(pdf.id);
        return next;
      });
    } catch {
      // leave UI unchanged on error
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(pdf.id);
        return next;
      });
    }
  };

  if (pdfs.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        Uploaded PDFs
      </p>
      {pdfs.map((pdf) => {
        const isReady = pdf.status === 'ready';
        const isChecked = selected.has(pdf.id);
        const isDeleting = deleting.has(pdf.id);

        return (
          <div
            key={pdf.id}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50 group"
          >
            <input
              type="checkbox"
              checked={isChecked}
              disabled={!isReady}
              onChange={() => toggleSelect(pdf.id)}
              className="accent-primary shrink-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className={`flex-1 text-xs truncate ${isReady ? 'text-foreground' : 'text-muted-foreground'}`}
              title={pdf.filename}
            >
              {pdf.filename}
            </span>
            {pdf.status === 'processing' && (
              <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
            )}
            {isReady && (
              <Button
                size="xs"
                variant="ghost"
                className="opacity-0 group-hover:opacity-100 shrink-0 h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                disabled={isDeleting}
                onClick={() => deletePdf(pdf)}
              >
                {isDeleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PdfListComponent;
