import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { completeApplicationDocumentUpload, deleteApplicationDocument, getListApplicationDocumentsQueryKey, requestApplicationDocumentUpload, useListApplicationDocuments } from '@workspace/api-client-react';

type DocumentRow = { id: string; name: string; size: number; contentType: string; state?: 'pending' | 'ready'; createdAt?: string; uploadedAt: string | null };
export type PendingUpload = { file: File; documentId?: string; uploadUrl?: string; stage: 'reserve' | 'transfer' | 'complete' };
export type DocumentStatus = { id: string; busy: boolean; pending: boolean; ready: boolean };

const supported = ['application/pdf', 'image/png', 'image/jpeg'];
const isPending = (row: DocumentRow) => row.state === 'pending' || row.uploadedAt === null;

async function transfer(id: string, entry: PendingUpload): Promise<PendingUpload | null> {
  let reservation = entry;
  try {
    if (!reservation.documentId) {
      const result = await requestApplicationDocumentUpload(id, {
        name: entry.file.name, size: entry.file.size,
        contentType: entry.file.type as 'application/pdf' | 'image/png' | 'image/jpeg',
      });
      reservation = { ...entry, documentId: result.document.id, uploadUrl: result.uploadUrl, stage: 'transfer' };
    }
    if (reservation.stage !== 'complete') {
      if (!reservation.uploadUrl) throw new Error('Upload URL is unavailable');
      const response = await fetch(reservation.uploadUrl, { method: 'PUT', headers: { 'Content-Type': entry.file.type }, body: entry.file });
      if (!response.ok) throw new Error('File transfer failed');
      reservation = { ...reservation, stage: 'complete' };
    }
    await completeApplicationDocumentUpload(id, reservation.documentId!);
    return null;
  } catch {
    return reservation;
  }
}

export async function uploadApplicationFiles(id: string, files: File[]): Promise<PendingUpload[]> {
  const failed: PendingUpload[] = [];
  for (const file of files) {
    const result = await transfer(id, { file, stage: 'reserve' });
    if (result) failed.push(result);
  }
  return failed;
}

