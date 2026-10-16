import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadLanguageAndTheme } from './theme';

await loadLanguageAndTheme();
createRoot(document.getElementById('root')!).render(<App />);
