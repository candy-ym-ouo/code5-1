import { Navigate, Route, Routes } from 'react-router-dom';
import { GameProvider } from './game-context.tsx';
import { GameShell } from './components/GameShell.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { PlayPage } from './pages/PlayPage.tsx';
import { JournalPage } from './pages/JournalPage.tsx';
import { SpeciesPage } from './pages/SpeciesPage.tsx';
import { ReportPage } from './pages/ReportPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route element={<GameProvider />}>
        <Route element={<GameShell />}>
          <Route path="/play" element={<PlayPage />} />
          <Route path="/play/journal" element={<JournalPage />} />
          <Route path="/play/species/:speciesId" element={<SpeciesPage />} />
          <Route path="/play/report/:year?" element={<ReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
