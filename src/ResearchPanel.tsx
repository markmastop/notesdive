import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search, Settings, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./api";
import { renderMarkdown } from "./markdown";
import { openWebLink } from "./webLinks";
import { researchApi, researchMarkdown, researchPrompt, researchSource, type ResearchMessage, type ResearchModel, type ResearchSource } from "./research";

type Turn = { question: string; content: string; model: string; sources: ResearchSource[]; date: Date };
export function ResearchPanel({ noteName, noteText, disabled, append, close }: {
  noteName: string; noteText: string; disabled: boolean;
  append: (markdown: string) => void; close: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ResearchModel[]>([]);
  const [model, setModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [question, setQuestion] = useState("");
  const [includeNote, setIncludeNote] = useState(false);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceExcerpt, setSourceExcerpt] = useState("");
  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  // Ignore completions after navigating away from this document; never insert automatically.
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const refreshModels = async () => {
    setLoadingModels(true);
    try {
      const available = await researchApi.models();
      if (!active.current) return;
      setModels(available);
      setModel((previous) => available.some((m) => m.id === previous) ? previous : available[0]?.id ?? "");
    } catch (e) { if (active.current) setError(String(e)); }
    finally { if (active.current) setLoadingModels(false); }
  };
  useEffect(() => {
    if (!desktop) { setChecking(false); return; }
    void researchApi.connected().then((value) => {
      if (active.current) { setConnected(value); setSettings(!value); }
    }).catch((e) => { if (active.current) setError(String(e)); })
      .finally(() => { if (active.current) setChecking(false); });
    void refreshModels();
  }, []);
  const connection = async (remove = false) => {
    setBusy(true); setError(""); setNotice("");
    try {
      if (remove) await researchApi.disconnect(); else await researchApi.connect(apiKey);
      if (!active.current) return;
      setApiKey(""); setConnected(!remove); setSettings(remove);
      setNotice(remove ? "OpenRouter key removed." : "OpenRouter connected. Key saved in your system keychain.");
    } catch (e) { if (active.current) setError(String(e)); }
    finally { if (active.current) setBusy(false); }
  };
  const ask = async () => {
    if (busy || !question.trim()) return;
    setError(""); setNotice("");
    if (sourceUrl.trim() || sourceTitle.trim() || sourceExcerpt.trim()) {
      setError("Add or clear the source form before asking, so its information is included."); return;
    }
    const submitted = question.trim();
    const sentSources = [...new Map([...turns.flatMap((turn) => turn.sources), ...sources].map((source) => [source.url, { ...source }])).values()];
    const history: ResearchMessage[] = [...messages, { role: "user", content: researchPrompt(submitted, sources, includeNote ? noteText : undefined) }];
    setBusy(true);
    try {
      const result = await researchApi.ask(model, history);
      if (!active.current) return;
      setMessages([...history, { role: "assistant", content: result.content }]);
      setTurns((previous) => [...previous, { question: submitted, ...result, sources: sentSources, date: new Date() }]);
      setQuestion("");
    } catch (e) { if (active.current) setError(String(e)); }
    finally { if (active.current) setBusy(false); }
  };
  return <aside className="research-panel" aria-label="Research assistant">
    <header className="research-heading"><div><strong>Research</strong><small>OpenRouter · free models only</small></div>
      <button className="icon-button" aria-label="OpenRouter settings" aria-expanded={settings} onClick={() => setSettings(!settings)}><Settings size={16} /></button>
      <button className="icon-button" aria-label="Close research" onClick={close}><X size={16} /></button>
    </header>
    <div className="research-scroll">
      <p className="research-hint">Ask, review, then add to your note. No live web search: supply excerpts below or search with Google.</p>
      <details><summary>About this conversation</summary><p className="research-hint">Only text you explicitly submit is sent to OpenRouter. Follow-ups include previous questions, answers and context until you start a new conversation. Closing the panel or switching notes clears the conversation. Add answers you want to keep to your note first.</p></details>
      {!desktop && <p role="status">Research is available in the NotesDive desktop app.</p>}
      {checking && <p role="status">Checking connection…</p>}
      {settings && <section className="research-settings" aria-label="OpenRouter connection">
        <label>OpenRouter API key<input aria-label="OpenRouter API key" type="password" autoComplete="off" value={apiKey} disabled={busy || !desktop} onChange={(e) => setApiKey(e.target.value)} /></label>
        <div className="research-actions"><button className="quiet-button" disabled={busy || !desktop || !apiKey.trim()} onClick={() => void connection()}>Connect</button>
          {connected && <button className="quiet-button" disabled={busy} onClick={() => void connection(true)}>Disconnect</button>}</div>
        <small>Your key is stored in the system keychain. Free model availability and request limits vary.</small>
      </section>}
      <section className="research-step"><h3>1. Ask</h3>
        <label>Free model<select aria-label="Free research model" value={model} disabled={busy || loadingModels || !models.length} onChange={(e) => setModel(e.target.value)}>
          {!models.length && <option value="">{loadingModels ? "Loading free models…" : "No models loaded"}</option>}
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></label>
        <button className="quiet-button" disabled={busy || loadingModels || !desktop} onClick={() => { setError(""); void refreshModels(); }}>Refresh free models</button>
        <label>Question<textarea aria-label="Research question" placeholder="What would you like to find out?" rows={3} maxLength={16000} value={question} disabled={busy} onChange={(e) => setQuestion(e.target.value)} /></label>
        <label className="research-checkbox"><input type="checkbox" checked={includeNote} disabled={busy} onChange={(e) => setIncludeNote(e.target.checked)} />Include this note as context</label>
        {includeNote && <small>The full current note will be sent with your next question.</small>}
        <details><summary>Supply source links and excerpts ({sources.length})</summary>
          <p className="research-hint">Paste text from a source to let the model use it. Links alone are not read. These sources are included with each follow-up.</p>
          {sources.map((source, i) => <div className="research-source" key={`${source.url}:${i}`}><a data-web-link href={source.url} onClick={(e) => openWebLink(e, setError)}>{source.title}</a><button className="icon-button" disabled={busy} aria-label={`Remove source ${source.title}`} onClick={() => setSources(sources.filter((_, index) => index !== i))}><X size={14} /></button></div>)}
          <label>Source title<input value={sourceTitle} disabled={busy} maxLength={300} onChange={(e) => setSourceTitle(e.target.value)} /></label>
          <label>Source URL<input type="url" placeholder="https://…" value={sourceUrl} disabled={busy} maxLength={2000} onChange={(e) => setSourceUrl(e.target.value)} /></label>
          <label>Source excerpt<textarea rows={3} value={sourceExcerpt} disabled={busy} maxLength={12000} onChange={(e) => setSourceExcerpt(e.target.value)} /></label>
          <button className="quiet-button" disabled={busy || !sourceUrl.trim() || sources.length >= 8} onClick={() => {
            try { setSources([...sources, researchSource(sourceTitle, sourceUrl, sourceExcerpt)]); setSourceTitle(""); setSourceUrl(""); setSourceExcerpt(""); setError(""); }
            catch (e) { setError(String(e)); }
          }}>Add source</button>
        </details>
        <div className="research-actions"><button className="quiet-button research-ask" disabled={!desktop || checking || !connected || !model || busy || !question.trim() || messages.length >= 12} onClick={() => void ask()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}{busy ? "Working…" : turns.length ? "Ask follow-up" : "Ask OpenRouter"}</button>
          <button className="quiet-button" disabled={!desktop || !question.trim()} onClick={() => void invoke("open_web_link", { url: `https://www.google.com/search?q=${encodeURIComponent(question.trim())}` }).catch(() => setError("Could not open Google in your browser."))}>Google ↗</button></div>
      </section>
      {!!turns.length && <section className="research-step"><h3>2. Review and add</h3><p className="research-hint">Review claims and links before use. Edit an answer to select the portion you want to keep.</p>
        {turns.map((turn, i) => <article className="research-turn" key={i}><h4>{turn.question}</h4>
          <div className="markdown-preview research-answer" onClickCapture={(e) => openWebLink(e, setError)} dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.content) }} />
          <details><summary>Edit text to insert</summary><textarea aria-label={`Edit research answer ${i + 1}`} rows={8} disabled={busy} value={turn.content} onChange={(e) => setTurns((previous) => previous.map((t, index) => index === i ? { ...t, content: e.target.value } : t))} /></details>
          <button className="quiet-button" disabled={disabled || busy || !turn.content.trim()} title={`Append to ${noteName}`} onClick={() => { append(researchMarkdown(turn.content, turn.model, turn.sources, turn.date)); setNotice(`Added to ${noteName}.`); }}>Append answer + sources to note</button>
          <small>{turn.model} · {turn.sources.length} supplied sources</small>
        </article>)}
        <button className="quiet-button" disabled={busy} onClick={() => { setMessages([]); setTurns([]); setNotice(""); setError(""); }}>New conversation</button>
        <small>New conversation clears previous questions and answers. Supplied sources remain.</small>
      </section>}
      {error && <p className="research-error" role="alert">{error}</p>}
      {notice && <p className="research-notice" role="status">{notice}</p>}
    </div>
  </aside>;
}
