import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import DashboardShowcase from './lib/components/layout/DashboardShowcase.tsx';

// Lightweight harness for rendering isolated React components in pilot.html.
const container = document.getElementById('pilot-root');
if (!container) {
  throw new Error('pilot-root container not found');
}

createRoot(container).render(
  <StrictMode>
    <DashboardShowcase />
  </StrictMode>,
);

