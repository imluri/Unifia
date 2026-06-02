import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore.js';
import Home from './pages/Home.jsx';
import Lobby from './pages/Lobby.jsx';
import Modules from './pages/Modules.jsx';
import Settings from './pages/Settings.jsx';
import About from './pages/About.jsx';
import StatusBar from './components/StatusBar.jsx';
import TitleBar from './components/TitleBar.jsx';
import Icon from './components/Icon.jsx';

const NAV = [
  { id: 'home', label: 'Home', icon: 'house' },
  { id: 'lobby', label: 'Lobby', icon: 'globe' },
  { id: 'modules', label: 'Modules', icon: 'package' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'about', label: 'About', icon: 'info' },
];

export default function App() {
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);
  const error = useAppStore((s) => s.error);
  const [page, setPage] = useState('home');

  // Bootstrap once on mount: load settings, scan games, fetch installed modules.
  useEffect(() => {
    init();
  }, [init]);

  function renderPage() {
    switch (page) {
      case 'lobby':
        return <Lobby />;
      case 'modules':
        return <Modules />;
      case 'settings':
        return <Settings />;
      case 'about':
        return <About />;
      case 'home':
      default:
        return <Home goToModules={() => setPage('modules')} />;
    }
  }

  return (
    <div className="flex h-screen flex-col bg-app text-neutral-200">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="flex w-52 shrink-0 flex-col border-r border-white/5 bg-sidebar">
          <div className="px-5 py-5">
            <span className="text-xl font-bold tracking-tight text-neutral-100">Unifia</span>
            <p className="text-[11px] text-neutral-500">cross-store multiplayer</p>
          </div>
          <ul className="flex-1 space-y-1 px-3">
            {NAV.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => setPage(item.id)}
                  className={`flex w-full items-center gap-3 rounded px-3 py-2 text-sm transition ${
                    page === item.id
                      ? 'bg-accent/20 text-accent'
                      : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
                  }`}
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="px-5 py-4 text-[10px] text-neutral-600">v0.1.0 · MIT</div>
        </nav>

        {/* Main content */}
        <main className="min-w-0 flex-1 overflow-y-auto p-8">
          {!ready ? (
            <div className="flex h-full items-center justify-center text-neutral-500">Loading…</div>
          ) : error ? (
            <div className="rounded-lg bg-red-900/30 p-4 text-sm text-red-300">{error}</div>
          ) : (
            renderPage()
          )}
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
