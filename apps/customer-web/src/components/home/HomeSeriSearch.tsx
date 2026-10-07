import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SeriMessage } from '@flyseri/types';
import { useAuth } from '../../auth/AuthProvider';
import { seriService } from '../../services/seriService';
import { SeriMessageDetails } from '../../seri/SeriMessageDetails';
import { ApiClientError } from '../../lib/api/client';

export function HomeSeriSearch() {
  const { session } = useAuth();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<SeriMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const conversation = useRef<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    generation.current += 1;
    conversation.current = null;
    busy.current = false;
    setMessages([]); setSending(false); setError('');
    return () => { generation.current += 1; };
  }, [session?.user.id]);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, sending, error]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy.current || !session) return;
    const requestGeneration = generation.current;
    busy.current = true;
    setSending(true); setError(''); setQuestion('');
    const optimistic: SeriMessage = { id: `local-${Date.now()}`, role: 'USER', content: text, messageType: 'TEXT', payload: null, createdAt: new Date().toISOString() };
    setMessages(items => [...items, optimistic]);
    try {
      const id = conversation.current ?? (await seriService.createConversation()).id;
      if (generation.current !== requestGeneration) return;
      conversation.current = id;
      const result = await seriService.send(id, text);
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

  return <section className="premium-seri-entry premium-seri-chat" aria-labelledby="home-seri-title">
    <div className="premium-seri-entry-heading"><span className="premium-seri-entry-icon" aria-hidden="true">✦</span><div><h2 id="home-seri-title">Plan your journey with Seri</h2><p>Your AI travel assistant · Replies appear right here.</p></div></div>
    <div className="home-seri-transcript" ref={transcript} role="log" aria-label="Seri search conversation" aria-live="polite" aria-relevant="additions text" aria-busy={sending} tabIndex={0}>
      {!messages.length && <div className="home-seri-welcome"><span aria-hidden="true">✦</span><strong>Where shall we go?</strong><p>Tell Seri your destination, dates or travel ideas.</p><div>{['A relaxing beach getaway', 'Help me plan a Japan trip'].map(text => <button type="button" key={text} onClick={() => setQuestion(text)}>{text} ↗</button>)}</div></div>}
      {messages.map(message => <article key={message.id} className={`home-seri-message is-${message.role.toLowerCase()}`}><small>{message.role === 'USER' ? 'You' : 'Seri'}</small><p>{message.content}</p><SeriMessageDetails message={message} />{message.messageType === 'CONFIRMATION' && conversation.current && <Link to={`/app/seri?conversation=${encodeURIComponent(conversation.current)}`}>Review this request →</Link>}</article>)}
      {sending && <p className="home-seri-status" role="status">✦ Seri is checking that for you…</p>}
      {error && <p className="home-seri-error" role="alert">{error}</p>}
    </div>
    {!session && <p className="home-seri-sign-in"><Link to="/sign-in">Sign in to chat with Seri →</Link></p>}
    <form onSubmit={event => { void send(event); }}><label className="sr-only" htmlFor="home-seri-question">Ask Seri a travel question</label><input id="home-seri-question" value={question} maxLength={4000} onChange={event => setQuestion(event.target.value)} placeholder="Where shall we go?" disabled={sending} /><button type="submit" disabled={!session || sending || !question.trim()}>{sending ? 'Sending…' : 'Ask Seri'} <span aria-hidden="true">↗</span></button></form>
  </section>;
}
