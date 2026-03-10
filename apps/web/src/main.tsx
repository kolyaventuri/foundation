import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app';
import './styles.css';

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('Expected a #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
