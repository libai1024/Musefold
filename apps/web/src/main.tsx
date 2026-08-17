import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createWebGateway } from './runtime';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Musefold Web root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <App gateway={createWebGateway()} />
  </StrictMode>,
);