export function ApplicationDocuments({ id, editable = false, pending = [], onPendingChange, onStatusChange }: {
  id: string; editable?: boolean; pending?: PendingUpload[];
  onPendingChange?: (files: PendingUpload[]) => void;
  onStatusChange?: (status: DocumentStatus) => void;
}) {
  const queryClient = useQueryClient();
  const documents = useListApplicationDocuments(id, { query: { queryKey: getListApplicationDocumentsQueryKey(id) } });
  const rows: DocumentRow[] = documents.data || [];
  const reservations = rows.filter(isPending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<File[]>([]);
  const [localPending, setLocalPending] = useState<PendingUpload[]>(pending);
  const unresolved = localPending.filter(item => !item.documentId || !rows.some(row => row.id === item.documentId && !isPending(row)));
  useEffect(() => {
    if (documents.isLoading || documents.isError || !localPending.some(item => item.documentId && rows.some(row => row.id === item.documentId && !isPending(row)))) return;
    replacePending(localPending.filter(item => !item.documentId || !rows.some(row => row.id === item.documentId && !isPending(row))));
  }, [documents.data, documents.isLoading, documents.isError, localPending]);
  useEffect(() => { onStatusChange?.({ id, busy, pending: reservations.length > 0 || unresolved.length > 0, ready: !documents.isLoading && !documents.isError }); }, [id, busy, reservations.length, unresolved.length, documents.isLoading, documents.isError, onStatusChange]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListApplicationDocumentsQueryKey(id) });
  const replacePending = (next: PendingUpload[]) => { setLocalPending(next); onPendingChange?.(next); };
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const failed = await uploadApplicationFiles(id, files);
      replacePending([...localPending, ...failed]);
      setSelection([]);
      if (failed.length) setError(`Application saved; ${failed.length} file upload${failed.length === 1 ? '' : 's'} need attention. Retry the same reservation or cancel it before submitting.`);
      await refresh();
    } catch { setError('Could not refresh document list. Retry before submitting.'); }
    finally { setBusy(false); }
  };
  const retry = async (entry: PendingUpload) => {
    setBusy(true); setError('');
    const result = await transfer(id, entry);
    replacePending(localPending.filter(item => item !== entry).concat(result ? [result] : []));
    if (result) setError(`Could not finish ${entry.file.name}. Retry the same reservation, or cancel it.`);
    try { await refresh(); } catch { setError('Could not confirm document status. Retry loading the document list.'); }
    setBusy(false);
  };
  const cancel = async (documentId: string) => {
    if (!window.confirm('Discard this pending file reservation? You can select the file again afterward.')) return;
    setBusy(true); setError('');
    try {
      await deleteApplicationDocument(id, documentId);
      replacePending(localPending.filter(item => item.documentId !== documentId));
      await refresh();
    } catch (failure) {
      if (failure && typeof failure === 'object' && 'status' in failure && failure.status === 404 && !rows.some(row => row.id === documentId)) {
        replacePending(localPending.filter(item => item.documentId !== documentId));
        setError('The reservation already expired. Select the file again if it is still needed.');
      } else setError('Could not discard the pending reservation. Retry or reload the document list.');
    }
    finally { setBusy(false); }
  };
  return (
    <section className="document-controls" aria-label="Application documents" data-testid={`documents-${id}`}>
      <h3>Documents</h3>
      {documents.isLoading ? <div role="status" aria-label="Loading documents"><div className="staff-application-detail__skeleton" /><div className="staff-application-detail__skeleton" /></div>
        : documents.isError ? <p role="alert">Documents could not be confirmed.{editable ? ' Submission is paused.' : ' Preview and download are unavailable until verification succeeds.'} <button type="button" className="button-secondary" onClick={() => void documents.refetch()} data-testid={`button-retry-documents-${id}`}>Retry</button></p>
        : !rows.length ? <p className="staff-application-detail__muted">No documents have been uploaded.</p>
        : <ul className="document-list">{rows.map(doc => {
          const url = `/api/applications/${encodeURIComponent(id)}/documents/${encodeURIComponent(doc.id)}/content`;
          const pendingRecord = isPending(doc);
          return <li key={doc.id} data-testid={`document-${doc.id}`}>
            <span><strong>{doc.name}</strong> · {(doc.size / 1024).toFixed(1)} KB · {pendingRecord ? 'Pending upload' : `Uploaded ${new Date(doc.uploadedAt || doc.createdAt || '').toLocaleDateString()}`}</span>
            <span>{pendingRecord ? editable && <>
              <button type="button" className="button-secondary" disabled={busy} onClick={async () => {
                setBusy(true); setError('');
                try { await completeApplicationDocumentUpload(id, doc.id); replacePending(localPending.filter(item => item.documentId !== doc.id)); await refresh(); }
                catch { setError(`Could not finalize ${doc.name}. If the bytes were not transferred, retry with the selected file or discard this reservation.`); }
                finally { setBusy(false); }
              }} data-testid={`button-finalize-document-${doc.id}`}>Finalize pending</button>
              <button type="button" className="button-danger" disabled={busy} onClick={() => void cancel(doc.id)} data-testid={`button-cancel-document-${doc.id}`}>Discard pending</button>
            </> : <>
              <a href={url} target="_blank" rel="noopener noreferrer" data-testid={`link-preview-document-${doc.id}`}>Preview</a>
              <a href={`${url}?download=1`} data-testid={`link-download-document-${doc.id}`}>Download</a>
              {editable && <button type="button" className="button-danger" disabled={busy} onClick={async () => {
                if (!window.confirm(`Remove ${doc.name}? This cannot be undone.`)) return;
                setBusy(true); setError('');
                try { await deleteApplicationDocument(id, doc.id); await refresh(); }
                catch { setError(`Could not remove ${doc.name}. Please try again.`); }
                finally { setBusy(false); }
              }} data-testid={`button-delete-document-${doc.id}`}>Remove</button>}
            </>}</span>
          </li>;
        })}</ul>}
      {editable && <div>
        {unresolved.map((entry, index) => <div key={`${entry.documentId || entry.file.name}-${index}`} className="document-warning" data-testid={`pending-file-${index}`}>
          {entry.file.name} · {entry.stage === 'reserve' ? 'Reservation failed' : entry.stage === 'complete' ? 'Transfer completed; confirmation pending' : 'Transfer incomplete'}
          <button className="button-secondary" type="button" disabled={busy} onClick={() => void retry(entry)} data-testid={`button-retry-file-${index}`}>Retry same upload</button>
          {entry.documentId && <button className="button-danger" type="button" disabled={busy} onClick={() => void cancel(entry.documentId!)} data-testid={`button-discard-file-${index}`}>Discard reservation</button>}
          {!entry.documentId && <button className="button-tertiary" type="button" disabled={busy} onClick={() => replacePending(localPending.filter(item => item !== entry))} data-testid={`button-remove-failed-file-${index}`}>Remove file</button>}
        </div>)}
        {reservations.length > 0 && <p className="document-warning" role="status">Pending reservations block submission. Finalize or discard each one. If the upload URL has expired, discard and select the file again.</p>}
        <label htmlFor={`add-documents-${id}`}>Add PDF, PNG or JPG files to this saved draft</label>
        <input id={`add-documents-${id}`} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" data-testid={`input-add-documents-${id}`} onChange={event => {
          const files = Array.from(event.target.files || []);
          setError(files.some(file => !supported.includes(file.type) || !file.size || file.size > 10_485_760) ? 'Choose PDF, PNG or JPG files between 1 byte and 10 MB.' : '');
          setSelection(files.every(file => supported.includes(file.type) && file.size > 0 && file.size <= 10_485_760) ? files : []);
          event.target.value = '';
        }} />
        <button className="button-secondary" type="button" disabled={busy || !selection.length || reservations.length > 0 || unresolved.length > 0 || documents.isLoading || documents.isError} onClick={() => void upload(selection)} data-testid={`button-upload-documents-${id}`}>{busy ? 'Uploading…' : 'Upload selected files'}</button>
      </div>}
      {error && <p className="document-warning" role="alert" data-testid={`error-documents-${id}`}>{error}</p>}
    </section>
  );
}