import { Component, type ReactNode } from 'react';
export class HomeFeatureBoundary extends Component<{ children: ReactNode; name: string; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? this.props.fallback ?? <div className="home-feature-loading" role="alert"><strong>{this.props.name} could not load</strong><p>Your travel plans are safe. Reload the page to try again.</p><button type="button" onClick={() => window.location.reload()}>Reload page</button></div> : this.props.children;
  }
}
export function HomeFeatureLoading({ name }: { name: string }) { return <div className="home-feature-loading" role="status"><span className="home-loading-dot" aria-hidden="true"/><strong>Opening {name}…</strong></div>; }
