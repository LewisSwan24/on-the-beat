import { createRoot } from 'react-dom/client';
import Staff from './Staff.jsx';
import '../styles.css';
import './staff.css';

// The venue team's page, at /staff. Its own service worker (public/staff-sw.js) only shows notifications: the page
// itself is live or nothing.
createRoot(document.getElementById('root')).render(<Staff />);
