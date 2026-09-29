import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { AlertTriangle, ArrowRight, BookOpen, ChevronRight, CircleHelp, ExternalLink, FileClock, FileText, Landmark, LockKeyhole, Menu, MessageSquareText, Plus, Search, Send, ShieldCheck, X } from 'lucide-react';
import {
  getListWorkspaceConversationsQueryKey,
  getListWorkspaceMessagesQueryKey,
  getListWorkspaceRecordsQueryKey,
  useCreateWorkspaceConversation,
  useListWorkspaceConversations,
  useListWorkspaceMessages,
  useListWorkspaceRecords,
  useSendWorkspaceMessage,
  type WorkspaceConversationMode,
  type WorkspaceRecord,
  type WorkspaceReply,
} from '@workspace/api-client-react';

const prompts = [
  { label: 'Opening a food business', question: 'What should I check before opening a food business in San José?' },
  { label: 'Changing a storefront', question: 'What permits might I need to change my storefront or signage?' },
  { label: 'Finding a starting point', question: 'Where do I start with permits for a new small business?' },
];

const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const safeSource = (url: string | null) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
};

function SyntheticBadge() {
  return <span className="ws-synthetic">Demo Data — Synthetic</span>;
}

function RecordCard({ record, compact = false }: { record: WorkspaceRecord; compact?: boolean }) {
  const url = safeSource(record.sourceUrl);
  return (
    <article className={`ws-record ${compact ? 'ws-record-compact' : ''}`} data-testid={`card-record-${record.id}`}>
      <div className="ws-record-top"><span>{record.category}</span><span className="ws-record-id">#{record.id}</span></div>
      <h4>{record.description}</h4>
      <div className="ws-record-tags"><span>{record.department}</span><span>{record.status}</span><span>{record.language}</span></div>
      {record.synthetic && <SyntheticBadge />}
      <div className="ws-record-foot"><span>Updated {dateLabel(record.updatedAt)}</span>{url ? <a href={url} target="_blank" rel="noopener noreferrer" data-testid={`link-record-source-${record.id}`}>View source <ExternalLink size={12} /></a> : <span>Source link unavailable</span>}</div>
    </article>
  );
}

