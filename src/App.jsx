import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import AdminPanel   from "./AdminPanel.jsx";
import Scoreboard   from "./Scoreboard.jsx";
import Stats        from "./Stats.jsx";
import Overlay      from "./Overlay.jsx";
import PointsTable  from "./PointsTable.jsx";
import "./App.css";

function AppContent() {
  const location = useLocation();
  const isOverlay = location.pathname === '/overlay';
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div>
      {/* ── Navigation (Hidden on OBS Overlay) ── */}
      {!isOverlay && (
        <nav className="app-nav">
          <div className="nav-brand">🏏 CricketLive</div>

          {/* Hamburger toggle */}
          <button
            className={`hamburger ${menuOpen ? "open" : ""}`}
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Toggle menu"
          >
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
          </button>

          {/* Links — visible on desktop, toggled on mobile */}
          <div className={`nav-links ${menuOpen ? "nav-links--open" : ""}`}>
            <NavLink to="/" end
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              onClick={() => setMenuOpen(false)}>
              📊 Scoreboard
            </NavLink>
            <NavLink to="/points-table"
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              onClick={() => setMenuOpen(false)}>
              🏆 Points Table
            </NavLink>
            <NavLink to="/stats"
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              onClick={() => setMenuOpen(false)}>
              📈 Stats
            </NavLink>
            <NavLink to="/admin"
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              onClick={() => setMenuOpen(false)}>
              ⚙️ Admin
            </NavLink>
          </div>
        </nav>
      )}

      {/* ── Routes ── */}
      <main>
        <Routes>
          <Route path="/"              element={<Scoreboard />} />
          <Route path="/points-table"  element={<PointsTable />} />
          <Route path="/stats"         element={<Stats />} />
          <Route path="/admin"         element={<AdminPanel />} />
          <Route path="/overlay"       element={<Overlay />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;