import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import * as api from "../lib/api.js";

// The "Fintwit" dropdown + "Upload article" button that sit under the
// "Alternative scenarios" heading and add editable scenarios.
export default function ScenarioSources({ health, context, addedHandles, onAddScenario, onRemoveByHandle }) {
  const [ftOpen, setFtOpen] = useState(false);
  const [influencers, setInfluencers] = useState(null);
  const [ftLoading, setFtLoading] = useState(false);
  const [ftError, setFtError] = useState("");
  const [pending, setPending] = useState(null);

  const [articleBusy, setArticleBusy] = useState(false);
  const [articleMsg, setArticleMsg] = useState("");
  const fileRef = useRef(null);
  const boxRef = useRef(null);

  const showFintwit = !!health?.fintwit;
  const showArticle = !!(health && (health.hasKey || health.mock));
  if (!showFintwit && !showArticle) return null;

  const hasCompany = !!context.ticker || !!context.company;

  // Refetch keys on the selected company so switching companies doesn't show a
  // previous company's cached influencers (or a stale "none found").
  const companyKey = `${context.ticker || ""}|${context.company || ""}`;
  useEffect(() => {
    setInfluencers(null);
    setFtError("");
  }, [companyKey]);

  async function openFintwit() {
    const next = !ftOpen;
    setFtOpen(next);
    if (next && influencers === null && hasCompany) {
      setFtLoading(true);
      setFtError("");
      try {
        const d = await api.getFintwit(context.ticker, context.company);
        setInfluencers(d.influencers || []);
      } catch (e) {
        setFtError(e.message);
        setInfluencers([]);
      } finally {
        setFtLoading(false);
      }
    }
  }

  async function toggleInfluencer(inf, checked) {
    if (checked) {
      setPending(inf.handle);
      setFtError("");
      try {
        const sc = await api.getFintwitScenario({
          handle: inf.handle, tweets: inf.tweets,
          company: context.company, ticker: context.ticker, formulaText: context.formulaText,
        });
        onAddScenario({ name: sc.name, description: sc.description, source: "fintwit", handle: inf.handle });
      } catch (e) {
        setFtError(e.message);
      } finally {
        setPending(null);
      }
    } else {
      onRemoveByHandle(inf.handle);
    }
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = String(reader.result).split(",")[1];
      setArticleBusy(true);
      setArticleMsg("");
      try {
        const r = await api.ingestArticle({ dataBase64: base64, ...context });
        if (r.relevant) onAddScenario({ name: r.name, description: r.description, source: "article" });
        else setArticleMsg(r.reason || "The article didn't contain enough relevant information for a scenario.");
      } catch (err) {
        setArticleMsg(err.message);
      } finally {
        setArticleBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsDataURL(f);
  }

  return (
    <div className="scenario-sources">
      <div className="sources-row">
        {showFintwit && (
          <div className="fintwit" ref={boxRef}>
            <button className="btn btn-sm btn-icon" onClick={openFintwit} disabled={!hasCompany} title={hasCompany ? "" : "Select a company first"}>
              Fintwit <Icon name="chevron" size={14} />
            </button>
            {ftOpen && (
              <div className="fintwit-dropdown">
                {!hasCompany && <div className="company-empty">Select a company first.</div>}
                {hasCompany && ftLoading && <div className="company-loading">Finding relevant accounts…</div>}
                {hasCompany && ftError && <div className="company-error">{ftError}</div>}
                {hasCompany && !ftLoading && !ftError && influencers?.length === 0 && (
                  <div className="company-empty">No curated accounts have posted about this recently.</div>
                )}
                {influencers?.map((inf) => {
                  const checked = addedHandles.has(inf.handle);
                  return (
                    <label key={inf.handle} className="fintwit-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pending === inf.handle}
                        onChange={(e) => toggleInfluencer(inf, e.target.checked)}
                      />
                      <span className="fintwit-handle">@{inf.handle}</span>
                      {pending === inf.handle && <span className="fintwit-loading">…</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {showArticle && (
          <>
            <button className="btn btn-sm btn-icon" onClick={() => fileRef.current?.click()} disabled={articleBusy}>
              <Icon name="upload" size={14} /> {articleBusy ? "Reading…" : "Upload article"}
            </button>
            <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={onFile} />
          </>
        )}
      </div>
      {articleMsg && <div className="article-msg">{articleMsg}</div>}
    </div>
  );
}
