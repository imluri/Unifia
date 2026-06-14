import React, { useState } from 'react';
import GameDetail from './pages/GameDetail.jsx';
import { useAppStore } from './store/useAppStore.js';
import Home from './pages/Home.jsx';
import Modules from './pages/Modules.jsx';
import Settings from './pages/Settings.jsx';
import About from './pages/About.jsx';
import LoadingScreen from './pages/LoadingScreen.jsx';
import StatusBar from './components/StatusBar.jsx';
import TitleBar from './components/TitleBar.jsx';
import Icon from './components/Icon.jsx';
import logo from './assets/unifia_logo.png';

const NAV = [
  { id: 'home', label: 'Home', icon: 'house' },
  { id: 'modules', label: 'Modules', icon: 'package' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'about', label: 'About', icon: 'info' },
];

// The main application shell. Mounted once the loading sequence completes; the
// `word-fade` class crossfades it in opposite the loader fading out.
function MainLayout() {
  const error = useAppStore((s) => s.error);
  const [page, setPage] = useState('home');
  const [detailGame, setDetailGame] = useState(null);

  function renderPage() {
    if (detailGame) {
      return (
        <GameDetail
          game={detailGame}
          onBack={() => setDetailGame(null)}
          goToModules={() => { setDetailGame(null); setPage('modules'); }}
        />
      );
    }
    switch (page) {
      case 'modules':
        return <Modules />;
      case 'settings':
        return <Settings />;
      case 'about':
        return <About />;
      case 'home':
      default:
        return <Home onOpenGame={setDetailGame} />;
    }
  }

  return (
    <div className="word-fade flex h-screen flex-col bg-app text-neutral-200">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="flex w-52 shrink-0 flex-col border-r border-border-subtle bg-sidebar">
          <div className="px-4 py-4">
            {/* Full width, but crop the square logo's vertical whitespace. */}
            <img src={logo} alt="Unifia" className="h-16 w-full rounded object-cover" />
          </div>
          <ul className="flex-1 space-y-1 px-3">
            {NAV.map((item) => {
              const active = page === item.id;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => { setDetailGame(null); setPage(item.id); }}
                    className={`relative flex w-full items-center gap-3 rounded px-3 py-2 text-sm transition ${
                      active
                        ? 'bg-accent/15 text-neutral-100'
                        : 'text-neutral-400 hover:bg-surface-hover hover:text-neutral-200'
                    }`}
                  >
                    {active && (
                      <span className="nav-indicator absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-accent" />
                    )}
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="px-5 py-4 text-[10px] text-neutral-600">v0.1.0 · MIT</div>
        </nav>

        {/* Main content. Keyed by page so each switch replays the enter animation. */}
        <main className="min-w-0 flex-1 overflow-y-auto p-8">
          {error ? (
            <div className="rounded bg-red-900/30 p-4 text-sm text-red-300">{error}</div>
          ) : (
            <div key={page} className="page-in">
              {renderPage()}
            </div>
          )}
        </main>
      </div>

      <StatusBar />
    </div>
  );
}

export default function App() {
  const ready = useAppStore((s) => s.ready);
  const [showLoader, setShowLoader] = useState(true);

  return (
    <>
      {ready && <MainLayout />}
      {showLoader && <LoadingScreen onDone={() => setShowLoader(false)} />}
    </>
  );
}
