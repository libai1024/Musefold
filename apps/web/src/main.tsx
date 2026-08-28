import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMusefoldQueryClient } from '@musefold/product-ui';
import { App } from './App';
import { IosDesignDemoView } from './views/IosDesignDemoView';
import { CeramicButtonDemoView } from './views/CeramicButtonDemoView';
import { createWebGateway } from './runtime';
import { webPlatformServices } from './runtime/platform-services';
import '@musefold/ui/tokens.css';
import '@musefold/ui/primitives.css';
import '@musefold/ui/theater-fonts.css';
import '@musefold/ui/brand-fonts.css';
import './styles.css';
import './settings.css';
import '@musefold/product-ui/styles.css';
import './ios-design-demo.css';
import './ceramic-button-demo.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Musefold Web root element is missing');
}

document.documentElement.dataset.productHost = 'web';

const demo = new URLSearchParams(window.location.search).get('demo');
const isDesignDemo = demo === 'ios-design';
const isCeramicButtonDemo = demo === 'ceramic-button';

const queryClient = createMusefoldQueryClient();
void webPlatformServices;

createRoot(root).render(
  <StrictMode>
    {isDesignDemo ? (
      <IosDesignDemoView />
    ) : isCeramicButtonDemo ? (
      <CeramicButtonDemoView />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App gateway={createWebGateway()} platform={webPlatformServices} />
      </QueryClientProvider>
    )}
  </StrictMode>,
);
