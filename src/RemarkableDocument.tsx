import { useEffect, useState } from "react";
import { remarkableApi, type RemarkableDetail } from "./remarkable";
import { RemarkableViewer } from "./RemarkableViewer";

export function RemarkableDocument({ id, name, page, exportTarget }: { id: string; name: string; page?: number; exportTarget?: HTMLElement | null }) {
  const [detail, setDetail] = useState<RemarkableDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true; setDetail(null); setError("");
    void remarkableApi.detail(id).then((next) => { if (alive) setDetail(next); })
      .catch((cause) => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [id, retry]);
  if (error) return <div className="asset-message" role="alert"><p>{error}</p><button className="quiet-button" onClick={() => setRetry((n) => n + 1)}>Retry reMarkable document</button></div>;
  return detail ? <RemarkableViewer key={`${id}:${page ?? 1}`} id={id} name={name} detail={detail} initialPage={page} exportTarget={exportTarget} />
    : <p className="asset-message" role="status">Loading reMarkable document…</p>;
}
