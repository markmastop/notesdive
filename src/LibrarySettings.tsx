import { useState } from "react";
import { LibraryBig, FolderOpen, Plus, RefreshCw } from "lucide-react";
import type { Libraries } from "./libraries";
import { LibraryThemes } from "./LibraryThemes";
export function LibrarySettings({
  data,
  busy,
  choose,
  select,
  forget,
  reload,
  migrate,
}: {
  data: Libraries;
  busy: boolean;
  choose: (name: string | null) => Promise<boolean>;
  select: (path: string | null) => Promise<boolean>;
  forget: (path: string) => Promise<boolean>;
  reload: () => Promise<boolean>;
  migrate: () => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const run = async (action: () => Promise<boolean>, success = "") => {
    if (busy || working) return;
    setWorking(true);
    setNotice("");
    try {
      if (await action()) {
        setCreating(false);
        setNotice(success);
      }
    } finally {
      setWorking(false);
    }
  };
  const locked = busy || working;
  const current = data.libraries.find((l) => l.path === data.active);
  return (
    <section className="library-settings" aria-label="Library">
      <h2>Libraries</h2>
      <p className="library-intro">
        Create, open and switch libraries. Your projects and files stay in the
        folders you choose.
      </p>
      <div className="library-controls">
        <label>
          <LibraryBig size={17} />
          <span>Library</span>
          <select
            aria-label="Current library"
            value={data.active ?? ""}
            disabled={locked || creating}
            onChange={(e) => void run(() => select(e.target.value || null))}
          >
            <option value="">
              {data.legacyProjects
                ? "Older projects on this Mac"
                : "Choose a library"}
            </option>
            {data.libraries.map((library) => (
              <option key={library.path} value={library.path}>
                {library.name}
                {library.available ? "" : " — unavailable"} · {library.path}
              </option>
            ))}
          </select>
        </label>
        <button
          className="quiet-button"
          disabled={locked || creating}
          onClick={() => {
            setName("");
            setCreating(true);
            setNotice("");
          }}
        >
          <Plus size={15} /> New library
        </button>
        <button
          className="quiet-button"
          disabled={locked || creating}
          onClick={() => void run(() => choose(null))}
        >
          <FolderOpen size={15} /> Open library
        </button>
        <button
          className="quiet-button"
          aria-label="Reload library"
          disabled={locked || creating}
          onClick={() => void run(reload)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {creating ? (
        <form
          aria-label="Create library"
          className="library-create"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => choose(name.trim()),
              "Library created. Go to Projects to add your first project.",
            );
          }}
        >
          <label>
            Library name
            <input
              autoFocus
              required
              maxLength={80}
              value={name}
              disabled={locked}
              onChange={(e) => setName(e.target.value)}
              placeholder="Work, Personal, Research…"
            />
          </label>
          <p>
            You choose the parent folder next. NotesDive creates a new folder
            with this name. You can keep it inside a Git repository.
          </p>
          <div className="project-actions">
            <button type="submit" disabled={locked || !name.trim()}>
              Choose location and create
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : current ? (
        <div className="library-location">
          <span>
            {current.path}
            {!current.available &&
              " — unavailable; use Open library to reconnect it"}
          </span>
          <button
            disabled={locked}
            title="Forget this library location; files stay on disk"
            onClick={() =>
              void run(
                () => forget(current.path),
                "Library removed from this list. Its files stay on disk.",
              )
            }
          >
            Remove from list
          </button>
        </div>
      ) : (
        <p className="library-hint">
          Create a library where you want to keep your projects, or open an
          existing one. Your library files survive reinstalling NotesDive.
        </p>
      )}
      {current?.available && !creating && <LibraryThemes key={current.path} library={current.path} disabled={locked}/>}
      {data.legacyProjects > 0 && (
        <div className="library-migration">
          <span>
            {data.legacyProjects} older project
            {data.legacyProjects === 1 ? "" : "s"} stored on this Mac. Import
            their setup into a library; existing note folders stay where they
            are.
          </span>
          <button
            disabled={locked || !data.active || creating}
            onClick={() =>
              void run(
                migrate,
                "Project setup imported. The original projects and note files are preserved; already imported projects are skipped.",
              )
            }
          >
            Import older projects
          </button>
        </div>
      )}
      {data.legacyError && (
        <p role="alert" className="library-hint">
          Older projects could not be loaded: {data.legacyError}. You can still
          create or open a library. The original configuration has been
          preserved.
        </p>
      )}
      {notice && (
        <p role="status" className="library-hint">
          {notice}
        </p>
      )}
    </section>
  );
}
