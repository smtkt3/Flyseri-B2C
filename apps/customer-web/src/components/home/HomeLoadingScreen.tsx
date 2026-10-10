import logo from '../../assets/flyseri-logo.png';
import './home-loading.css';

/** Matches the HTML shell so the first paint continues into React's lazy fallback. */
export function HomeLoadingScreen() {
  return <div className="home-loading">
    <div className="home-loading-card">
      <img className="home-loading-logo" src={logo} alt="Flyseri" width="170" height="50" />
      <div className="home-loading-journey" aria-hidden="true">
        <span className="home-loading-point" />
        <span className="home-loading-trail" />
        <svg viewBox="0 0 24 24" fill="none"><path d="m21 3-6.5 18-3.8-7.7L3 9.5 21 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="m21 3-10.3 10.3" stroke="currentColor" strokeWidth="1.6" /></svg>
      </div>
      <h1>Your next journey starts here</h1>
      <p role="status">Getting your travel search ready<span className="home-loading-dots" aria-hidden="true"><i /><i /><i /></span></p>
      <div className="home-loading-search" aria-hidden="true"><span /><span /><span /><span /></div>
    </div>
  </div>;
}
