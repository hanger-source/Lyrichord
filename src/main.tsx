/**
 * Lyrichord React 入口
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { applyTheme, lightTheme } from './ui/theme';
import './style.css';

// 注入主题 CSS 变量
applyTheme(lightTheme);

const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
