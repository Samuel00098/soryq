import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.tsx';
import ReactErrorBoundary from '$lib/react/ReactErrorBoundary';

const container = document.getElementById('app');
if (!container) {
  throw new Error('App root container not found');
}

createRoot(container).render(
  <StrictMode>
    <ReactErrorBoundary>
      <App />
    </ReactErrorBoundary>
  </StrictMode>,
);
