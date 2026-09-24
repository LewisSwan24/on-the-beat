import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { BandStandIn } from './screens/Band.jsx';
import './styles.css';

// /band is the wristband's stand-in; everything else is the phone.
const Root = location.pathname.startsWith('/band') ? BandStandIn : App;
createRoot(document.getElementById('root')).render(<Root />);

// The app still opens in a venue with no signal. Only the shell is kept:
// the socket and the clips are never cached. A service worker needs a secure
// context, so a phone on plain http over the LAN simply goes without.
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