export function AIWorkspace() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<WorkspaceConversationMode>('research');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [replies, setReplies] = useState<Record<string, WorkspaceReply>>({});
  const [referenceOpen, setReferenceOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initializedSelection = useRef(false);

  const recordParams = { mode, ...(recordSearch.trim() ? { search: recordSearch.trim() } : {}) };
  const records = useListWorkspaceRecords(recordParams);
  const conversations = useListWorkspaceConversations();
  const messages = useListWorkspaceMessages(selectedId || '', { query: { enabled: !!selectedId, queryKey: getListWorkspaceMessagesQueryKey(selectedId || '') } });
  const createConversation = useCreateWorkspaceConversation();
  const sendMessage = useSendWorkspaceMessage();

  useEffect(() => {
    if (!initializedSelection.current && conversations.data) {
      initializedSelection.current = true;
      if (conversations.data.length) setSelectedId(conversations.data[0].id);
    }
  }, [conversations.data]);
  useEffect(() => {
    if (selectedId) {
      const found = conversations.data?.find(item => item.id === selectedId);
      if (found) setMode(found.mode);
    }
  }, [selectedId, conversations.data]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.data?.length, pendingText]);

  const invalidate = async (id?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListWorkspaceConversationsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListWorkspaceMessagesQueryKey(id || selectedId || '') }),
      queryClient.invalidateQueries({ queryKey: getListWorkspaceRecordsQueryKey() }),
    ]);
  };

  const startConversation = async (nextMode: WorkspaceConversationMode) => {
    setNotice('');
    try {
      const created = await createConversation.mutateAsync({ data: { mode: nextMode } });
      setSelectedId(created.id);
      setMode(nextMode);
      setDraft('');
      setMenuOpen(false);
      await invalidate(created.id);
      return created.id;
    } catch {
      setNotice('A new conversation could not be started. Check your connection and try again.');
      return null;
    }
  };

  const submit = async (text = draft) => {
    const content = text.trim();
    if (content.length < 3 || content.length > 2000 || sendMessage.isPending || createConversation.isPending) return;
    setNotice('');
    let id = selectedId;
    if (!id) id = await startConversation(mode);
    if (!id) return;
    setPendingText(content);
    setDraft('');
    try {
      const reply = await sendMessage.mutateAsync({ id, data: { content } });
      setReplies(previous => ({ ...previous, [reply.message.id]: reply }));
      await invalidate(id);
    } catch {
      setDraft(content);
      setNotice('Your question was not sent. Nothing was lost; please try again.');
    } finally {
      setPendingText('');
    }
  };

  const activeConversation = conversations.data?.find(item => item.id === selectedId);
  return (
    <div className="ws-shell">
      <aside className={`ws-sidebar ${menuOpen ? 'ws-sidebar-open' : ''}`}>
        <div className="ws-brand">
          <div className="ws-brand-icon"><Landmark size={21} strokeWidth={1.8} /></div>
          <div><strong>Permit Navigator</strong><span>SAN JOSÉ · AI WORKSPACE</span></div>
          <button className="ws-mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation"><X size={18}/></button>
        </div>
        <div className="ws-side-content">
          <div className="ws-nav-label">WORKSPACE</div>
          <button className="ws-new" onClick={() => void startConversation(mode)} disabled={createConversation.isPending} data-testid="button-new-conversation"><Plus size={17}/>{createConversation.isPending ? 'Starting…' : 'New conversation'}<span>↗</span></button>
          <div className="ws-nav-label ws-mode-label">CHOOSE YOUR MODE</div>
          <button className={`ws-mode ${mode === 'research' ? 'active' : ''}`} onClick={() => { setMode('research'); setSelectedId(null); setMenuOpen(false); }} data-testid="button-mode-research">
            <BookOpen size={17}/><span><strong>Research</strong><small>Explore guidance & records</small></span>{mode === 'research' && <span className="ws-active-dot"/>}
          </button>
          <button className={`ws-mode ${mode === 'live' ? 'active' : ''}`} onClick={() => { setMode('live'); setSelectedId(null); setMenuOpen(false); }} data-testid="button-mode-live">
            <FileClock size={17}/><span><strong>Live inquiry</strong><small>Ask about current context</small></span>{mode === 'live' && <span className="ws-active-dot"/>}
          </button>
          <p className="ws-mode-note">Live inquiry is a conversation mode, not real-time web browsing or a live City system connection.</p>
          <div className="ws-history-heading"><span className="ws-nav-label">RECENT CONVERSATIONS</span><span>{conversations.data?.length ?? '—'}</span></div>
          <div className="ws-history">
            {conversations.isLoading && <div className="ws-history-skeleton"><i/><i/><i/></div>}
            {conversations.isError && <div className="ws-side-error">History unavailable. <button onClick={() => void conversations.refetch()} data-testid="button-retry-history">Retry</button></div>}
            {!conversations.isLoading && !conversations.isError && !conversations.data?.length && <p className="ws-side-empty">Your questions will be saved here.</p>}
            {conversations.data?.map(item => <button key={item.id} className={`ws-history-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); setMode(item.mode); setMenuOpen(false); setNotice(''); }} data-testid={`button-conversation-${item.id}`}><MessageSquareText size={15}/><span><strong>{item.title || 'Untitled conversation'}</strong><small>{dateLabel(item.updatedAt)} · {item.mode}</small></span></button>)}
          </div>
        </div>
        <div className="ws-side-footer"><Link href="/portal" onClick={() => setMenuOpen(false)} data-testid="link-permit-portal"><FileText size={17}/><span>Permit portal</span><ArrowRight size={15}/></Link><span>Prototype guidance · Not official City advice</span></div>
      </aside>

      <div className="ws-main">
        <header className="ws-header">
          <div className="ws-header-left"><button className="ws-menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={20}/></button><span className="ws-breadcrumb">PERMIT NAVIGATOR</span><ChevronRight size={13}/><strong>AI Workspace</strong></div>
          <div className="ws-header-right"><span className="ws-prototype"><span/> PROTOTYPE ENVIRONMENT</span><Link href="/portal" className="ws-header-portal" data-testid="link-header-portal">Open permit portal <ArrowRight size={15}/></Link></div>
        </header>
        <div className="ws-governance"><ShieldCheck size={17}/><span><strong>Guidance, not a decision.</strong> Verify requirements with the appropriate City department before applying, starting work, or signing a lease.</span><Link href="/portal" data-testid="link-governance-portal">Go to permit portal <ArrowRight size={13}/></Link></div>

        <div className="ws-body">
          <main className="ws-conversation">
            <div className="ws-conversation-top"><div><span className="ws-overline">YOUR RESEARCH DESK <span className="ws-line"/></span><h1>{activeConversation ? activeConversation.title || 'Your conversation' : <>A clearer path <em>starts here.</em></>}</h1><p>{activeConversation ? `Conversation started ${dateLabel(activeConversation.createdAt)} · ${activeConversation.mode === 'live' ? 'Live inquiry' : 'Research'} mode` : 'Ask about permits, departments, and the steps between an idea and an open door in San José.'}</p></div><div className="ws-top-stamp"><span>SJ</span><small>CALIFORNIA<br/>37°20′ N</small></div></div>

            <div className="ws-trust-row"><div><LockKeyhole size={15}/><span>Simulated secure tool gateway</span></div><div><BookOpen size={15}/><span>Online source cache, not real-time browsing</span></div><div><ShieldCheck size={15}/><span>Human review for decisions</span></div></div>

            {notice && <div className="ws-alert" role="alert" data-testid="status-workspace-error"><AlertTriangle size={17}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss message" data-testid="button-dismiss-error"><X size={15}/></button></div>}
            {messages.isError && selectedId && <div className="ws-error-state" role="alert"><AlertTriangle size={24}/><h2>We couldn't open this conversation.</h2><p>Your history is still here. Try loading it again.</p><button onClick={() => void messages.refetch()} data-testid="button-retry-messages">Try again <ArrowRight size={15}/></button></div>}
            {messages.isLoading && selectedId && <div className="ws-message-skeleton"><div/><div/><div/></div>}
            {!selectedId && <div className="ws-intro"><div className="ws-intro-mark"><CircleHelp size={24} strokeWidth={1.6}/></div><h2>What are you trying to do?</h2><p>Tell us about the business you're opening or the space you're changing. We'll help you identify questions to ask and records worth checking.</p><div className="ws-prompt-list">{prompts.map((prompt, index) => <button key={prompt.label} onClick={() => void submit(prompt.question)} disabled={sendMessage.isPending || createConversation.isPending} data-testid={`button-prompt-${index}`}><span>0{index + 1}</span><strong>{prompt.label}</strong><ArrowRight size={17}/></button>)}</div></div>}
            {selectedId && !messages.isLoading && !messages.isError && !messages.data?.length && <div className="ws-intro ws-intro-small"><div className="ws-intro-mark"><MessageSquareText size={23}/></div><h2>A new conversation.</h2><p>Start with your business type, your location, and what you plan to change. Avoid sharing sensitive personal information.</p><div className="ws-prompt-list">{prompts.map((prompt, index) => <button key={prompt.label} onClick={() => void submit(prompt.question)} disabled={sendMessage.isPending} data-testid={`button-empty-prompt-${index}`}><span>0{index + 1}</span><strong>{prompt.label}</strong><ArrowRight size={17}/></button>)}</div></div>}
            {selectedId && !!messages.data?.length && <div className="ws-thread">{messages.data.map(message => {
              const reply = replies[message.id];
               return <div className={`ws-message ws-message-${message.role}`} key={message.id} data-testid={`message-${message.id}`}><div className="ws-avatar">{message.role === 'assistant' ? 'PN' : 'YOU'}</div><div className="ws-message-body"><div className="ws-message-meta"><strong>{message.role === 'assistant' ? 'Permit Navigator' : 'You'}</strong><span>{timeLabel(message.createdAt)}</span></div><div className="ws-message-content">{message.content}</div>{reply && <div className="ws-reply-detail"><div className="ws-reply-security"><ShieldCheck size={14}/> Gateway status: {reply.securityStatus}</div>{reply.synthetic && <SyntheticBadge />}{reply.escalation && <div className="ws-escalation" data-testid={`status-escalation-${message.id}`}><AlertTriangle size={18}/><div><strong>Flagged in prototype queue — no email confirmed</strong><p>{reply.escalation}</p></div></div>}{reply.sources.length > 0 && <div className="ws-citations"><span>SOURCES REFERENCED · {reply.sources.length}</span>{reply.sources.map(source => <RecordCard key={source.id} record={source} compact />)}</div>}</div>}</div></div>;
            })}{pendingText && <><div className="ws-message ws-message-user"><div className="ws-avatar">YOU</div><div className="ws-message-body"><div className="ws-message-meta"><strong>You</strong><span>Sending</span></div><div className="ws-message-content">{pendingText}</div></div></div><div className="ws-message ws-message-assistant"><div className="ws-avatar">PN</div><div className="ws-message-body"><div className="ws-message-meta"><strong>Permit Navigator</strong><span>Researching</span></div><div className="ws-answer-skeleton"><i/><i/><i/></div></div></div></>}<div ref={bottomRef}/></div>}
            <div className="ws-composer-wrap"><form className="ws-composer" onSubmit={event => { event.preventDefault(); void submit(); }}><label htmlFor="ws-question">ASK THE WORKSPACE</label><textarea id="ws-question" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="Describe your business or ask about a permit…" maxLength={2000} rows={2} data-testid="input-workspace-question"/><div className="ws-composer-bottom"><span>Don't include sensitive personal information. Enter to send · Shift+Enter for a new line</span><button type="submit" disabled={draft.trim().length < 3 || sendMessage.isPending || createConversation.isPending} data-testid="button-send-workspace-message">{sendMessage.isPending ? 'Working…' : 'Ask question'}<Send size={15}/></button></div></form><p className="ws-composer-disclaimer">Responses may be incomplete. This prototype does not issue permits, make determinations, or connect to a live City staff network.</p></div>
          </main>

          <aside className={`ws-reference ${referenceOpen ? 'ws-reference-open' : ''}`}><div className="ws-reference-inner"><div className="ws-ref-title"><div><span className="ws-overline">REFERENCE DESK</span><h2>Evidence & context</h2></div><span className="ws-ref-count">{records.data?.length ?? '—'}</span></div><p className="ws-ref-lede">Inspect cached reference records before relying on an answer. A source link is not proof of current permit status.</p><div className="ws-reference-status"><span className="ws-status-dot"/><div><strong>Source cache</strong><small>Online source cache · no live browsing</small></div></div><label className="ws-search"><Search size={15}/><input value={recordSearch} onChange={event => setRecordSearch(event.target.value)} placeholder="Search reference records" maxLength={100} data-testid="input-search-records" aria-label="Search reference records"/></label><div className="ws-ref-list">{records.isLoading && <div className="ws-ref-skeleton"><i/><i/><i/></div>}{records.isError && <div className="ws-ref-error"><AlertTriangle size={20}/><strong>References unavailable</strong><p>We couldn't load the source cache. Answers should be independently verified.</p><button onClick={() => void records.refetch()} data-testid="button-retry-records">Retry records <ArrowRight size={14}/></button></div>}{!records.isLoading && !records.isError && !records.data?.length && <div className="ws-ref-empty"><BookOpen size={20}/><strong>No records found</strong><p>{recordSearch ? 'Try a different term, or clear your search.' : 'Reference records will appear here when available.'}</p>{recordSearch && <button onClick={() => setRecordSearch('')} data-testid="button-clear-record-search">Clear search</button>}</div>}{records.data?.map(record => <RecordCard key={record.id} record={record}/>)}</div><div className="ws-ref-foot"><LockKeyhole size={15}/><span>Execution boundary: simulated secure tool gateway. No direct access to City systems.</span></div></div></aside>
        </div>
        <button className="ws-reference-toggle" onClick={() => setReferenceOpen(!referenceOpen)} data-testid="button-toggle-references"><BookOpen size={16}/>{referenceOpen ? 'Hide references' : 'View references'}</button>
      </div>
    </div>
  );
}

export function PublicWorkspace() {
  const [search, setSearch] = useState('');
  const records = useListWorkspaceRecords(search.trim() ? { search: search.trim() } : undefined);
  return <div className="ws-public">
    <header className="ws-public-header"><div className="ws-public-brand"><Landmark size={19}/><span>Permit Navigator <small>SAN JOSÉ · PUBLIC REFERENCE</small></span></div><Link href="/welcome" data-testid="link-workspace-sign-in">Sign in to ask a question <ArrowRight size={15}/></Link></header>
    <div className="ws-public-content"><div className="ws-overline">OPEN REFERENCE DESK <span className="ws-line"/></div><h1>Start with the <em>source.</em></h1><p>Explore reference records while you plan. Sign in to research questions in your own workspace. This prototype does not make permit determinations.</p><div className="ws-trust-row"><div><BookOpen size={15}/>Online source cache, not real-time browsing</div><div><ShieldCheck size={15}/>Verify with the appropriate City department</div></div><div className="ws-public-tool"><div><strong>Reference records</strong><span>{records.data?.length ?? '—'} results</span></div><label className="ws-search"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder="Search records" aria-label="Search reference records" data-testid="input-public-record-search"/></label></div><div className="ws-public-records">{records.isLoading && <div className="ws-ref-skeleton"><i/><i/><i/></div>}{records.isError && <div className="ws-ref-error"><AlertTriangle size={20}/><strong>References unavailable</strong><p>We couldn't load the source cache. Please try again.</p><button onClick={() => void records.refetch()} data-testid="button-retry-public-records">Retry records <ArrowRight size={14}/></button></div>}{!records.isLoading && !records.isError && !records.data?.length && <div className="ws-ref-empty"><BookOpen size={20}/><strong>No records found</strong><p>{search ? 'Try a different search term.' : 'No public reference records are currently available.'}</p>{search && <button onClick={() => setSearch('')} data-testid="button-clear-public-search">Clear search</button>}</div>}{records.data?.map(record => <RecordCard key={record.id} record={record}/>)}</div><div className="ws-public-bottom"><LockKeyhole size={15}/> Conversations require sign-in. Answers use a simulated secure tool gateway, not a live City system connection.</div></div>
  </div>;
}