import config from "../release-config.json";

export const RELEASES_URL = `https://github.com/${config.repository}/releases`;

export const RELEASE_URL = `https://api.github.com/repos/${config.repository}/releases/latest`;
export const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
export interface Release {
  version: string;
  platform: string;
  download: string;
  notes: string;
}
export interface UpdateResult {
  release: Release | null;
  checkedAt: number | null;
  error: string | null;
}
type Cache = UpdateResult & { attemptedAt: number };
const parts = (version: string) => {
  if (version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
  const numbers = version.split(".").map(Number);
  return numbers.every((part) => Number.isSafeInteger(part) && part <= 0xffffffff) ? numbers : null;
};
export function newerVersion(candidate: string, current: string) {
  const a = parts(candidate),
    b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
export function validateRelease(value: unknown): Release {
  if (!value || typeof value !== "object")
    throw new Error("Invalid release information");
  const data = value as Record<string, unknown>;
  if (
    typeof data.version !== "string" ||
    !parts(data.version) ||
    data.platform !== "darwin-aarch64" ||
    data.download !== `${RELEASES_URL}/download/v${data.version}/${config.asset}` ||
    data.notes !== `${RELEASES_URL}/tag/v${data.version}`
  )
    throw new Error("Invalid release information");
  return {
    version: data.version,
    platform: data.platform,
    download: data.download,
    notes: data.notes,
  };
}

/** GitHub metadata is accepted only for a complete stable release of this app. */
export function parseGitHubRelease(value: unknown): Release {
  if (!value || typeof value !== "object") throw new Error("Invalid GitHub release");
  const data = value as Record<string, unknown>;
  if (data.draft !== false || data.prerelease !== false ||
      typeof data.tag_name !== "string" || !data.tag_name.startsWith("v") ||
      !Array.isArray(data.assets)) throw new Error("Invalid GitHub release");
  const version = data.tag_name.slice(1);
  const download = `${RELEASES_URL}/download/v${version}/${config.asset}`;
  const assets = data.assets.filter((asset: Record<string, unknown> | null) =>
    asset && asset.name === config.asset && asset.state === "uploaded" &&
    typeof asset.size === "number" && asset.size > 0 &&
    asset.browser_download_url === download);
  if (assets.length !== 1) throw new Error("Release installer is unavailable");
  return validateRelease({ version, platform: "darwin-aarch64", download, notes: data.html_url });
}

/** Only public release metadata is requested; notes and workspace paths stay local. */
export class UpdateClient {
  private pending: Promise<UpdateResult> | null = null;
  private cache: Cache | null = null;
  private key: string;
  constructor(
    private version: string,
    private platform: string,
    private storage: Pick<Storage, "getItem" | "setItem"> | null,
    private request: typeof fetch = (input, init) => fetch(input, init),
    private now: () => number = Date.now,
  ) {
    this.key = `notesdive:update:${RELEASE_URL}:${version}:${platform}`;
    try {
      const saved = JSON.parse(storage?.getItem(this.key) || "null");
      if (
        saved &&
        Number.isFinite(saved.attemptedAt) &&
        (saved.checkedAt === null || Number.isFinite(saved.checkedAt)) &&
        (saved.error === null || typeof saved.error === "string")
      ) {
        this.cache = {
          ...saved,
          release:
            saved.release === null ? null : validateRelease(saved.release),
        };
      }
    } catch {
      /* A missing or corrupt cache must never prevent opening the app. */
    }
  }
  check(force = false): Promise<UpdateResult> {
    if (this.pending) return this.pending;
    if (this.platform !== "darwin-aarch64")
      return Promise.resolve({
        release: null,
        checkedAt: null,
        error: "Update checks are currently available for macOS Apple Silicon.",
      });
    const age = this.cache ? this.now() - this.cache.attemptedAt : -1;
    if (!force && this.cache && age >= 0 && age < CHECK_INTERVAL)
      return Promise.resolve(this.cache);
    this.pending = this.fetchRelease().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async fetchRelease(): Promise<UpdateResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let result: UpdateResult;
    try {
      const response = await this.request(RELEASE_URL, {
        signal: controller.signal,
        credentials: "omit",
        cache: "no-cache",
        referrerPolicy: "no-referrer",
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error("Release information is unavailable");
      const release = parseGitHubRelease(await response.json());
      result = {
        release:
          release.platform === this.platform &&
          newerVersion(release.version, this.version)
            ? release
            : null,
        checkedAt: this.now(),
        error: null,
      };
    } catch {
      result = {
        release: this.cache?.release ?? null,
        checkedAt: this.cache?.checkedAt ?? null,
        error:
          "Could not check for updates. Check your connection and try again.",
      };
    } finally {
      clearTimeout(timeout);
    }
    this.cache = { ...result, attemptedAt: this.now() };
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.cache));
    } catch {
      /* Storage may be unavailable. */
    }
    return result;
  }
}
