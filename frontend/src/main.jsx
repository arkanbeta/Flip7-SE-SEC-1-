import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import '@fontsource-variable/fraunces/opsz.css';
import './styles/variables.css';
import './styles/global.css';
import App from './app/App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
