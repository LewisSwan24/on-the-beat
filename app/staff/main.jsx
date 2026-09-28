import { createRoot } from 'react-dom/client';
import Staff from './Staff.jsx';
import '../styles.css';
import './staff.css';

// The venue team's page, at /staff. It registers no service worker: it is live or nothing.
createRoot(document.getElementById('root')).render(<Staff />);
