import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createWebGateway } from './runtime';
import '@musefold/ui/tokens.css';
import '@musefold/ui/primitives.css';
import './styles.css';
import '@musefold/product-ui/styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Musefold Web root element is missing');
}

document.documentElement.dataset.productHost = 'web';

createRoot(root).render(
  <StrictMode>
    <App gateway={createWebGateway()} />
  </StrictMode>,
);
