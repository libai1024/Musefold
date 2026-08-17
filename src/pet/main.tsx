// src/pet/main.tsx
// 桌宠窗口的渲染入口。刻意不复用主窗口的 providers/store —— 这个窗口只负责
// 播动画和上报交互，多引一层全局状态只会白白拖慢启动。

import { createRoot } from 'react-dom/client';
import { PetApp } from './PetApp';
import './pet.css';

const container = document.getElementById('pet-root');
if (container) createRoot(container).render(<PetApp />);
