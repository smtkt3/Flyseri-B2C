import { useEffect, useState, type FormEvent } from 'react';
import type { TravellerProfile, TravellerRelationship } from '@flyseri/types';
import { customerService } from '../services/customerService';
import { travellerService, type TravellerForm } from '../services/travellerService';
import { Link, useLocation } from 'react-router-dom';

const relationships: TravellerRelationship[] = ['SELF', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'RELATIVE', 'FRIEND', 'OTHER'];
const emptyForm: TravellerForm = { legalFirstName: '', legalLastName: '', legalMiddleName: null, dateOfBirth: null, gender: null, nationalityCountryCode: null, relationshipType: 'OTHER' };
const formatRelationship = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

export function TravellersPage() {
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: unknown } | null)?.returnTo === '/app/trips/new' ? '/app/trips/new' : null;
  const [travellers, setTravellers] = useState<TravellerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<TravellerForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try { setTravellers(await travellerService.list()); }
    catch { setError("We couldn't load your travellers. Please try again."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function addSelf() {
    let prefill = { ...emptyForm, relationshipType: 'SELF' as const };
    try {
      const profile = await customerService.me();
      const words = profile.displayName?.trim().split(/\s+/) ?? [];
      if (words.length > 1) prefill = { ...prefill, legalFirstName: words[0]!, legalLastName: words.slice(1).join(' ') };
    } catch { /* The customer can enter legal names manually. */ }
    setForm(prefill); setEditingId(null); setNotice('Please confirm your legal name before saving.');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form) return;
    if (!form.legalFirstName.trim() || !form.legalLastName.trim()) { setError('Legal first and last names are required.'); return; }
    if (form.dateOfBirth && form.dateOfBirth > new Date().toISOString().slice(0, 10)) { setError('Date of birth cannot be in the future.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      if (editingId) await travellerService.update(editingId, form);
      else await travellerService.create(form);
      setForm(null); setEditingId(null); await load(); setNotice(editingId ? 'Traveller updated.' : 'Traveller added.');
    } catch { setError("We couldn't save this traveller. Please check the details and try again."); }
    finally { setSaving(false); }
  }

  async function archive(traveller: TravellerProfile) {
    if (!window.confirm(`Archive ${traveller.legalFirstName} ${traveller.legalLastName}?`)) return;
    setError(''); setNotice('');
    try { await travellerService.archive(traveller.id); await load(); setNotice('Traveller archived.'); }
    catch { setError("We couldn't archive this traveller. Please try again."); }
  }

  const field = (key: keyof TravellerForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((previous) => previous ? { ...previous, [key]: event.target.value || null } : previous);
  return <div className="account-page">{returnTo && <Link className="trip-back" to={returnTo}>← Back to your trip plan</Link>}<p className="account-eyebrow">PEOPLE YOU TRAVEL WITH</p><h1>My Travellers</h1><p className="account-muted">Keep legal names and essential details ready for future trips. No passport or document information is collected here.</p>
    <div className="account-actions"><button className="btn-primary" onClick={() => { setForm({ ...emptyForm }); setEditingId(null); setError(''); }}>+ Add traveller</button><button className="account-outline-button" onClick={() => { void addSelf(); }}>Add myself as a traveller</button></div>
    {error && <p role="alert" className="account-error">{error}{loading === false && travellers.length === 0 && <button onClick={() => { void load(); }}>Retry</button>}</p>}{notice && <p role="status" className="account-notice">{notice}</p>}
    {form && <form className="account-panel account-form" onSubmit={(event) => { void save(event); }}><div className="account-panel-heading"><h2>{editingId ? 'Edit traveller' : 'Add traveller'}</h2><button type="button" onClick={() => { setForm(null); setEditingId(null); }}>Cancel</button></div><p className="account-muted">Enter details exactly as the traveller confirms them.</p><div className="account-form-grid">
      <label>Legal first name<input required maxLength={100} value={form.legalFirstName} onChange={field('legalFirstName')} /></label>
      <label>Legal middle name<input maxLength={100} value={form.legalMiddleName ?? ''} onChange={field('legalMiddleName')} /></label>
      <label>Legal last name<input required maxLength={100} value={form.legalLastName} onChange={field('legalLastName')} /></label>
      <label>Date of birth<input type="date" max={new Date().toISOString().slice(0, 10)} value={form.dateOfBirth ?? ''} onChange={field('dateOfBirth')} /></label>
      <label>Gender<select value={form.gender ?? ''} onChange={field('gender')}><option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="X">X</option><option value="UNDISCLOSED">Undisclosed</option></select></label>
      <label>Nationality country code<input pattern="[A-Z]{2}" maxLength={2} value={form.nationalityCountryCode ?? ''} onChange={field('nationalityCountryCode')} placeholder="MY" /></label>
      <label>Relationship<select value={form.relationshipType} onChange={field('relationshipType')}>{relationships.map((value) => <option key={value} value={value}>{formatRelationship(value)}</option>)}</select></label>
    </div><button className="btn-primary account-submit" disabled={saving} type="submit">{saving ? 'Saving…' : editingId ? 'Save traveller' : 'Add traveller'}</button></form>}
    {loading ? <p role="status" className="account-soft-note">Loading travellers…</p> : travellers.length === 0 ? <div className="account-empty"><span>♧</span><h2>No travellers yet</h2><p>Add yourself or someone you travel with to get started.</p></div> : <div className="account-traveller-grid">{travellers.map((traveller) => <article className="account-traveller-card" key={traveller.id}><div className="account-traveller-avatar">{traveller.legalFirstName.charAt(0)}{traveller.legalLastName.charAt(0)}</div><div><p className="account-eyebrow">{formatRelationship(traveller.relationshipType)}</p><h2>{traveller.legalFirstName} {traveller.legalLastName}</h2><p>{traveller.nationalityCountryCode ? `Nationality: ${traveller.nationalityCountryCode}` : 'Nationality not added'}</p></div><div className="account-card-actions"><button onClick={() => { setForm({ legalFirstName: traveller.legalFirstName, legalMiddleName: traveller.legalMiddleName, legalLastName: traveller.legalLastName, dateOfBirth: traveller.dateOfBirth, gender: traveller.gender, nationalityCountryCode: traveller.nationalityCountryCode, relationshipType: traveller.relationshipType }); setEditingId(traveller.id); setError(''); }}>Edit</button><button onClick={() => { void archive(traveller); }}>Archive</button></div></article>)}</div>}
  </div>;
}
