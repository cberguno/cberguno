import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { get } from "./api";
import { AuthProvider, useAuth } from "./auth";
import Agents from "./pages/Agents";
import Approvals from "./pages/Approvals";
import Audit from "./pages/Audit";
import Login from "./pages/Login";
import Memory from "./pages/Memory";
import Missions from "./pages/Missions";
import Models from "./pages/Models";
import RunConsole from "./pages/RunConsole";
import Schedules from "./pages/Schedules";
import Teams from "./pages/Teams";
import Tools from "./pages/Tools";
import Usage from "./pages/Usage";
import Workflows from "./pages/Workflows";
import "./styles.css";

/** Pending-approval count for the nav badge; polled so a waiting human notices without refreshing. */
function usePendingApprovals(enabled: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const load = () => get<any[]>("/api/approvals?status=pending").then((r) => setN(r.length)).catch(() => {});
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [enabled]);
  return n;
}

function Shell() {
  const { me, loading, logout } = useAuth();
  const pending = usePendingApprovals(!!me);
  if (loading) return <p className="muted pad">Loading…</p>;
  if (!me) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <div className="layout">
      <nav>
        <h1>Agent Platform</h1>
        {[["/agents", "Agents"], ["/teams", "Teams & org chart"], ["/missions", "Missions"], ["/approvals", "Approvals"], ["/workflows", "Workflow builder"], ["/schedules", "Schedules"], ["/tools", "Tools & MCP"], ["/memory", "Memory"], ["/runs", "Run console"], ["/models", "Models & providers"], ["/usage", "Cost & usage"], ...(me.role === "admin" ? [["/audit", "Audit log"]] : [])].map(([to, label]) => (
          <NavLink key={to} to={to!}>{label}{to === "/approvals" && pending > 0 && <span className="count" aria-label={`${pending} waiting`}>{pending}</span>}</NavLink>
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
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/tools" element={<Tools />} />
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
