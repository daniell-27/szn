import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import * as api from "../lib/api.js";

// Typeahead company picker. The company is only "set" once the user clicks a
// result (click-to-confirm), which also returns the ticker.
export default function CompanySearch({ company, ticker, onSelect, onClear }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);
  const boxRef = useRef(null);

  const confirmed = !!ticker;

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function onType(v) {
    setQuery(v);
    setOpen(true);
    clearTimeout(timer.current);
    if (!v.trim()) { setResults([]); return; }
    setLoading(true);
    setError("");
    timer.current = setTimeout(async () => {
      try {
        const rows = await api.searchCompanies(v.trim());
        setResults(rows);
        setError("");
      } catch (e) {
        setResults([]);
        setError(e.message || "Search failed.");
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function choose(r) {
    onSelect({ name: r.name, symbol: r.symbol });
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  if (confirmed) {
    return (
      <div className="company-confirmed">
        <span className="company-chip">
          <span className="company-name">{company}</span>
          <span className="company-ticker">{ticker}</span>
        </span>
        <button className="icon-btn" title="Change company" onClick={onClear}><Icon name="close" /></button>
      </div>
    );
  }

  return (
    <div className="company-search" ref={boxRef}>
      <div className="company-input">
        <Icon name="search" className="company-search-icon" />
        <input
          className="input"
          placeholder="Search company name or ticker…"
          value={query}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => query && setOpen(true)}
        />
      </div>
      {open && (query.trim() || loading) && (
        <div className="company-dropdown">
          {loading && <div className="company-loading">Searching…</div>}
          {!loading && error && <div className="company-error">{error}</div>}
          {!loading && !error && results.length === 0 && <div className="company-empty">No matches.</div>}
          {results.map((r) => (
            <button key={`${r.symbol}-${r.exchange}`} className="company-option" onClick={() => choose(r)}>
              <span className="company-option-name">{r.name}</span>
              <span className="company-option-meta">{r.symbol}{r.exchange ? ` · ${r.exchange}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
