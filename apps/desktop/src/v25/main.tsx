import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopShellHost } from './desktop-shell';
import './globals.css';

function V25Shell() {
  return (
    <StrictMode>
      <DesktopShellHost />
    </StrictMode>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('v25 shell: #root 不存在');
createRoot(container).render(<V25Shell />);
