import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Agents from "./pages/Agents";
import Audit from "./pages/Audit";
import Login from "./pages/Login";
import Memory from "./pages/Memory";
import Missions from "./pages/Missions";
import Models from "./pages/Models";
import RunConsole from "./pages/RunConsole";
import Teams from "./pages/Teams";
import Usage from "./pages/Usage";
import "./styles.css";

function Shell() {
  const { me, loading, logout } = useAuth();
  if (loading) return <p className="muted pad">Loading…</p>;
  if (!me) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <div className="layout">
      <nav>
        <h1>Agent Platform</h1>
        {[["/agents", "Agents"], ["/teams", "Teams & org chart"], ["/missions", "Missions"], ["/memory", "Memory"], ["/runs", "Run console"], ["/models", "Models & providers"], ["/usage", "Cost & usage"], ...(me.role === "admin" ? [["/audit", "Audit log"]] : [])].map(([to, label]) => (
          <NavLink key={to} to={to!}>{label}</NavLink>
        ))}
        <div className="spacer" />
        <span className="muted small">Signed in as {me.role}</span>
        <button className="link" onClick={logout}>Sign out</button>
      </nav>
      <main>
        <Routes>
          <Route path="/agents" element={<Agents />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/missions" element={<Missions />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/runs" element={<RunConsole />} />
          <Route path="/models" element={<Models />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/agents" replace />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BrowserRouter><AuthProvider><Shell /></AuthProvider></BrowserRouter></StrictMode>,
);
