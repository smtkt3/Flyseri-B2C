import './page-loading.css';

export function PageLoading({ label = 'Opening your page…' }: { label?: string }) {
  return <div className="page-loading" role="status" aria-live="polite" aria-label={label}>
    <p>{label}</p>
    <div className="page-loading-header" aria-hidden="true"><span/><span/></div>
    <div className="page-loading-grid" aria-hidden="true"><div><span/><span/><span/></div><div><span/><span/></div></div>
  </div>;
}
