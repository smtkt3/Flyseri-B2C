import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import type { SeriMessage } from '@flyseri/types';
import { useAuth } from '../../auth/AuthProvider';
import { seriService } from '../../services/seriService';
import { SeriMessageDetails } from '../../seri/SeriMessageDetails';
import { ApiClientError } from '../../lib/api/client';
import { preferredCurrency } from '../LocaleMenu';
import './seri-floating-chat.css';
import './home-search-improvements.css';
import './seri-welcome.css';
import { useHomeSearchDraft } from './homeSearchDraft';
import { SeriRichText } from './SeriRichText';

const suggestions = ['Where shall we go?', 'Plan a relaxing beach getaway', 'Help me plan a Japan trip', 'Plan a weekend trip from Dhaka'];

export function HomeSeriSearch() {
  const location = useLocation();
  const search = useHomeSearchDraft();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [launcherBottom, setLauncherBottom] = useState(24);
  const [floating, setFloating] = useState(false);
  const [inlineHeight, setInlineHeight] = useState(0);
  const launcher = useRef<HTMLButtonElement>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  const chatSection = useRef<HTMLElement>(null);
  const { session } = useAuth();
  const [question, setQuestion] = useState('');
  const skipDraftSave = useRef(true);
  const draftKey = 'flyseri.ai-question.' + (session?.user.id ?? 'guest');
  useEffect(() => { skipDraftSave.current = true; try { setQuestion(sessionStorage.getItem(draftKey) ?? ''); } catch { setQuestion(''); } }, [draftKey]);
  useEffect(() => { if (skipDraftSave.current) { skipDraftSave.current = false; return; } try { if (question) sessionStorage.setItem(draftKey, question); else sessionStorage.removeItem(draftKey); } catch {} }, [question, draftKey]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => setKeyboardOpen(!!viewport && window.innerHeight - viewport.height > 120);
    resize(); viewport?.addEventListener('resize', resize);
    return () => viewport?.removeEventListener('resize', resize);
  }, []);
  const [suggestion, setSuggestion] = useState(0);
  const [focused, setFocused] = useState(false);
  const [messages, setMessages] = useState<SeriMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const conversation = useRef<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const skipChatSave = useRef(true);
  const chatKey = draftKey + '.chat';
  const transcript = useRef<HTMLDivElement>(null);
  function revealLatest() {
    const log = transcript.current;
    if (!log) return;
    const last = log.querySelector<HTMLElement>('.home-seri-message:last-of-type');
    if (!last) { log.scrollTop = 0; return; }
    if (last?.querySelector('.seri-flights')) log.scrollTop += last.getBoundingClientRect().top - log.getBoundingClientRect().top - 8;
    else log.scrollTop = log.scrollHeight;
  }
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (floating || window.innerWidth > 1366) { setLauncherBottom(window.innerWidth <= 600 ? 14 : 24); return; }
      const rect = launcher.current?.getBoundingClientRect();
      if (!rect) return;
      const controls = [...document.querySelectorAll<HTMLElement>('a,button,input,select,[role="button"]')].filter(element => element !== launcher.current && !element.closest('.seri-floating-panel'));
      let bottom = 14;
      for (let pass = 0; pass < 4; pass++) {
        const y = window.innerHeight - bottom;
        const collision = controls.map(element => element.getBoundingClientRect()).find(box => box.width > 0 && box.height > 0 && box.left < rect.right && box.right > rect.left && box.top < y && box.bottom > y - rect.height);
        if (!collision) break;
        bottom = Math.max(bottom, window.innerHeight - collision.top + 10);
      }
      setLauncherBottom(Math.min(bottom, Math.max(14, window.innerHeight - rect.height - 80)));
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(measure); };
    queue(); window.addEventListener('scroll', queue, { passive: true }); window.addEventListener('resize', queue);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', queue); window.removeEventListener('resize', queue); };
  }, [floating, messages]);
  function closeFloating() {
    setFloating(false);
    launcher.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!floating) return;
    chatInput.current?.focus({ preventScroll: true });
    revealLatest();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeFloating(); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [floating]);
  useEffect(() => {
    if (focused || question || sending) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let timer: number | undefined;
    const update = () => {
      window.clearInterval(timer);
      if (document.hidden || motion?.matches) return;
      timer = window.setInterval(() => setSuggestion(index => (index + 1) % suggestions.length), 4500);
    };
    update();
    document.addEventListener('visibilitychange', update);
    motion?.addEventListener('change', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      motion?.removeEventListener('change', update);
    };
  }, [focused, question, sending]);
  useEffect(() => {
    generation.current += 1;
    conversation.current = null;
    busy.current = false;
    skipChatSave.current = true;
    let restored: SeriMessage[] = [];
    setFloating(location.state?.resumeSeri === true);
    try {
      const saved = JSON.parse(sessionStorage.getItem(chatKey) ?? 'null');
      if (saved && typeof saved.savedAt === 'number' && saved.savedAt <= Date.now() && Date.now() - saved.savedAt < 2 * 60 * 60 * 1000 && Array.isArray(saved.messages)) {
        restored = saved.messages.filter((item: SeriMessage) => item && typeof item.id === 'string' && ['USER', 'ASSISTANT'].includes(item.role) && typeof item.content === 'string').slice(-20);
        conversation.current = typeof saved.conversation === 'string' ? saved.conversation : null;
        setFloating(location.state?.resumeSeri === true || saved.floating === true);
      }
    } catch {}
    setMessages(restored); setSending(false); setError('');
    return () => { generation.current += 1; };
  }, [chatKey]);
  useEffect(() => {
    if (skipChatSave.current) { skipChatSave.current = false; return; }
    const retained = messages.slice(-20);
    // Keep the latest complete result even when older searches fill the tab's quota.
    while (retained.length) {
      try { sessionStorage.setItem(chatKey, JSON.stringify({ savedAt: Date.now(), conversation: conversation.current, floating, messages: retained })); break; }
      catch (cause) { if (!(cause instanceof DOMException) || cause.name !== 'QuotaExceededError') break; retained.shift(); }
    }
  }, [messages, chatKey, floating]);
  useEffect(() => {
    revealLatest();
  }, [messages, sending, error]);

  async function send(event?: FormEvent, prompt?: string) {
    event?.preventDefault();
    const text = (prompt ?? question).trim();
    if (!text || busy.current) return;
    const hasContext = search.destination || search.departure || search.adults !== 1 || search.children || search.infants || search.origin !== 'DAC' || search.cabin !== 'ECONOMY' || search.returnDate;
    const requestText = hasContext ? text + '\n\nCurrent search (use only where relevant; user instructions take priority): ' + JSON.stringify(search) + '. Currency: ' + preferredCurrency() : text;
    const requestGeneration = generation.current;
    busy.current = true;
    setSending(true); setError(''); setQuestion('');
    const optimistic: SeriMessage = { id: `local-${Date.now()}`, role: 'USER', content: text, messageType: 'TEXT', payload: null, createdAt: new Date().toISOString() };
    setMessages(items => [...items, optimistic]);
    try {
      if (!session) {
        const history = messages.filter((item): item is SeriMessage & { role: 'USER' | 'ASSISTANT' } => item.role === 'USER' || item.role === 'ASSISTANT').slice(-12).map(({ role, content }) => ({ role, content }));
        const result = await seriService.guestSend(requestText, history, preferredCurrency());
        if (generation.current === requestGeneration) setMessages(items => [...items, result.message]);
        return;
      }
      const id = conversation.current ?? (await seriService.createConversation()).id;
      if (generation.current !== requestGeneration) return;
      conversation.current = id;
      const result = await seriService.send(id, requestText);
      if (generation.current !== requestGeneration) return;
      setMessages(items => [...items, result.message]);
    } catch (cause) {
      if (generation.current !== requestGeneration) return;
      setMessages(items => items.filter(item => item.id !== optimistic.id));
      setQuestion(text);
      setError(cause instanceof ApiClientError && cause.status === 429 ? 'Please wait a moment before sending another message.' : 'Seri could not reply just now. Your question is saved below—please try again.');
    } finally {
      if (generation.current === requestGeneration) { busy.current = false; setSending(false); }
    }
  }

  const chat = <section ref={chatSection} className="premium-seri-entry premium-seri-chat" aria-labelledby="home-seri-title">
    <div className="premium-seri-entry-heading"><span className="premium-seri-entry-icon" aria-hidden="true">✦</span><div><h2 id="home-seri-title">{floating ? 'Seri' : 'Plan your journey with Seri'}</h2></div>{floating && <button type="button" className="seri-floating-close" aria-label="Close Seri chat" onClick={closeFloating}>×</button>}</div>
    <div className={`home-seri-transcript${!messages.length && !sending && !error ? ' is-empty' : ''}`} ref={transcript} role="log" aria-label="Seri search conversation" aria-live="polite" aria-relevant="additions text" aria-busy={sending} tabIndex={0}>
      {!messages.length && <div className="home-seri-welcome seri-welcome-design">
        <div className="seri-welcome-orbit" aria-hidden="true"><div><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m27 5-8 23-5-10L4 13 27 5Z"/><path d="m14 18 7-7"/></svg></div><i/><i/></div>
        <strong>Where to next?</strong>
        <p>Find flights. Shape your next escape.</p>
        <div className="seri-welcome-prompts" aria-label="Start a conversation">{[
          { title: 'Find a flight', prompt: 'Help me find flights', path: 'm21 3-7 18-3-8-8-3 18-7Z M11 13l5-5' },
          { title: 'Plan a holiday', prompt: 'Help me plan a holiday', path: 'M4 7h16v14H4V7Z M9 7V4h6v3 M4 12h16 M9 12v3 M15 12v3' },
          { title: 'Inspire me', prompt: 'Suggest a destination for my next trip', path: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z' },
        ].map(item => <button type="button" key={item.title} onClick={() => { setQuestion(item.prompt); chatInput.current?.focus({ preventScroll: true }); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path}/></svg><span>{item.title}</span><span aria-hidden="true">↗</span></button>)}</div>
      </div>}
      {messages.map(message => <article key={message.id} className={`home-seri-message is-${message.role.toLowerCase()}`}><small>{message.role === 'USER' ? 'You' : 'Seri'}</small>{message.role === 'USER' ? <p>{message.content}</p> : <SeriRichText content={message.payload?.source === 'sabre' && Array.isArray(message.payload.offers) && message.payload.offers.length ? 'Here are your flight options.' : message.content} hideFlightLinks={message.messageType === 'FLIGHT_RESULTS'} onFlightSearch={(city, code) => { void send(undefined, `Show me flights to ${city} (${code})`); }} />}<SeriMessageDetails message={message} onFlightsUpdate={data => setMessages(items => items.map(item => item.id === message.id ? { ...item, payload: { ...data } } : item))} />{message.messageType === 'CONFIRMATION' && conversation.current && <Link to={`/app/seri?conversation=${encodeURIComponent(conversation.current)}`}>Review this request →</Link>}</article>)}
      {sending && <p className="home-seri-status" role="status">✦ Seri is checking that for you…</p>}
      {error && <p className="home-seri-error" role="alert">{error}</p>}
    </div>
    {!session && <p className="home-seri-sign-in"><Link to="/sign-in">Sign in for your saved trips</Link></p>}
    <form onSubmit={event => { void send(event); }}><label className="sr-only" htmlFor="home-seri-question">Ask Seri a travel question</label><input ref={chatInput} id="home-seri-question" value={question} maxLength={4000} onChange={event => setQuestion(event.target.value)} placeholder={suggestions[suggestion]} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} disabled={sending} /><button type="submit" disabled={sending || !question.trim()}>{sending ? 'Sending…' : 'Ask Seri'} <span aria-hidden="true">↗</span></button></form>
  </section>;
  return <>{floating ? <div className="seri-inline-placeholder" style={{ minHeight: inlineHeight }}><span aria-hidden="true">✦</span><div><strong>Your conversation with Seri is open</strong></div><button type="button" onClick={closeFloating}>Continue here ↗</button></div> : chat}{createPortal(<>
    {floating && <div className="seri-floating-panel" id="seri-floating-chat" role="dialog" aria-labelledby="home-seri-title">{chat}</div>}
    <button ref={launcher} type="button" style={{ bottom: `calc(${floating ? 14 : launcherBottom}px + env(safe-area-inset-bottom, 0px))` }} hidden={keyboardOpen && !floating} className={`seri-floating-launcher${floating ? ' is-open' : ''}`} aria-label={floating ? 'Minimize Seri chat' : 'Chat with Seri'} aria-expanded={floating} aria-controls={floating ? 'seri-floating-chat' : undefined} onClick={() => { if (floating) closeFloating(); else { setInlineHeight(chatSection.current?.getBoundingClientRect().height ?? 0); setFloating(true); } }}>
      <span className="seri-floating-tooltip">Ask Seri</span>
      {floating ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg> : <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M25 17a10 10 0 0 1-10 10c-1.7 0-3.4-.4-4.8-1.2L5 27l1.2-5.2A10 10 0 0 1 15 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="m24 3 1.8 4.2L30 9l-4.2 1.8L24 15l-1.8-4.2L18 9l4.2-1.8L24 3Z" fill="currentColor"/><circle cx="11" cy="17" r="1.2" fill="currentColor"/><circle cx="16" cy="17" r="1.2" fill="currentColor"/><circle cx="21" cy="17" r="1.2" fill="currentColor"/></svg>}
    </button>
  </>, document.body)}</>;
}
