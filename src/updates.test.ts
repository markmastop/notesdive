import { describe, expect, it, vi } from "vitest";
import {
  CHECK_INTERVAL,
  RELEASE_URL,
  UpdateClient,
  newerVersion,
  validateRelease,
  parseGitHubRelease,
  RELEASES_URL,
} from "./updates";
import config from "../release-config.json";
const release = {
  version: "0.9.0",
  platform: "darwin-aarch64",
  download: `${RELEASES_URL}/download/v0.9.0/${config.asset}`,
  notes: `${RELEASES_URL}/tag/v0.9.0`,
};
const githubRelease = {
  tag_name: "v0.9.0", draft: false, prerelease: false, html_url: release.notes,
  assets: [{ name: config.asset, state: "uploaded", size: 100, browser_download_url: release.download }],
};
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

describe("release checks", () => {
  it("compares stable versions numerically and never offers a downgrade or prerelease", () => {
    expect(newerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(newerVersion("1.0.0", "0.99.99")).toBe(true);
    for (const version of [
      "0.8.0",
      "0.7.9",
      "0.9.0-beta.1",
      "01.0.0",
      "invalid",
      "0.10.0\n",
      "999999999999.0.0",
    ])
      expect(newerVersion(version, "0.8.0")).toBe(false);
  });
  it("rejects malformed manifests and unexpected download destinations", () => {
    expect(validateRelease(release)).toEqual(release);
    for (const value of [
      null,
      {},
      { ...release, download: "https://other.example/app.dmg" },
      { ...release, platform: "windows-x64" },
      { ...release, notes: "javascript:alert(1)" },
    ])
      expect(() => validateRelease(value)).toThrow();
  });
  it("requires a complete stable GitHub release with the matching installer", () => {
    expect(parseGitHubRelease(githubRelease)).toEqual(release);
    for (const value of [
      null, {},
      { ...githubRelease, draft: true },
      { ...githubRelease, prerelease: true },
      { ...githubRelease, tag_name: "v0.9.0-beta.1" },
      { ...githubRelease, tag_name: "0.9.0" },
      { ...githubRelease, tag_name: "v0.10.0" },
      { ...githubRelease, html_url: "https://other.example/release" },
      { ...githubRelease, assets: [] },
      { ...githubRelease, assets: [null] },
      { ...githubRelease, assets: [githubRelease.assets[0], githubRelease.assets[0]] },
      ...[
        { state: "new" }, { size: 0 }, { name: "windows.exe" },
        { browser_download_url: "https://other.example/app.dmg" },
      ].map((change) => ({ ...githubRelease, assets: [{ ...githubRelease.assets[0], ...change }] })),
    ]) expect(() => parseGitHubRelease(value)).toThrow();
  });
  it("treats missing/private releases and API rate limits as unavailable", async () => {
    for (const status of [404, 403, 429]) {
      const client = new UpdateClient("0.8.0", "darwin-aarch64", null,
        async () => new Response("{}", { status }));
      const result = await client.check();
      expect(result.release).toBeNull();
      expect(result.checkedAt).toBeNull();
      expect(result.error).toContain("Could not check");
    }
  });
  it("deduplicates concurrent checks, persists the result, and permits manual refresh", async () => {
    const saved = storage();
    let time = 1000;
    const request = vi.fn(
      async () => new Response(JSON.stringify(githubRelease)),
    ) as unknown as typeof fetch;
    const client = new UpdateClient(
      "0.8.0",
      "darwin-aarch64",
      saved,
      request,
      () => time,
    );
    const first = client.check();
    expect(client.check()).toBe(first);
    expect((await first).release?.version).toBe("0.9.0");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      RELEASE_URL,
      expect.objectContaining({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
    const restarted = new UpdateClient(
      "0.8.0",
      "darwin-aarch64",
      saved,
      request,
      () => time,
    );
    await restarted.check();
    expect(request).toHaveBeenCalledTimes(1);
    await restarted.check(true);
    expect(request).toHaveBeenCalledTimes(2);
    time += CHECK_INTERVAL;
    await restarted.check();
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("handles offline and malformed responses without claiming the app is up to date", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(githubRelease)))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("not JSON"));
    const client = new UpdateClient(
      "0.8.0",
      "darwin-aarch64",
      storage(),
      request,
      () => 1000,
    );
    await client.check();
    const failed = await client.check(true);
    expect(failed.release).toEqual(release);
    expect(failed.checkedAt).toBe(1000);
    expect(failed.error).toContain("Could not check");
    expect((await client.check(true)).error).toContain("Could not check");
  });
  it("suppresses unsupported platforms and clears the badge when the published version is not newer", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(githubRelease)));
    const unsupported = new UpdateClient(
      "0.8.0",
      "windows-x86_64",
      null,
      request,
    );
    expect((await unsupported.check()).release).toBeNull();
    expect(request).not.toHaveBeenCalled();
    const current = new UpdateClient("0.9.0", "darwin-aarch64", null, request);
    expect((await current.check()).release).toBeNull();
  });
  it("works when storage is blocked and does not reuse corrupt cache data", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(githubRelease)));
    const client = new UpdateClient(
      "0.8.0",
      "darwin-aarch64",
      {
        getItem: () => "invalid",
        setItem: () => {
          throw new Error("blocked");
        },
      },
      request,
    );
    expect((await client.check()).release).toEqual(release);
  });
});
