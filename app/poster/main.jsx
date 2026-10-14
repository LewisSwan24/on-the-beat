import { createRoot } from 'react-dom/client';
import Poster from './Poster.jsx';
import '../styles.css';
import './poster.css';

// The poster a venue puts up, at /poster/<venue>: the app's look, its code, and tonight live from the relay.
createRoot(document.getElementById('root')).render(<Poster />);
