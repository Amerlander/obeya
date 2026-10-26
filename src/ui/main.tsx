import { createRoot } from 'react-dom/client';
import { App } from './App';
import { takeAppDrops } from './appDrop';
import { loadLanguageAndTheme } from './theme';

await loadLanguageAndTheme();
takeAppDrops();
createRoot(document.getElementById('root')!).render(<App />);
