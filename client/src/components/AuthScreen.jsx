import React, { useState } from "react";
import { login, signup } from "../lib/api.js";

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const fn = mode === "login" ? login : signup;
      const { user } = await fn(email.trim(), password);
      onAuthed(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo logo-mark logo-mark-lg" aria-hidden="true">szn<span className="logo-dot">.</span></div>
        <div className="auth-brand">SZN</div>
        <div className="auth-sub">back-of-the-envelope valuations</div>

        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Log in</button>
          <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Sign up</button>
        </div>

        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password{mode === "signup" ? " (8+ characters)" : ""}</span>
          <input className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>

        {error && <div className="banner banner-error">{error}</div>}

        <button className="btn btn-run auth-submit" type="submit" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
