import { useEffect, useState } from "react";
import { FolderPlus, Palette, RefreshCw } from "lucide-react";
import { libraryApi } from "./libraries";

export function LibraryThemes({ library, disabled }: { library: string; disabled: boolean }) {
  const [listing, setListing] = useState<Awaited<ReturnType<typeof libraryApi.themes>> | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setListing(null);
    setError("");
    void libraryApi.themes(library).then(
      (value) => { if (active) setListing(value); },
      (reason) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [library, revision]);
  const create = async () => {
    setWorking(true);
    setError("");
    try { setListing(await libraryApi.themes(library, true)); }
    catch (reason) { setError(String(reason)); }
    finally { setWorking(false); }
  };
  return <section className="library-themes" aria-label="Presentation themes">
    <div className="library-themes-heading"><h3><Palette size={16}/> Themes</h3>
      <button className="quiet-button" aria-label="Reload library themes" disabled={disabled || working} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14}/></button>
    </div>
    <p>Shared presentation themes for every project in this library.</p>
    <div className="library-theme-tags" aria-label="Built-in themes"><span>default</span><span>gaia</span><span>uncover</span><small>Built in</small></div>
    <div className="library-themes-path">{library}/themes</div>
    {listing?.exists ? <>
      {listing.themes.length ? <ul>{listing.themes.map((name) => <li key={name}><code>{name}.css</code><span>Use <code>theme: {name}</code></span></li>)}</ul>
        : <p className="library-hint">No custom themes yet. Add a .css theme file to this folder.</p>}
      <p className="library-hint">For example, <code>workshop.css</code> contains <code>/* @theme workshop */</code>. Select it with <code>theme: workshop</code> in your slides.</p>
      <p className="library-hint">Keep a theme's image folder beside its CSS file when copying it.</p>
    </> : listing && <button className="quiet-button" disabled={disabled || working} onClick={() => void create()}><FolderPlus size={15}/> Create themes folder</button>}
    {error && <p role="alert" className="library-hint">{error}</p>}
  </section>;
}
