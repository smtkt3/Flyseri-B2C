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
import { useBackStepState } from '../useBackStepState';
import { SeriRichText } from './SeriRichText';

const suggestions = ['Where shall we go?', 'Plan a relaxing beach getaway', 'Help me plan a Japan trip', 'Plan a weekend trip from Dhaka'];

export function HomeSeriSearch() {
  const location = useLocation();
  const search = useHomeSearchDraft();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardViewport, setKeyboardViewport] = useState<{ top: number; height: number } | null>(null);
  const [labelDismissed, setLabelDismissed] = useState(() => { try { return sessionStorage.getItem('flyseri.chat-label-dismissed') === '1'; } catch { return false; } });
  const [launcherObstructed, setLauncherObstructed] = useState(false);
  const [editingElsewhere, setEditingElsewhere] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [floating, setFloating] = useBackStepState('seri-chat', false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const floatingPanel = useRef<HTMLDivElement>(null);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
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
    const resize = () => {
      const open = !!viewport && window.innerHeight - viewport.height > 120;
      setKeyboardOpen(open);
      setKeyboardViewport(open && window.innerWidth <= 767 ? { top: viewport!.offsetTop || 0, height: viewport!.height } : null);
    };
    resize(); viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); };
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const active = document.activeElement;
      setEditingElsewhere(!!active?.matches('input,textarea,select,[contenteditable="true"]') && !floatingPanel.current?.contains(active));
      if (floating || !launcher.current) { setLauncherObstructed(false); return; }
      // Measure a constant invitation footprint so compacting cannot cause oscillation.
      const rect = launcher.current.getBoundingClientRect();
      const left = rect.right - (window.innerWidth <= 767 ? 214 : 230);
      const controls = document.querySelectorAll<HTMLElement>('main input,main select,main textarea,main button,main [role="combobox"]');
      setLauncherObstructed(Array.from(controls).some(control => {
        if (control.closest('.premium-seri-chat')) return false;
        const box = control.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.left < rect.right && box.right > left && box.top < rect.bottom && box.bottom > rect.top;
      }));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    document.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule); document.addEventListener('focusout', schedule);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); document.removeEventListener('focusin', schedule); document.removeEventListener('focusout', schedule); };
  }, [floating, location.key]);
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
  function closeFloating() {
    if (closing) return;
    const finish = () => { setFloating(false); setClosing(false); launcher.current?.focus({ preventScroll: true }); };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(finish, 180);
  }
  useEffect(() => {
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    if (!floating) return;
    if (window.innerWidth > 767) chatInput.current?.focus({ preventScroll: true });
    else floatingPanel.current?.focus({ preventScroll: true });
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
    if (location.state?.resumeSeri === true && !floating) setFloating(true);
    try {
      const saved = JSON.parse(sessionStorage.getItem(chatKey) ?? 'null');
      if (saved && typeof saved.savedAt === 'number' && saved.savedAt <= Date.now() && Date.now() - saved.savedAt < 2 * 60 * 60 * 1000 && Array.isArray(saved.messages)) {
        restored = saved.messages.filter((item: SeriMessage) => item && typeof item.id === 'string' && ['USER', 'ASSISTANT'].includes(item.role) && typeof item.content === 'string').slice(-20);
        conversation.current = typeof saved.conversation === 'string' ? saved.conversation : null;
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
    if (!text || busy.current || !online) return;
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
    <div className="premium-seri-entry-heading"><span className="premium-seri-entry-icon" aria-hidden="true">✦</span><div><h2 id="home-seri-title">{floating ? 'Seri' : 'Plan your journey with Seri'}</h2>{floating && <p>Your AI travel assistant</p>}</div>{floating && <button type="button" className="seri-floating-close" aria-label="Close Seri chat" onClick={closeFloating}>×</button>}</div>
    {floating && <div className="seri-chat-team"><span>Need help from our team?</span><Link to="/app/support">Contact team <span aria-hidden="true">↗</span></Link></div>}
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
      {!online && <p className="home-seri-error" role="status">You’re offline. Your draft is saved—reconnect to send it.</p>}
      {sending && <p className="home-seri-status" role="status">✦ Seri is preparing your reply…</p>}
      {error && <div className="home-seri-error" role="alert"><p>{error}</p><button type="button" disabled={sending || !online || !question.trim()} onClick={() => void send()}>Try again</button></div>}
    </div>
    {!session && <p className="home-seri-sign-in"><Link to="/sign-in">Sign in for your saved trips</Link></p>}
    <form onSubmit={event => { void send(event); }}><label className="sr-only" htmlFor="home-seri-question">Ask Seri a travel question</label><input ref={chatInput} id="home-seri-question" value={question} maxLength={4000} onChange={event => setQuestion(event.target.value)} placeholder={suggestions[suggestion]} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} disabled={sending} /><button type="submit" disabled={sending || !online || !question.trim()}>{sending ? 'Sending…' : 'Ask Seri'} <span aria-hidden="true">↗</span></button></form>
  </section>;
  return <>{floating ? <div className="seri-inline-placeholder" style={{ minHeight: inlineHeight }}><span aria-hidden="true">✦</span><div><strong>Your conversation with Seri is open</strong></div><button type="button" onClick={closeFloating}>Continue here ↗</button></div> : chat}{createPortal(<>
    {floating && <div ref={floatingPanel} style={keyboardViewport ? { top: keyboardViewport.top + 12, bottom: 'auto', height: Math.max(180, keyboardViewport.height - 24) } : undefined} className={`seri-floating-panel${closing ? ' is-closing' : ''}`} id="seri-floating-chat" role="dialog" aria-labelledby="home-seri-title" tabIndex={-1}>{chat}</div>}
    {!floating && !labelDismissed && !launcherObstructed && !editingElsewhere && !keyboardOpen && <button type="button" className="seri-label-dismiss" aria-label="Hide chat invitation" onClick={() => { setLabelDismissed(true); try { sessionStorage.setItem('flyseri.chat-label-dismissed', '1'); } catch {} launcher.current?.focus({ preventScroll: true }); }}>×</button>}
    <button ref={launcher} type="button" hidden={keyboardOpen || (editingElsewhere && !floating)} disabled={closing} className={`seri-floating-launcher${floating ? ' is-open' : ''}${labelDismissed || launcherObstructed ? ' is-compact' : ''}`} aria-label={floating ? 'Minimize Seri chat' : 'Chat with us'} aria-expanded={floating} aria-controls={floating ? 'seri-floating-chat' : undefined} onClick={() => { if (floating) closeFloating(); else { setInlineHeight(chatSection.current?.getBoundingClientRect().height ?? 0); setFloating(true); } }}>
      {!floating && !labelDismissed && !launcherObstructed && <span className="seri-launcher-label"><strong>Chat with us</strong><small>AI & travel support</small></span>}
      <svg className="seri-launcher-aircraft" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <defs><linearGradient id="seri-aircraft-paint" x1="14" y1="6" x2="53" y2="57" gradientUnits="userSpaceOnUse"><stop stopColor="#2478ed"/><stop offset=".6" stopColor="#329ff2"/><stop offset="1" stopColor="#69d4d6"/></linearGradient></defs>
        <g transform="rotate(30 32 32)">
          <path d="M32 4c-3 0-4 3-4 7l-1 13L7 36c-2 1-2 2-2 4v3l22-7 1 13-7 5v4l11-3 11 3v-4l-7-5 1-13 22 7v-3c0-2 0-3-2-4L37 24l-1-13c0-4-1-7-4-7Z" fill="url(#seri-aircraft-paint)" stroke="white" strokeWidth="1.7" strokeLinejoin="round"/>
          <path d="M30 13q2-3 4 0l.5 6q-2.5-2-5 0l.5-6Z" fill="white" fillOpacity=".9"/>
          <path d="M32 25v23" stroke="white" strokeOpacity=".4" strokeWidth="1.2" strokeLinecap="round"/>
        </g>
      </svg>
    </button>
  </>, document.body)}</>;
}
