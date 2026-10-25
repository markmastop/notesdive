import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, Download, RefreshCw, X } from "lucide-react";
import { version } from "../package.json";
import { desktop } from "./api";
import { RELEASES_URL, UpdateClient, type UpdateResult } from "./updates";

let clientPromise: Promise<UpdateClient> | undefined;
const getClient = () =>
  (clientPromise ??= invoke<string>("update_platform")
    .then((platform) => {
      let storage: Storage | null = null;
      try {
        storage = localStorage;
      } catch {
        /* Checks still work without persistence. */
      }
      return new UpdateClient(version, platform, storage);
    })
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    }));

export function UpdateNotice() {
  const [expanded, setExpanded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [openError, setOpenError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const check = async () => {
    setChecking(true);
    setOpenError("");
    try {
      setResult(await (await getClient()).check(true));
    } catch {
      setResult((old) => ({
        release: old?.release ?? null,
        checkedAt: old?.checkedAt ?? null,
        error: "Could not check for updates. Please try again.",
      }));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const update = () => {
      if (document.hidden) return;
      void getClient()
        .then((client) => client.check())
        .then((next) => {
          if (active) setResult(next);
        })
        .catch(() => {});
    };
    update();
    const interval = setInterval(update, 60 * 60 * 1000);
    window.addEventListener("focus", update);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", update);
    };
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const pointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node))
        setExpanded(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [expanded]);
  const open = async (page: "download" | "notes") => {
    setOpenError("");
    try {
      if (!result?.release) return;
      await invoke("open_release_page", { page, version: result.release.version });
    } catch {
      setOpenError(`Could not open your browser. Please visit ${RELEASES_URL}.`);
    }
  };
  const release = result?.release;
  return (
    <div className="app-updates" ref={container}>
      <button
        ref={trigger}
        className="app-version update-trigger"
        aria-label="Version and updates"
        aria-expanded={expanded}
        aria-controls="app-update-panel"
        onClick={() => setExpanded((old) => !old)}
        title={`NotesDive ${version}${import.meta.env.DEV ? " — development build" : ""}`}
      >
        <span>
          v{version}
          {import.meta.env.DEV ? " · dev" : ""}
        </span>
        {release && (
          <span className="update-badge">
            <Download size={12} /> Update available
          </span>
        )}
      </button>
      {expanded && (
        <section
          id="app-update-panel"
          className="update-panel"
          aria-label="Software updates"
        >
          <div className="update-panel-heading">
            <strong>
              {release
                ? `NotesDive ${release.version} is available`
                : "NotesDive updates"}
            </strong>
            <button
              className="icon-button"
              aria-label="Close updates"
              onClick={() => {
                setExpanded(false);
                trigger.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          </div>
          <p>
            You’re using version {version}
            {import.meta.env.DEV ? " (development)" : ""}.
          </p>
          <div role="status">
            {checking ? (
              <p>Checking for updates…</p>
            ) : result?.error ? (
              <p className="update-error">{result.error}</p>
            ) : result?.checkedAt && !release ? (
              <p>You’re up to date.</p>
            ) : null}
          </div>
          {release && (
            <>
              <p>A new version is ready. Download it to update NotesDive.</p>
              <div className="update-actions">
                <button
                  className="update-download"
                  onClick={() => void open("download")}
                >
                  <Download size={14} /> Download {release.version}
                </button>
                <button onClick={() => void open("notes")}>
                  What’s new <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
          {openError && (
            <p role="alert" className="update-error">
              {openError}
            </p>
          )}
          <div className="update-panel-footer">
            <button
              disabled={!desktop || checking}
              onClick={() => void check()}
            >
              <RefreshCw size={13} className={checking ? "spin" : ""} /> Check
              for updates
            </button>
            <small>
              {result?.checkedAt
                ? `Last checked ${new Date(result.checkedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`
                : "Not checked yet"}
            </small>
          </div>
        </section>
      )}
    </div>
  );
}
