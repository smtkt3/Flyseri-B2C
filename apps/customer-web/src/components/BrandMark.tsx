import logo from '../assets/flyseri-logo.png';

export function BrandMark() {
  return <img className="premium-mark" src={logo} alt="Flyseri" width={136} height={40} fetchPriority="high" />;
}
