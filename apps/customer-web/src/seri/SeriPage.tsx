import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { SeriConversationSummary, SeriMessage } from '@flyseri/types';
import { ApiClientError } from '../lib/api/client';
import { seriService } from '../services/seriService';
import { tripService } from '../services/tripService';
import { displayDate, displayTripTitle } from '../trip/tripPresentation';
import { SeriMessageDetails } from './SeriMessageDetails';
import './seri.css';
import './seri-confirmation.css';

export function SeriPage() {
  const { tripId } = useParams<{ tripId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<SeriConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SeriMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [tripTitle, setTripTitle] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supplied = searchParams.get('draft');
    if (!supplied) return;
    setDraft(supplied.slice(0, 4000));
    const next = new URLSearchParams(searchParams);
    next.delete('draft');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!tripId) { setTripTitle(null); return; }
    let active = true;
    void tripService.detail(tripId).then((trip) => { if (active) setTripTitle(displayTripTitle(trip)); }, () => { if (active) setTripTitle(null); });
    return () => { active = false; };
  }, [tripId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await seriService.conversations();
        if (!active) return;
        setConversations(rows);
        const requestedId = searchParams.get('conversation');
        const selected = requestedId ? rows.find((item) => item.id === requestedId && item.tripId === (tripId ?? null))
          : rows.find((item) => item.tripId === (tripId ?? null));
        if (requestedId && !selected) { setConversationId(null); setError('This conversation was not found in this travel space.'); return; }
        if (selected) { setConversationId(selected.id); setSearchParams({ conversation: selected.id }, { replace: true }); }
        else {
          const created = await seriService.createConversation(tripId);
          if (!active) return;
          setConversations([created, ...rows]); setConversationId(created.id); setSearchParams({ conversation: created.id }, { replace: true });
        }
      } catch { if (active) setError("We couldn't open Seri right now. Please try again."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [tripId, attempt]);

  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    setMessages([]); setError('');
    void seriService.messages(conversationId).then((rows) => { if (active) setMessages(rows); }, () => { if (active) setError("We couldn't load this conversation. Please try again."); });
    return () => { active = false; };
  }, [conversationId]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

  async function newConversation() {
    setError(''); setLoading(true);
    try { const row = await seriService.createConversation(tripId); setConversations((current) => [row, ...current]); setConversationId(row.id); setSearchParams({ conversation: row.id }); }
    catch { setError("We couldn't start a new conversation. Please try again."); }
    finally { setLoading(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!conversationId || !draft.trim() || sending) return;
    const text = draft.trim(); setDraft(''); setSending(true); setError('');
    const optimistic: SeriMessage = { id: `local-${Date.now()}`, role: 'USER', content: text, messageType: 'TEXT', payload: null, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    try {
      const result = await seriService.send(conversationId, text);
      setMessages((current) => [...current.filter((item) => item.id !== optimistic.id), optimistic, result.message]);
      setConversations((current) => [result.conversation, ...current.filter((item) => item.id !== result.conversation.id)]);
    } catch (cause) { setMessages((current) => current.filter((item) => item.id !== optimistic.id)); setDraft(text); setError(cause instanceof ApiClientError && (cause.status === 429 || cause.code === 'RATE_LIMITED')
      ? 'You have sent several messages in a short time. Please wait a minute and try again.'
      : cause instanceof ApiClientError && cause.code === 'DEPENDENCY_UNAVAILABLE'
        ? 'Seri is unavailable right now. Please try again later.'
        : "Seri couldn't send that just now. Your trips and bookings are still safe."); }
    finally { setSending(false); }
  }
  async function resolveAction(actionId: string, confirm: boolean) {
    if (!conversationId || actionBusy) return;
    setActionBusy(actionId); setError('');
    try {
      const message = confirm ? await seriService.confirm(conversationId, actionId) : await seriService.cancel(conversationId, actionId);
      setMessages((current) => [...current.map((item) => item.payload?.actionId === actionId ? { ...item, payload: { ...item.payload, status: confirm ? 'EXECUTED' : 'CANCELLED' } } : item), message]);
    } catch { setError(confirm ? "We couldn't send your support request. Please try again." : "We couldn't cancel that request. Please try again."); }
    finally { setActionBusy(null); }
  }

  return <main className="seri-page account-page">
    <header className="seri-heading"><div><p className="account-eyebrow">YOUR TRAVEL COMPANION</p><h1>Ask Seri</h1><p>Plan your next journey and get clear answers from your Flyseri account.</p></div><button className="account-outline-button" onClick={() => { void newConversation(); }} disabled={loading}>＋ New chat</button></header>
    {tripId && <div className="seri-trip-context"><span>✦</span><div><strong>{tripTitle ? `Seri is helping with ${tripTitle}` : 'Trip workspace conversation'}</strong><small>Seri will use this trip's context when you ask about it.</small></div><Link to={`/app/trips/${tripId}`}>Back to trip →</Link></div>}
    <section className="seri-chat-panel" aria-label="Seri chat">
      {conversations.filter((item) => item.tripId === (tripId ?? null)).length > 1 && <label className="seri-conversation-select">Conversation <select value={conversationId ?? ''} onChange={(event) => { setConversationId(event.target.value); setSearchParams({ conversation: event.target.value }); }}>{conversations.filter((item) => item.tripId === (tripId ?? null)).map((item) => <option key={item.id} value={item.id}>{item.tripId ? `Trip chat · ${item.lastMessageAt.slice(0, 10)}` : `Chat · ${item.lastMessageAt.slice(0, 10)}`}</option>)}</select></label>}
      {loading ? <div className="seri-loading" role="status"><span /><span /><span />Opening your conversation…</div> : <div className="seri-messages">
        {!messages.length && <div className="seri-welcome"><span className="seri-avatar">S</span><h2>Where would you like to go?</h2><p>Ask about your trip, visa checklist, documents, order, or payment. I can also help you shape a new travel plan.</p><div>{['Show my next trip', 'What documents am I missing?', 'Help me plan a relaxed Japan trip'].map((suggestion) => <button key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div></div>}
        {messages.map((message) => <article key={message.id} className={`seri-message seri-${message.role.toLowerCase()}`}><div className="seri-message-bubble"><p>{message.content}</p>{<SeriMessageDetails message={message} />}{message.messageType === 'CONFIRMATION' && typeof message.payload?.actionId === 'string' && <div className="seri-confirm-card"><strong>{String(message.payload.summary)}</strong><small>This sends a request to the support team; it does not share this conversation.</small>{message.payload.status === 'PENDING' ? <div><button disabled={actionBusy === message.payload.actionId} onClick={() => { void resolveAction(String(message.payload?.actionId), true); }}>Yes, contact support</button><button disabled={actionBusy === message.payload.actionId} onClick={() => { void resolveAction(String(message.payload?.actionId), false); }}>Not now</button></div> : <small>{message.payload.status === 'EXECUTED' ? 'Request sent' : 'Request cancelled'}</small>}</div>}</div><small>{message.role === 'ASSISTANT' ? 'Seri' : 'You'}</small></article>)}
        {sending && <div className="seri-message seri-assistant"><div className="seri-message-bubble seri-typing" role="status">Seri is checking that for you…</div></div>}
        <div ref={endRef} />
      </div>}
      {error && <p className="seri-error" role="alert">{error} {!conversationId && <button type="button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Retry</button>}</p>}
      <form className="seri-composer" onSubmit={(event) => { void send(event); }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={2} placeholder="Tell Seri what you’re planning…" aria-label="Message Seri" disabled={loading || sending || !conversationId} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (draft.trim()) void send(event as unknown as FormEvent); } }} /><button className="btn-primary" disabled={!draft.trim() || sending || loading || !conversationId} aria-label="Send message">{sending ? 'Sending…' : 'Send'} <span>→</span></button><small>Your account and travel records stay protected. Seri only checks information needed for your question.</small></form>
    </section>
  </main>;
}
