import { useState, type FormEvent } from "react";
import { post } from "../api";
import { useAuth } from "../auth";
import { Err } from "../ui";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await login((await post("/api/auth/login", { email, password })).token); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <form className="login card" onSubmit={submit}>
      <h1>Agent Platform</h1>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      <Err msg={err} />
      <button className="primary">Sign in</button>
    </form>
  );
}
