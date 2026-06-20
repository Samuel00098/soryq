import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.tsx';
import ReactErrorBoundary from '$lib/react/ReactErrorBoundary';

const container = document.getElementById('app');
if (!container) {
  throw new Error('App root container not found');
}

const root = createRoot(container);
root.render(createElement(StrictMode, null, createElement(ReactErrorBoundary, null, createElement(App))));

export default root;
