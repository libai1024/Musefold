import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMusefoldQueryClient } from '@musefold/product-ui';
import { App } from './App';
import { createWebGateway } from './runtime';
import { webPlatformServices } from './runtime/platform-services';
import '@musefold/ui/tokens.css';
import '@musefold/ui/primitives.css';
import '@musefold/ui/theater-fonts.css';
import './styles.css';
import './settings.css';
import '@musefold/product-ui/styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Musefold Web root element is missing');
}

document.documentElement.dataset.productHost = 'web';

const queryClient = createMusefoldQueryClient();
void webPlatformServices;

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App gateway={createWebGateway()} platform={webPlatformServices} />
    </QueryClientProvider>
  </StrictMode>,
);
