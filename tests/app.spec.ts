import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
const appPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const rmFixture = readFileSync(new URL("./fixtures/remarkable/v5-sample.rm", import.meta.url)).toString("base64");
import { createPresentation, addBlankSlide, addSlideTextBox, inches, savePresentation } from "@office-kit/pptx";

const githubRelease = (version: string) => ({
  tag_name: `v${version}`, draft: false, prerelease: false,
  html_url: `https://github.com/markmastop/notesdive/releases/tag/v${version}`,
  assets: [{ name: "NotesDive-macOS-Apple-Silicon.dmg", state: "uploaded", size: 100,
    browser_download_url: `https://github.com/markmastop/notesdive/releases/download/v${version}/NotesDive-macOS-Apple-Silicon.dmg` }],
});
test.beforeEach(async ({ page }) => {
  await page.route("https://api.github.com/repos/markmastop/notesdive/releases/latest", (route) => route.fulfill({
    json: githubRelease("0.8.0"),
    headers: { "Access-Control-Allow-Origin": "*" },
  }));
  // Exercise the real React/CodeMirror UI against a deterministic Tauri IPC mock.
  await page.addInitScript((rmFixture) => {
    const files: Record<string, string> = {
      "Welcome.md":
        "# A little room to think\n\nYour notes live right here, in your own folder.\n\n## Start somewhere small\n\n- Capture a passing thought\n- Make space for an idea\n- Follow your curiosity\n\n> Good ideas need somewhere to land.\n",
      "Ideas/A quieter workspace.md":
        "# A quieter workspace\n\nLess noise. More focus.\n",
      "Ideas/Weekend reading.md":
        "# Weekend reading\n\nFind a book about the ocean.\n",
    };
    const secondFiles: Record<string, string> = { ...files, "Welcome.md": "# Project research\n\n- [ ] Compare the sources\n", "Research.md": "# Research\n\nA cross-folder discovery.\n" };
    const dates: Record<string, number> = {};
    const directories: Record<string, string[]> = {};
    const unavailable = new Set<string>();
    let failSave = false;
    const scans = { lists: 0, reads: 0, paused: false, releases: [] as (() => void)[] };
    const fullscreen = { active: false, fail: false, delay: false, finish: null as null | (() => void), calls: [] as boolean[] };
    let projects = JSON.parse(localStorage.getItem("test-projects") || '{"active":null,"projects":[],"library":null,"revision":"legacy"}');
    let libraries = JSON.parse(localStorage.getItem("test-libraries") || '{"active":null,"libraries":[],"legacyProjects":0}');
    let libraryProjects = JSON.parse(localStorage.getItem("test-library-projects") || '{}');
    let nextLibrary: string | null = null;
    let cancelLibraryPicker = false;
    let cancelFolderPicker = false;
    const libraryFiles: Record<string, Record<string, string>> = {};
    const themeFolders = new Set<string>();
    const persistLibraries = () => {
      localStorage.setItem("test-libraries", JSON.stringify(libraries));
      localStorage.setItem("test-library-projects", JSON.stringify(libraryProjects));
    };
    const currentProjects = () => libraries.active ? libraryProjects[libraries.active] : projects;
    const provision = (config: any) => {
      for (const project of config.projects) {
        const home = `${config.library}/projects/${project.id}`;
        if (!project.folders.includes(home)) project.folders.unshift(home);
        project.defaultFolder ??= home;
      }
      return config;
    };
    const remarkable = {
      fileType: "notebook", pageData: [rmFixture, rmFixture, null, rmFixture] as (string | null)[], pdfData: "", failPreview: false, slowId: "", finishPreview: null as null | (() => void), connected: false, pauseList: false, finishList: null as null | (() => void), failAfterProgress: false, failList: false, failDetail: false, calls: [] as string[],
      items: [
        { id: "work", parent: "", name: "Work", isFolder: true, modified: null, pinned: false },
        { id: "empty", parent: "", name: "Empty", isFolder: true, modified: null, pinned: false },
        { id: "meetings", parent: "work", name: "Meetings", isFolder: true, modified: null, pinned: false },
        { id: "note", parent: "work", name: "Weekly notes", isFolder: false, modified: 1790900000000, pinned: true },
        { id: "duplicate", parent: "meetings", name: "Weekly notes", isFolder: false, modified: null, pinned: false },
        { id: "inbox", parent: "", name: "Quick sheets", isFolder: false, modified: null, pinned: false },
      ],
    };
    let id = 0;
    const callbacks: Record<number, (event: unknown) => void> = {};
    const events: Record<string, number[]> = {};
    const folder = { path: "/test/Fieldnotes", name: "Fieldnotes" };
    const secondFolder = { path: "/test/Projects", name: "Projects" };
    let activeFolder: typeof folder | null = folder;
    let folders = [folder];
    let finderFiles: { id: string; path: string }[] = [];
    let finderSeeded = false;
    const disk = (root: string) => root === secondFolder.path ? secondFiles : root.startsWith("/test/libraries/") ? (libraryFiles[root] ??= { "README.md": "# Project overview", "Links.md": "# Links" }) : files;
    const read = (path: string, root = folder.path) => {
      const source = disk(root);
      if (!(path in source)) throw new Error("File not found");
      return { path, content: source[path], revision: source[path] };
    };
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: (cb: (event: unknown) => void) => {
          callbacks[++id] = cb;
          return id;
        },
        unregisterCallback: (n: number) => {
          delete callbacks[n];
        },
        invoke: async (
          command: string,
          args: Record<string, string | number> = {},
        ) => {
          if (command === "plugin:window|is_fullscreen") return fullscreen.active;
          if (command === "plugin:window|set_fullscreen") {
            if (fullscreen.fail) throw "Fullscreen unavailable";
            if (args.value && fullscreen.delay) await new Promise<void>((resolve) => { fullscreen.finish = resolve; });
            fullscreen.active = !!args.value;
            fullscreen.calls.push(fullscreen.active);
            return;
          }
          if (command.startsWith("remarkable_")) {
            remarkable.calls.push(command + (args.id ? `:${args.id}` : "") + (command === "remarkable_preview" ? `:${args.page}` : ""));
            if (command === "remarkable_status") return remarkable.connected;
            if (command === "remarkable_pair") {
              if (args.code !== "abcdefgh") throw "Invalid pairing code";
              remarkable.connected = true; return;
            }
            if (command === "remarkable_disconnect") { remarkable.connected = false; return; }
            if (command === "remarkable_list") {
              if (remarkable.pauseList) {
                const channel = args.onProgress as any;
                callbacks[channel.id]({ index: 0, message: { items: structuredClone(remarkable.items.slice(0, 4)), loaded: 4, total: 6 } });
                await new Promise<void>((resolve) => { remarkable.finishList = resolve; });
                callbacks[channel.id]({ index: 1, end: true });
                if (remarkable.failAfterProgress) throw "Scan interrupted";
              }
              if (remarkable.failList) throw "Could not reach reMarkable Cloud. Check your internet connection.";
              return { items: structuredClone(remarkable.items), warnings: [] };
            }
            if (command === "remarkable_detail") {
              if (remarkable.failDetail) throw "Document details unavailable";
              const count = args.id === "note" ? 4 : 2;
              return { fileType: remarkable.fileType, pageCount: count, orientation: "portrait", pages: Array.from({ length: count }, (_, index) => `page-${index}`) };
            }
            if (command === "remarkable_preview") {
              if (args.id === remarkable.slowId) await new Promise<void>((resolve) => { remarkable.finishPreview = resolve; });
              if (remarkable.failPreview) throw "Preview unavailable";
              if (args.page === null) return { mime: remarkable.fileType === "epub" ? "application/epub+zip" : "application/pdf", data: remarkable.pdfData };
              return { mime: "application/x-remarkable", data: remarkable.pageData[Number(args.page)] };
            }
          }
          if (command === "save_pdf") { (window as any).__test.exportedPdf = args; return `/test/${args.filename}`; }
          if (command === "update_platform") return "darwin-aarch64";
          if (command === "open_web_link") { (window as any).__test.openedWebLink = args.url; return; }
          if (command === "open_release_page") { (window as any).__test.openedReleasePage = args.page; (window as any).__test.openedReleaseVersion = args.version; return; }
          if (["list_notes", "list_project_notes", "list_known_notes"].includes(command)) {
            scans.lists++;
            if (scans.paused) await new Promise<void>((resolve) => scans.releases.push(resolve));
          }
          if (["read_note", "read_project_note", "read_known_note"].includes(command)) scans.reads++;
          const path = String(args.path || "");
          const root = String(args.folder || activeFolder?.path || folder.path);
          const source = disk(root);
          if (command === "pending_finder_files") {
            if (!finderSeeded) {
              finderFiles.unshift(...JSON.parse(localStorage.getItem("test-finder-files") || "[]"));
              finderSeeded = true;
            }
            return finderFiles;
          }
          if (command === "open_finder_file") {
            const request = finderFiles.find((request) => request.id === args.id);
            if (!request) throw "File-open request expired";
            finderFiles = finderFiles.filter((request) => request.id !== args.id);
            const note = read(request.path, secondFolder.path);
            activeFolder = secondFolder;
            if (!folders.some((item) => item.path === secondFolder.path)) folders.push(secondFolder);
            return { folder: secondFolder, note };
          }
          if (command === "document_action") {
            if (args.action === "reveal") return path;
            if (args.action === "rename") {
              const next = path.split("/").slice(0, -1).concat(String(args.name)).join("/");
              if (next in source) throw "Name already exists";
              source[next] = source[path]; delete source[path]; return next;
            }
            if (args.action === "trash") { (window as any).__test.trashed = { root, path, content: source[path] }; delete source[path]; return "trash-token"; }
            if (args.action === "restore") { const item = (window as any).__test.trashed; disk(item.root)[item.path] = item.content; return item.path; }
          }

          if (command === "list_libraries") return { ...libraries, legacyProjects: projects.projects.length, libraries: libraries.libraries.map((library: any) => ({ ...library, available: !unavailable.has(library.path) })) };
          if (command === "choose_library") {
            if (cancelLibraryPicker) { cancelLibraryPicker = false; return false; }
            const name = args.name ? String(args.name) : null;
            const path = name ? `/test/libraries/${name}` : nextLibrary;
            if (!path) return false;
            if (name && libraryProjects[path]) throw "That folder already exists";
            if (name) themeFolders.add(path);
            if (name) libraryProjects[path] = { active: null, projects: [], library: path, revision: "0", name };
            if (!libraryProjects[path]) throw "Choose a NotesDive library";
            if (!libraries.libraries.some((library: any) => library.path === path)) libraries.libraries.push({ path, name: libraryProjects[path].name, available: true });
            libraries.active = path; persistLibraries(); return true;
          }
          if (command === "switch_library") {
            if (unavailable.has(path)) throw "Library unavailable";
            libraries.active = args.path || null; persistLibraries(); return;
          }
          if (command === "forget_library") {
            libraries.libraries = libraries.libraries.filter((library: any) => library.path !== path);
            if (libraries.active === path) libraries.active = null;
            persistLibraries(); return;
          }
          if (command === "load_projects") {
            if (localStorage.getItem("test-slow-projects")) await new Promise((resolve) => setTimeout(resolve, 250));
            if (unavailable.has(libraries.active)) throw "Library unavailable. Open it again at its current location.";
            return structuredClone(currentProjects());
          }
          if (command === "save_projects") {
            const incoming = structuredClone(args.config) as any;
            if ((incoming.library ?? null) !== libraries.active || incoming.revision !== currentProjects().revision) throw "Project metadata changed on disk. Reload Projects before saving.";
            if (libraries.active) {
              const old = currentProjects();
              for (const project of incoming.projects) {
                if (!old.projects.some((p: any) => p.id === project.id)) provision({ library: libraries.active, projects: [project] });
              }
              libraryProjects[libraries.active] = { ...incoming, name: old.name, revision: String(Number(old.revision) + 1) };
              persistLibraries(); return structuredClone(currentProjects());
            }
            projects = incoming;
            localStorage.setItem("test-projects", JSON.stringify(projects));
            return projects;
          }
          if (command === "import_legacy_projects") {
            const config = currentProjects();
            for (const project of projects.projects) if (!config.projects.some((p: any) => p.id === project.id)) config.projects.push(structuredClone(project));
            provision(config); config.revision = String(Number(config.revision) + 1); persistLibraries(); return config;
          }
          if (["list_project_notes", "read_project_note"].includes(command) && (args.library ?? null) !== libraries.active) throw "The library changed";
          if (command === "choose_project_folder") { if (!folders.some((item) => item.path === secondFolder.path)) folders.push(secondFolder); return secondFolder; }
          if (["list_project_notes", "read_project_note", "list_known_notes", "read_known_note", "switch_workspace"].includes(command) && unavailable.has(command === "switch_workspace" ? path : root)) throw "Folder unavailable";
          if (command === "restore_workspace")
            return activeFolder;
          if (command === "choose_workspace") {
            if (cancelFolderPicker) { cancelFolderPicker = false; return null; }
            activeFolder = folder;
            folders = [folder, ...folders.filter((item) => item.path !== folder.path)];
            return folder;
          }
          if (command === "list_workspaces") return folders;
          if (command === "switch_workspace") {
            activeFolder = folders.find((item) => item.path === path) ?? { path, name: path.split("/").pop()! };
            folders = [activeFolder, ...folders.filter((item) => item.path !== activeFolder?.path)];
            return activeFolder;
          }
          if (command === "forget_workspace") {
            folders = folders.filter((item) => item.path !== path);
            if (activeFolder?.path === path) activeFolder = null;
            return folders;
          }
          if (command === "list_notes" || command === "list_project_notes" || command === "list_known_notes")
            return {
              directories: directories[root] ?? [],
              entries: Object.keys(source)
                .filter((p) =>
                  (p + (/\.(md|markdown)$/i.test(p) ? source[p] : ""))
                    .toLowerCase()
                    .includes(String(args.query).toLowerCase()),
                )
                .map((p) => ({
                  path: p,
                  name: p.split("/").pop(),
                  modified: dates[p] ?? 0,
                  snippet: String(args.query) && /\.(md|markdown)$/i.test(p)
                    ? source[p]
                        .split("\n")
                        .find((l) =>
                          l
                            .toLowerCase()
                            .includes(String(args.query).toLowerCase()),
                        )
                    : null,
                })),
              warnings: [],
            };
          if (command === "read_note" || command === "read_project_note" || command === "read_known_note") return read(path, root);
          if (command === "save_clipboard_image") {
            if (failSave) throw "Disk is read-only";
            const imagePath = "image-test.png";
            const parent = String(args.notePath).split("/").slice(0, -1).join("/");
            source[(parent ? parent + "/" : "") + imagePath] = atob(String(args.data));
            return imagePath;
          }
          if (command === "library_themes") {
            const library = String(args.library);
            if (library !== libraries.active) throw "Library changed";
            if (args.create) themeFolders.add(library);
            const themes = Object.keys(libraryFiles[library] || {}).filter((path) => /^themes\/[a-z\d_-]+\.css$/i.test(path)).map((path) => path.slice(7, -4)).sort();
            return { path: `${library}/themes`, exists: themeFolders.has(library), themes };
          }
          if (command === "read_library_marp_theme") {
            const css = libraryFiles[String(args.library)]?.[`themes/${args.name}.css`];
            if (args.library !== libraries.active) throw "Library changed";
            if (!css) throw `Theme file not found: themes/${args.name}.css`;
            return css;
          }
          if (command === "read_library_marp_image") {
            const image = libraryFiles[String(args.library)]?.[path];
            if (!image || args.library !== libraries.active || !path.startsWith("themes/")) throw "Theme image not found";
            return { path, mime: /\.svg$/i.test(path) ? "image/svg+xml" : /\.png$/i.test(path) ? "image/png" : "image/jpeg", data: btoa(image) };
          }
          if (command === "read_marp_theme") {
            if (!(path in source)) throw `Theme file not found: ${path}`;
            return source[path];
          }
          if (command === "read_asset") {
            if (!(path in source)) throw "File not found";
            const mime = /\.epub$/i.test(path) ? "application/epub+zip" : /\.pdf$/i.test(path) ? "application/pdf" : /\.svg$/i.test(path) ? "image/svg+xml" : /\.png$/i.test(path) ? "image/png" : /\.html?$/i.test(path) ? "text/html" : /\.docx$/i.test(path) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : /\.pptx$/i.test(path) ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : /\.txt$/i.test(path) ? "text/plain" : "image/jpeg";
            return { path, mime, data: btoa(source[path]) };
          }
          if (command === "save_note") {
            if (failSave) throw "Disk is read-only";
            if (args.revision !== source[path])
              throw "CONFLICT: Changed outside NotesDive";
            source[path] = String(args.content);
            return read(path, root);
          }
          if (command === "create_note") {
            if (path in source) throw "File already exists";
            source[path] = String(args.content);
            return read(path, root);
          }
          if (command === "plugin:event|listen") {
            (events[String(args.event)] ??= []).push(Number(args.handler));
            return ++id;
          }
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __test: {
        directories,
        scans,
        fullscreen,
        cancelFolderPicker: () => { cancelFolderPicker = true; },
        addFolder: () => { if (!folders.some((item) => item.path === secondFolder.path)) folders.push(secondFolder); },
        clearFolders: () => { folders = []; activeFolder = null; },
        remarkable,
        files,
        secondFiles,
        libraryFiles,
        themeFolders,
        unavailable,
        pickLibrary: (path: string) => { nextLibrary = path; },
        cancelLibraryPicker: () => { cancelLibraryPicker = true; },
        setLegacy: () => {
          projects = { active: "legacy-project", library: null, revision: "legacy", projects: [{ id: "legacy-project", name: "Older work", description: "Original setup", color: "sage", pinned: false, archived: false, folders: [folder.path], defaultFolder: folder.path }] };
          localStorage.setItem("test-projects", JSON.stringify(projects));
        },
        changeProjectMetadata: () => { const config = currentProjects(); config.projects[0].name = "Changed on disk"; config.revision = String(Number(config.revision) + 1); persistLibraries(); },
        failSave: (value: boolean) => { failSave = value; },
        finderOpen: (path: string) => {
          finderFiles.push({ id: `finder-${++id}`, path });
          (events["finder-files-ready"] || []).forEach((n) => callbacks[n]?.({ event: "finder-files-ready", id: n, payload: null }));
        },
        dates,
        external: (path: string, content: string) => {
          files[path] = content;
          (events["todo-changed"] || []).forEach((n) =>
            callbacks[n]?.({
              event: "todo-changed",
              id: n,
              payload: {
                folder: activeFolder?.path ?? folder.path,
                paths: [`${activeFolder?.path ?? folder.path}/${path}`],
              },
            }),
          );
          (events["notes-changed"] || []).forEach((n) =>
            callbacks[n]?.({
              event: "notes-changed",
              id: n,
              payload: activeFolder?.path ?? folder.path,
            }),
          );
        },
      },
    });
  }, rmFixture);
});

test("Home keeps folder shortcuts in Settings without deleting notes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as any).__test.addFolder());
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("region", { name: "Home", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage folders" }).click();
  const folders = page.getByRole("region", { name: "Notes folders" });
  await expect(folders.getByRole("button", { name: /Projects \/test\/Projects/ })).toBeVisible();
  await folders.getByRole("button", { name: /Projects \/test\/Projects/ }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("region", { name: "Continue working" })).toContainText("Research");
  await page.getByRole("button", { name: "Manage folders" }).click();
  await folders.getByRole("button", { name: "Remove Fieldnotes from NotesDive" }).click();
  await expect(folders.getByRole("button", { name: "Remove Fieldnotes from NotesDive" })).toHaveCount(0);
  await folders.getByRole("button", { name: "Remove Projects from NotesDive" }).click();
  await expect(folders.getByRole("button", { name: "Remove Projects from NotesDive" })).toHaveCount(0);
  await folders.getByRole("button", { name: "Add folder" }).click();
  await expect(folders.getByRole("button", { name: "Remove Fieldnotes from NotesDive" })).toBeVisible();
  expect(await page.evaluate(() => Object.keys((window as any).__test.files).length)).toBe(3);
});

function samplePdf() {
  const stream = "BT /F1 22 Tf 72 700 Td (NotesDive PDF) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return pdf;
}

test("views a local PDF, SVG and PNG without adding them to Todos", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((pdf) => {
    const app = (window as any).__test;
    app.external("sample.pdf", pdf);
    app.external("diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#366754"/></svg>');
    app.external("pixel.png", atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XZD8AAAAASUVORK5CYII="));
    const canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    canvas.getContext("2d")!.fillRect(0, 0, 10, 10);
    app.external("photo.jpg", atob(canvas.toDataURL("image/jpeg").split(",")[1]));
  }, samplePdf());
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "diagram.svg", exact: true }).click();
  await expect(page.getByRole("img", { name: "diagram.svg", exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole("img", { name: "diagram.svg", exact: true }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "pixel.png", exact: true }).click();
  await expect.poll(() => page.getByRole("img", { name: "pixel.png", exact: true }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "photo.jpg", exact: true }).click();
  await expect.poll(() => page.getByRole("img", { name: "photo.jpg", exact: true }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "sample.pdf", exact: true }).click();
  await expect(page.getByText("Page 1 of 1")).toBeVisible();
  await expect.poll(() => page.locator('canvas[aria-label="PDF page 1"]').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/pdf-viewer.png" });
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(page.locator(".todo-page .heading-count")).toHaveAttribute("title", "3 source documents checked");
});

test("HTML links open sibling documents, browser URLs and page anchors without running document scripts", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = "script-src 'self'";
    document.head.append(policy);
    const app = (window as any).__test;
    app.external("Demo/index.html", `<base href="https://wrong.invalid/"><meta http-equiv="refresh" content="0;url=https://wrong.invalid/">
      <h1>Curriculum</h1><a href="Year%202.html#details" target="_blank"><span>Year 2</span></a>
      <a href="#bottom">Jump down</a><a href="https://example.com/curriculum">Website</a>
      <a href="../../outside.html">Outside root</a><a href="missing.html">Missing document</a>
      <a href="javascript:parent.document.body.dataset.htmlScript='ran'">Unsafe link</a>
      <script>parent.document.body.dataset.htmlScript='ran'</script>
      <img src="https://wrong.invalid/tracker" onerror="parent.document.body.dataset.htmlScript='ran'">
      <div style="height:1500px"></div><h2 id="bottom">Bottom section</h2>`);
    app.external("Demo/Year 2.html", '<h1>Second year</h1><a href="../Planning.md">Planning</a><div style="height:1500px"></div><h2 id="details">Year details</h2>');
    app.external("Planning.md", '# Linked planning');
  });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "index.html", exact: true }).click();
  const html = page.frameLocator('iframe[title="HTML document"]');
  await expect(html.getByRole("heading", { name: "Curriculum" })).toBeVisible();
  await html.getByRole("link", { name: "Website", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__test.openedWebLink)).toBe("https://example.com/curriculum");
  await html.getByRole("link", { name: "Outside root" }).click();
  await expect(page.getByRole("alert")).toContainText("supported document");
  await html.getByRole("link", { name: "Unsafe link" }).click();
  expect(await page.locator("body").getAttribute("data-html-script")).toBeNull();
  await html.getByRole("link", { name: "Jump down" }).click();
  await expect(html.getByRole("heading", { name: "Bottom section" })).toBeInViewport();
  await html.getByRole("link", { name: "Year 2", exact: true }).click();
  await expect(html.getByRole("heading", { name: "Year details" })).toBeInViewport();
  await expect(page.locator(".notes-reader-path")).toHaveText("Demo/Year 2.html");
  await html.getByRole("link", { name: "Planning", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Linked planning");
  await page.getByRole("button", { name: "index.html", exact: true }).click();
  await html.getByRole("link", { name: "Missing document" }).click();
  await expect(page.getByRole("alert")).toContainText("File not found");
});

test("views isolated HTML, Word and PowerPoint files", async ({ page }, testInfo) => {
  let remoteRequests = 0;
  await page.route("https://pdf-tracker.invalid/**", (route) => { remoteRequests++; return route.abort(); });
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word preview works</w:t></w:r></w:p></w:body></w:document>');
  const headers = ["Organisatie / juridische entiteit", "Subsidiecategorie", "Status en bewijs", "Mkb-status bevestigd?", "Case(s)", "Inhoudelijke subcategorie", "Bijdrage en looptijd"];
  const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word preview works</w:t></w:r></w:p><w:tbl><w:tr>${headers.map(cell).join("")}</w:tr><w:tr>${["Summa", "Kernpartner genoemd in juninotitie", "Actuele registratie te controleren", "Niet van toepassing op kennisinstellingsrol", "[Invullen]", "Onderwijs / uitvoering", "[Invullen]"].map(cell).join("")}</w:tr></w:tbl></w:body></w:document>`);
  const docx = await zip.generateAsync({ type: "uint8array" });
  const presentation = createPresentation();
  const slide = addBlankSlide(presentation);
  addSlideTextBox(slide, { x: inches(1), y: inches(1), w: inches(8), h: inches(1), text: "PowerPoint preview works" });
  const pptx = await savePresentation(presentation);
  await page.goto("/");
  await page.evaluate(({ docx, pptx }) => {
    const app = (window as any).__test;
    app.external("unsafe.html", '<h1>HTML preview works</h1><script>parent.document.body.dataset.htmlScript="ran"</script><img src="https://pdf-tracker.invalid/image.png" onerror="parent.document.body.dataset.htmlScript=\'ran\'">');
    app.external("example.docx", atob(docx));
    app.external("example.pptx", atob(pptx));
  }, { docx: Buffer.from(docx).toString("base64"), pptx: Buffer.from(pptx).toString("base64") });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "unsafe.html", exact: true }).click();
  await expect(page.frameLocator('iframe[title="HTML document"]').getByText("HTML preview works")).toBeVisible();
  expect(await page.locator("body").getAttribute("data-html-script")).toBeNull();
  await page.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true }).click();
  const htmlPdf = await exportedPdf(page);
  expect(htmlPdf.pages[0].text).toContain("HTML preview works");
  expect(htmlPdf.pages[0].text).not.toContain("Refresh file");
  expect(remoteRequests).toBe(0);
  expect(await page.locator("body").getAttribute("data-html-script")).toBeNull();
  await page.evaluate(() => { (window as any).__test.exportedPdf = null; });
  await page.getByRole("button", { name: "example.docx", exact: true }).click();
  await expect(page.frameLocator('iframe[title="Word document"]').getByText("Word preview works")).toBeVisible();
  const word = page.frameLocator('iframe[title="Word document"]');
  await expect(word.getByRole("cell", { name: "Case(s)", exact: true })).toHaveCSS("overflow-wrap", "normal");
  const tableRegion = word.getByRole("region", { name: /Document table/ });
  await expect(tableRegion).toHaveAttribute("tabindex", "0");
  expect(await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const caseCell = word.getByRole("cell", { name: "Case(s)", exact: true });
  expect(await caseCell.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(60);
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const generated = await exportedPdf(page);
  expect(generated.filename).toMatch(/^example_\d{8}\.pdf$/);
  expect(generated.pages[0].width).toBeCloseTo(841.89, 1);
  expect(generated.pages[0].text).toContain("Subsidiecategorie");
  expect(generated.pages[0].text).toContain("Case(s)");
  await writeFile(testInfo.outputPath("generated-word.pdf"), Buffer.from(generated.data, "base64"));


  await page.getByRole("button", { name: "example.pptx", exact: true }).click();
  await expect(page.getByText("Slide 1 of 1")).toBeVisible();
  await expect.poll(() => page.getByRole("img", { name: "Slide 1" }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Show slide grid" }).click();
  await expect(page.getByRole("button", { name: "Open slide 1" })).toBeVisible();
});

test("views TXT as literal read-only text with spacing intact", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as any).__test.external("sample.txt", "Heading\n\tindented  words\n<script>window.evil = true</script>"));
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "sample.txt", exact: true }).click();
  const viewer = page.getByLabel("Text viewer");
  await expect(viewer.locator("pre")).toHaveText("Heading\n\tindented  words\n<script>window.evil = true</script>");
  expect(await page.evaluate(() => (window as any).evil)).toBeUndefined();
  await expect(viewer.locator("script")).toHaveCount(0);
});

test("shows task dates, priorities and tags with due filters", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const format = (offset: number) => { const day = new Date(); day.setDate(day.getDate() + offset); return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`; };
    (window as any).__test.external("Schedule.md", `- [ ] Late report due:${format(-1)} priority:high #work\n- [ ] Today's meeting due:${format(0)} priority:low\n- [ ] Future task due:${format(2)}\n- [ ] Undated task\n`);
  });
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(page.getByText("Late report", { exact: true })).toBeVisible();
  await expect(page.locator(".task-results .todo-metadata .overdue")).toHaveCount(1);
  await expect(page.locator(".task-results").getByText("high priority", { exact: true })).toBeVisible();
  await page.getByLabel("Filter by due date").selectOption("overdue");
  await expect(page.getByText("Late report", { exact: true })).toBeVisible();
  await expect(page.getByText("Future task", { exact: true })).toHaveCount(0);
  await page.getByLabel("Filter by due date").selectOption("undated");
  await expect(page.getByText("Undated task", { exact: true })).toBeVisible();
});

test("open, edit, autosave, preview, search and create a note", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toContainText("A little room to think");
  await editor.fill("# A fresh idea\n\nSomething about the ocean.");
  await expect(page.getByRole("button", { name: "Save note" })).toContainText(
    "Unsaved",
  );
  await expect(page.getByRole("button", { name: "Save note" })).toContainText(
    "Saved",
  );
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(
    page
      .getByRole("region", { name: "Markdown preview" })
      .getByRole("heading", { name: "A fresh idea" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search files" }).fill("ocean");
  await expect(
    page.getByRole("button", { name: "Weekend reading", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page.getByLabel("Note name").fill("Ideas/New thought");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(page.locator(".breadcrumb strong")).toHaveText("New thought");
  await expect(editor).toContainText("# New thought");
  expect(errors).toEqual([]);
});

test("watcher updates clean notes and offers copy/reload on conflicts", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as {
        __test: { external: (p: string, c: string) => void };
      }
    ).__test.external("Welcome.md", "# External update"),
  );
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toContainText("External update");
  await editor.fill("# My draft");
  await page.evaluate(() =>
    (
      window as unknown as {
        __test: { external: (p: string, c: string) => void };
      }
    ).__test.external("Welcome.md", "# Another update"),
  );
  await expect(
    page.getByRole("button", { name: "Save a copy", exact: true }),
  ).toBeVisible();
  await expect(editor).toContainText("My draft");
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("My draft");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.getByRole("button", { name: "Save copy", exact: true }).click();
  await expect(page.locator(".breadcrumb strong")).toHaveText("Welcome (copy)");
  await expect(editor).toContainText("My draft");
});

test("workspace layout and preview at desktop and minimum width", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await page.screenshot({ path: "test-results/welcome.png" });
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Visual editor" }),
  ).toBeEditable();
  await page.screenshot({ path: "test-results/visual-reading.png" });
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await page.screenshot({ path: "test-results/editor.png" });
  await page.setViewportSize({ width: 760, height: 520 });
  await expect(page.getByRole("button", { name: "Save note" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/compact.png" });
});

async function replaceFixture(
  page: import("@playwright/test").Page,
  content: string,
) {
  await page.evaluate((content) => {
    (
      window as unknown as { __test: { files: Record<string, string> } }
    ).__test.files["Welcome.md"] = content;
  }, content);
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
}
async function diskContent(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __test: { files: Record<string, string> } })
        .__test.files["Welcome.md"],
  );
}

test("visual mode reads Markdown without rewriting it; source switching is lossless", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  const original =
    "# Read me\n\n**Bold** and *italic*.\n\n*   Original list spacing\n\n> A quote\n\n```ts\nconst answer = 42;\n```\n";
  await replaceFixture(page, original);
  const editor = page.getByRole("textbox", { name: "Visual editor" });
  await expect(editor.getByRole("heading", { name: "Read me" })).toBeVisible();
  await expect(editor.locator("strong")).toHaveText("Bold");
  await expect(editor.locator("em")).toHaveText("italic");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Markdown editor" }),
  ).toContainText("**Bold**");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "Save note" }).click();
  expect(await diskContent(page)).toBe(original);
  expect(errors).toEqual([]);
});

test("visual toolbar formats text, saves Markdown and survives immediate navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await replaceFixture(page, "A new thought\n");
  const editor = page.getByRole("textbox", { name: "Visual editor" });
  await expect(editor).toBeEditable();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("A new thought");
  await page.getByRole("combobox", { name: "Text style" }).selectOption("2");
  await expect(editor.locator("h2")).toContainText("A new thought");
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "A quieter workspace", exact: true })
    .click();
  expect(await diskContent(page)).toMatch(/## \*\*A new thought\*\*/);
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  await expect(editor.locator("h2 strong")).toHaveText("A new thought");
});

test("tables and checkboxes stay editable and metadata, links and code survive", async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("tracker.example")) requests.push(request.url());
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  const prefix = '---\ntitle: "Keep exactly"\ntags: [one, two]\n---\n';
  await replaceFixture(
    page,
    prefix +
      '\n# Plan\n\n- [ ] First task\n- [x] Done\n\n| Item | Status |\n| --- | --- |\n| Notes | Ready |\n\n[Reference](https://example.com)\n\n![Example](https://tracker.example/pixel)\n\n```js title="example.js"\nconst keep = true;\n```\n',
  );
  const editor = page.getByRole("textbox", { name: "Visual editor" });
  await expect(editor.locator("table")).toBeVisible();
  await expect(editor.locator(".image-placeholder")).toContainText("Example");
  await editor.getByRole("checkbox", { name: "Complete task" }).first().check();
  await expect(editor.locator(".image-placeholder")).toContainText("Example");
  const cell = editor.getByRole("cell", { name: "Ready", exact: true });
  await cell.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.type(" today");
  await expect(editor.locator(".image-placeholder")).toContainText("Example");
  await page.getByRole("button", { name: "Save note" }).click();
  const saved = await diskContent(page);
  expect(saved.startsWith(prefix)).toBe(true);
  expect(saved).toContain("[x] First task");
  expect(saved).toContain("Ready today");
  expect(saved).toContain("[Reference](https://example.com)");
  expect(saved).toContain("https://tracker.example/pixel");
  expect(saved).toContain("const keep = true;");
  expect(saved).toContain('title="example.js"');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/visual-editor.png" });
});

test("visual editor follows external updates and protects drafts on conflicts", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await replaceFixture(page, "# Before\n\nOriginal paragraph\n");
  const editor = page.getByRole("textbox", { name: "Visual editor" });
  await expect(editor.locator("h1")).toHaveText("Before");
  await page.evaluate(() =>
    (
      window as unknown as {
        __test: { external: (p: string, c: string) => void };
      }
    ).__test.external("Welcome.md", "# After\n\nExternal paragraph\n"),
  );
  await expect(editor.locator("h1")).toHaveText("After");
  await editor.locator("p").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.type(" My draft");
  await page.evaluate(() =>
    (
      window as unknown as {
        __test: { external: (p: string, c: string) => void };
      }
    ).__test.external("Welcome.md", "# Another edit\n"),
  );
  await expect(
    page.getByRole("button", { name: "Save a copy", exact: true }),
  ).toBeVisible();
  await expect(editor).toContainText("My draft");
  expect(await diskContent(page)).toBe("# Another edit\n");
});

test("unsupported footnotes remain readable and editable in source", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  const original = "A note[^1]\n\n[^1]: Preserve this footnote.\n";
  await replaceFixture(page, original);
  await expect(
    page
      .getByRole("region", { name: "Editor", exact: true })
      .getByRole("status"),
  ).toContainText("footnotes");
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Markdown editor" }),
  ).toContainText("[^1]: Preserve");
  expect(await diskContent(page)).toBe(original);
});

test("visual toolbar can insert links, tasks and tables, with undo and redo", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await replaceFixture(page, "Project plan\n");
  const editor = page.getByRole("textbox", { name: "Visual editor" });
  await expect(editor).toBeEditable();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Insert link", exact: true }).click();
  await page
    .getByLabel("Link", { exact: true })
    .fill("https://example.com/plan");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor.locator(".rich-link")).toHaveText("Project plan");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.locator(".rich-link")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor.locator(".rich-link")).toHaveText("Project plan");
  await editor.locator(".rich-link").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("Next step");
  await page.getByRole("button", { name: "Task list", exact: true }).click();
  await expect(
    editor.getByRole("checkbox", { name: "Complete task" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save note" }).click();
  expect(await diskContent(page)).toContain(
    "[Project plan](https://example.com/plan)",
  );
  expect(await diskContent(page)).toContain("[ ]");
  // Create a table in another clean document to exercise insertion and expansion.
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "A quieter workspace", exact: true })
    .click();
  await expect(editor).toBeEditable();
  await editor.locator("p").click();
  await page.getByRole("button", { name: "Insert table", exact: true }).click();
  await expect(editor.locator("table")).toBeVisible();
  await editor.locator("th").first().click();
  const rowCount = await editor.locator("tr").count();
  await page
    .getByRole("button", { name: "Add table row", exact: true })
    .click();
  await expect(editor.locator("tr")).toHaveCount(rowCount + 1);
});

test("raw HTML stays inert and survives editing elsewhere", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await replaceFixture(
    page,
    '# Safe note\n\nText <span class="example">inside HTML</span>.\n\n<script>window.__unsafe = true;</script>\n',
  );
  const editor = page.getByRole("textbox", { name: "Visual editor" });
  await expect(editor.locator("h1")).toHaveText("Safe note");
  await editor.locator("h1").click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+ArrowRight" : "End",
  );
  await page.keyboard.type(" updated");
  await page.getByRole("button", { name: "Save note" }).click();
  const saved = await diskContent(page);
  expect(saved).toContain('<span class="example">');
  expect(saved).toContain("<script>window.__unsafe = true;</script>");
  expect(
    await page.evaluate(
      () => (window as unknown as { __unsafe?: boolean }).__unsafe,
    ),
  ).toBeUndefined();
});

test("Home, task aggregation, safe toggles and source navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "File folders" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.external(
      "Projects/Planning.md",
      "---\r\ntitle: Planning\r\n---\r\n\r\n# Planning\r\n\r\n- [ ] **Call** the team\r\n  - [ ] Pick a date\r\n- [X] Already done\r\n\r\n```md\r\n- [ ] Example only\r\n```\r\n",
    );
    app.external(
      "Ideas/Weekend reading.md",
      "# Weekend\n\n- [ ] Read a book\n",
    );
  });
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete: Call the team",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByText("Example only", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search tasks" }).fill("weekend");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search tasks" }).fill("");
  await page
    .getByRole("checkbox", { name: "Complete: Call the team", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete: Call the team",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as any).__test.files["Projects/Planning.md"],
    ),
  ).toBe(
    "---\r\ntitle: Planning\r\n---\r\n\r\n# Planning\r\n\r\n- [x] **Call** the team\r\n  - [ ] Pick a date\r\n- [X] Already done\r\n\r\n```md\r\n- [ ] Example only\r\n```\r\n",
  );
  await page.getByRole("button", { name: /Completed/ }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await page
    .getByRole("checkbox", { name: "Reopen: Call the team", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page
    .getByRole("group", { name: "Task filter" })
    .getByRole("button", { name: /^All/ })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  await page.screenshot({
    path: "test-results/todos.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Read a book Line 3", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Visual editor" }),
  ).toContainText("Read a book");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown editor" });
  await source.fill("# Weekend\n\n- [ ] Saved on navigation\n");
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Complete: Saved on navigation",
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).__test.external(
      "Projects/Planning.md",
      "# Replaced\n\n- [ ] External task\n",
    ),
  );
  await expect(
    page.getByRole("checkbox", {
      name: "Complete: External task",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Pick a date", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/home.png",
    animations: "disabled",
  });
});

test("task conflicts preserve external edits and refresh the index", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    (window as any).__test.external("Welcome.md", "- [ ] Original task\n"),
  );
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  const task = page.getByRole("checkbox", {
    name: "Complete: Original task",
    exact: true,
  });
  await expect(task).toBeVisible();
  // Simulate an external writer before the watcher has delivered its event.
  await page.evaluate(() => {
    (window as any).__test.files["Welcome.md"] = "- [ ] External replacement\n";
  });
  await task.click();
  await expect(page.getByRole("alert")).toContainText("This note changed");
  await expect(
    page.getByRole("checkbox", {
      name: "Complete: External replacement",
      exact: true,
    }),
  ).toBeVisible();
  expect(await diskContent(page)).toBe("- [ ] External replacement\n");
  await page
    .getByRole("button", { name: "Refresh tasks", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    delete (window as any).__test.files["Welcome.md"];
  });
  await page
    .getByRole("button", { name: "Refresh tasks", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByText("Nothing left on the list.", { exact: true }),
  ).toBeVisible();
});

test("large task collections stay bounded and can be browsed per document", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const app = (window as any).__test;
    for (let i = 1; i <= 12; i++)
      app.external(
        `Projects/Project ${String(i).padStart(2, "0")}.md`,
        Array.from(
          { length: i === 1 ? 106 : 8 },
          (_, j) => `- [ ] Task ${j + 1} for project ${i}`,
        ).join("\n"),
      );
  });
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(36);
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(36);
  await page.screenshot({
    path: "test-results/todos-documents.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "View all 106 tasks", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(30);
  await page
    .getByRole("button", { name: "Show more · 76 remaining", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(60);
  await page
    .getByRole("navigation", { name: "Task documents" })
    .getByRole("button", { name: /Project 02/ })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(8);
  await expect(page.getByRole("checkbox").first()).toHaveAccessibleName(
    "Complete: Task 1 for project 2",
  );
  await page.getByRole("textbox", { name: "Search tasks" }).fill("Task 106");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search tasks" }).fill("");
  await page.setViewportSize({ width: 760, height: 520 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("navigation", { name: "Task documents" }),
  ).toBeVisible();
});


test("file trees start at roots and reset when reopened", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { (window as any).__test.files["Projects/Research/Deep/Note.md"] = "# Nested note"; });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  const tree = page.getByRole("navigation", { name: "File folders" });
  const root = tree.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true });
  const research = tree.getByRole("button", { name: "Toggle folder Fieldnotes/Projects", exact: true });
  const deep = tree.getByRole("button", { name: "Folder Fieldnotes/Projects/Research", exact: true });
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await expect(research).toHaveCount(0);
  await expect(deep).toHaveCount(0);
  await tree.getByRole("button", { name: "Folder Fieldnotes", exact: true }).click();
  await expect(root).toHaveAttribute("aria-expanded", "true");
  await expect(tree.getByRole("button", { name: "Folder Fieldnotes", exact: true })).toHaveAttribute("aria-current", "page");
  await tree.getByRole("button", { name: "Folder Fieldnotes", exact: true }).click();
  await expect(root).toHaveAttribute("aria-expanded", "true");
  await root.click();
  await expect(research).toHaveCount(0);
  await root.click();
  await expect(research).toHaveAttribute("aria-expanded", "false");
  await expect(deep).toHaveCount(0);
  await research.click();
  await expect(deep).toBeVisible();
  await page.getByRole("button", { name: "Toggle files sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Toggle files sidebar", exact: true }).click();
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await expect(research).toHaveCount(0);
  await root.click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await expect(research).toHaveCount(0);
  await page.evaluate(() => { (window as any).__test.external("Projects/Another/Nested/Note.md", "# New nested note"); });
  await page.getByRole("button", { name: "Refresh files", exact: true }).click();
  await expect(tree.getByRole("button", { name: "Folder Fieldnotes/Projects/Another", exact: true })).toHaveCount(0);
});

test("reMarkable trees start at roots during loading and reset when reopened", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const rm = (window as any).__test.remarkable;
    rm.connected = true; rm.pauseList = true;
    rm.items.push({ id: "archive", parent: "meetings", name: "Archive", isFolder: true, modified: null, pinned: false });
  });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  const tree = page.getByRole("navigation", { name: "reMarkable folders" });
  const root = tree.getByRole("button", { name: "Toggle reMarkable folder Work", exact: true });
  const meetings = tree.getByRole("button", { name: "Toggle reMarkable folder Work / Meetings", exact: true });
  const archive = tree.getByRole("button", { name: "reMarkable folder Work / Meetings / Archive", exact: true });
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await expect(tree.getByRole("button", { name: "reMarkable folder Work / Meetings", exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__test.remarkable.finishList());
  await expect(page.getByRole("button", { name: "Refresh reMarkable", exact: true })).toBeEnabled();
  await expect(meetings).toHaveCount(0);
  await root.click();
  await expect(meetings).toHaveAttribute("aria-expanded", "false");
  await expect(archive).toHaveCount(0);
  await meetings.click();
  await expect(archive).toBeVisible();
  await page.getByRole("button", { name: "Document Quick sheets", exact: true }).click();
  await page.getByRole("button", { name: "Focus reMarkable viewer", exact: true }).click();
  await page.getByRole("button", { name: "Show reMarkable folders", exact: true }).click();
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await expect(meetings).toHaveCount(0);
  await root.click();
  await page.evaluate(() => { (window as any).__test.remarkable.pauseList = false; });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await expect(meetings).toHaveCount(0);
});

test("document browser filters folders, preserves position and saves before returning", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const app = (window as any).__test;
    for (let i = 0; i < 80; i++)
      app.files[`Projects/Note ${String(i).padStart(2, "0")}.md`] =
        `# Note ${i}\n\nA thought to keep.\n`;
    app.dates["Projects/Note 79.md"] = Date.now();
    app.external(
      "Projects/Research/Deep note.md",
      "# Deep note\n\nA special constellation.\n",
    );
  });
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  await page.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true }).click();
  await page
    .getByRole("button", { name: "Folder Fieldnotes/Projects", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Projects\s*80/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Folder Fieldnotes/Projects", exact: true }).locator("b")).toHaveText("80");
  await expect(page.locator(".document-card")).toHaveCount(60);
  await expect(page.locator(".document-card").first()).toHaveAccessibleName(
    "Note 79",
  );
  await page.getByRole("combobox", { name: "Sort files" }).selectOption("name");
  await expect(page.locator(".document-card").first()).toHaveAccessibleName(
    "Note 00",
  );
  await expect(page.getByRole("button", { name: "Deep note", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Folder Fieldnotes/Projects/Research", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Folder Fieldnotes/Projects/Research", exact: true })
    .click();
  await expect(page.locator(".document-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Folder Fieldnotes/Projects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Note 35", exact: true })
    .scrollIntoViewIfNeeded();
  const scrollBefore = await page
    .locator(".document-rows")
    .evaluate((el) => el.scrollTop);
  await page.getByRole("button", { name: "Note 35", exact: true }).click();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Markdown editor" })
    .fill("# Saved before returning\n");
  await page
    .getByRole("button", { name: "Back to notes", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Notes overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__test.files["Projects/Note 35.md"],
    ),
  ).toBe("# Saved before returning\n");
  await expect
    .poll(() => page.locator(".document-rows").evaluate((el) => el.scrollTop))
    .toBe(scrollBefore);
  await page
    .getByRole("textbox", { name: "Search files" })
    .fill("constellation");
  await expect(page.locator(".document-card")).toHaveCount(1);
  await expect(page.locator(".document-card")).toContainText(
    "special constellation",
  );
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page
    .getByRole("button", { name: "Recently changed", exact: true })
    .click();
  await expect(page.locator(".document-card")).toHaveCount(50);
  await expect(page.locator(".document-card").first()).toHaveAccessibleName(
    "Note 79",
  );
  await page.getByRole("group", { name: "Files filter" }).getByRole("button", { name: "All", exact: true }).click();
  await page.screenshot({
    path: "test-results/documents.png",
    animations: "disabled",
  });
});

test("notes shares Todo spacing and keeps folders, list and reader together", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  const todoPadding = await page.locator(".todo-page").evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.paddingTop, s.paddingLeft, s.paddingRight];
  });
  const todoHeaderHeight = await page.locator(".todo-page").evaluate((el) =>
    el.querySelector(".todo-browser")!.getBoundingClientRect().top - el.getBoundingClientRect().top,
  );
  expect(todoHeaderHeight).toBeLessThan(150);
  await page
    .getByRole("button", { name: "All files", exact: true })
    .click();
  expect(
    await page.locator(".notes-page").evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.paddingTop, s.paddingLeft, s.paddingRight];
    }),
  ).toEqual(todoPadding);
  const filesHeaderHeight = await page.locator(".notes-page").evaluate((el) =>
    el.querySelector(".notes-browser")!.getBoundingClientRect().top - el.getBoundingClientRect().top,
  );
  expect(filesHeaderHeight).toBeLessThan(150);
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Visual editor" });
  await expect(editor).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "File folders" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Notes overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Welcome", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const columns = await page.locator(".notes-browser").evaluate((el) =>
    [...el.children].map((child) => {
      const r = child.getBoundingClientRect();
      return { x: r.x, right: r.right, width: r.width };
    }),
  );
  expect(columns[0].right).toBeLessThanOrEqual(columns[1].x + 1);
  expect(columns[1].right).toBeLessThanOrEqual(columns[2].x + 1);
  expect(columns[2].width).toBeGreaterThan(400);
  await page.screenshot({
    path: "test-results/notes-three-columns.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Focus on document", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Notes overview" }),
  ).toBeHidden();
  await expect(editor).toBeVisible();
  await page
    .getByRole("button", { name: "Show notes and folders", exact: true })
    .click();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown editor" });
  await source.fill("# Draft stays open while browsing\n");
  await page.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true }).click();
  await page.getByRole("button", { name: "Folder Fieldnotes/Ideas", exact: true }).click();
  await expect(source).toContainText("Draft stays open while browsing");
  await page
    .getByRole("button", { name: "A quieter workspace", exact: true })
    .click();
  expect(await diskContent(page)).toBe("# Draft stays open while browsing\n");
  await page.setViewportSize({ width: 760, height: 520 });
  await expect(
    page.getByRole("combobox", { name: "Choose notes folder" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Choose notes folder" })
    .selectOption("");
  await expect(
    page.getByRole("button", { name: "Welcome", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/notes-compact-reader.png",
    animations: "disabled",
  });
});

async function createResearchProject(page: import("@playwright/test").Page) {
  await page.evaluate(() => (window as any).__test.addFolder());
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  if (!(await page.getByRole("combobox", { name: "Current library" }).inputValue())) await createLibrary(page, "Test library");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Research project");
  await page.getByRole("textbox", { name: "Description" }).fill("Notes and references from two folders.");
  await page.getByRole("checkbox", { name: "Fieldnotes /test/Fieldnotes" }).check();
  await page.getByRole("checkbox", { name: "Projects /test/Projects" }).check();
  await page.getByLabel("Default folder for new notes").selectOption("/test/Projects");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Research project", exact: true })).toBeVisible();
}

test("project selection scopes project Files and Tasks while Home remains global", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-projects")) return;
    const base = { description: "", color: "blue", pinned: false, archived: false, defaultFolder: "/test/Projects" };
    localStorage.setItem("test-projects", JSON.stringify({ library: null, revision: "legacy", active: null, projects: [
      { ...base, id: "both", name: "Both folders", folders: ["/test/Fieldnotes", "/test/Projects"] },
      { ...base, id: "single", name: "Only research", folders: ["/test/Projects"] },
    ] }));
  });
  await page.goto("/");
  await page.reload();
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.files["Plan.md"] = "# Field plan\n- [ ] Field task\n";
    app.files["Ideas/Deep/Nested.md"] = "# Nested\n- [ ] Nested task\n";
    app.secondFiles["Plan.md"] = "# Research plan\n- [ ] Research task\n";
    app.secondFiles["report.html"] = "<h1>Project report</h1>";
  });
  await page.getByRole("region", { name: "My projects" }).getByRole("button").filter({ hasText: "Only research" }).click();
  await expect(page.getByLabel("Selected project")).toContainText("Only research");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Project files", exact: true }).click();
  const files = page.getByRole("region", { name: "Notes overview" });
  const folders = page.getByRole("navigation", { name: "File folders" });
  await expect(files).toContainText("Projects/Plan.md");
  await expect(files).toContainText("report.html");
  await expect(files).not.toContainText("Fieldnotes/");
  await expect(folders.getByRole("button", { name: "Folder Projects", exact: true })).toBeVisible();
  await expect(folders.getByRole("button", { name: "Folder Projects/Ideas", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Project tasks", exact: true }).click();
  await expect(page.locator(".task-results")).toContainText("Research task");
  await expect(page.locator(".task-results")).toContainText("Compare the sources");
  await expect(page.locator(".task-results")).not.toContainText("Field task");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("region", { name: "Open project tasks" })).toContainText("Research task");
  await expect(page.getByRole("region", { name: "Open project tasks" })).toContainText("Field task");
  await expect(page.getByRole("region", { name: "Continue working" })).toContainText("Fieldnotes");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.locator(".project-select").filter({ hasText: "Both folders" }).click();
  await expect(page.getByLabel("Selected project")).toContainText("Both folders");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Project files", exact: true }).click();
  await expect(files).toContainText("Fieldnotes/Plan.md");
  await expect(files).toContainText("Projects/Plan.md");
  await expect(folders.getByRole("button", { name: "Folder Fieldnotes/Ideas", exact: true })).toHaveCount(0);
  await folders.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true }).click();
  await expect(folders.getByRole("button", { name: "Folder Fieldnotes/Ideas", exact: true })).toBeVisible();
  await expect(folders.getByRole("button", { name: "Folder Fieldnotes/Ideas/Deep", exact: true })).toHaveCount(0);
  await files.getByRole("button", { name: "Plan", exact: true }).filter({ hasText: "Projects/Plan.md" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Research plan");
  await expect(files).toContainText("Fieldnotes/Plan.md");
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await page.screenshot({ path: `test-results/project-scope-files-${testInfo.project.name}.png` });
  await page.setViewportSize({ width: 760, height: 520 });
  await expect(page.getByLabel("Selected project")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/project-scope-compact-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Project tasks", exact: true }).click();
  await expect(page.locator(".task-results")).toContainText("Nested task");
  await page.getByRole("checkbox", { name: "Complete: Field task", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Complete: Field task", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Complete: Research task", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Complete: Research task", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__test.secondFiles["Plan.md"])).toContain("[x] Research task");
  expect(await page.evaluate(() => (window as any).__test.files["Plan.md"])).toContain("[x] Field task");
  await page.reload();
  await expect(page.getByLabel("Selected project")).toContainText("Both folders");
  await page.getByRole("button", { name: "Close project Both folders", exact: true }).click();
  await expect(page.getByLabel("Selected project")).toContainText("Only research");
  await page.getByRole("button", { name: "Close project Only research", exact: true }).click();
  await expect(page.getByLabel("Selected project")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("test-projects")!).active)).toBeNull();
});

test("Home finds work across project folders and completes a task", async ({ page }) => {
  await page.goto("/");
  await createResearchProject(page);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const projects = page.getByRole("region", { name: "My projects" });
  const documents = page.getByRole("region", { name: "Continue working" });
  const tasks = page.getByRole("region", { name: "Open project tasks" });
  await expect(projects).toContainText("Research project");
  await expect(projects).toContainText("Notes and references from two folders.");
  await expect(tasks.getByRole("checkbox", { name: "Complete Compare the sources" })).toBeVisible();
  const focusBounds = await tasks.boundingBox();
  const streamBounds = await page.getByRole("region", { name: "Streams", exact: true }).boundingBox();
  expect(focusBounds!.x).toBeGreaterThanOrEqual(streamBounds!.x + streamBounds!.width);
  expect(Math.abs(streamBounds!.y - focusBounds!.y)).toBeLessThan(2);
  const documentBounds = await documents.boundingBox();
  const projectBounds = await projects.boundingBox();
  expect(projectBounds!.y).toBeGreaterThanOrEqual(documentBounds!.y + documentBounds!.height);
  await page.locator(".app-version > span").first().evaluate((label) => {
    label.textContent = label.textContent?.replace(" · dev", "") ?? "";
  });
  await page.screenshot({ path: "test-results/home-release.png", animations: "disabled" });
  await page.getByRole("textbox", { name: "Search Home" }).fill("cross-folder discovery");
  await expect(documents).toContainText("Research");
  await expect(documents).not.toContainText("Welcome");
  await page.getByRole("textbox", { name: "Search Home" }).fill("Welcome");
  await expect(documents.getByRole("button").filter({ hasText: "Welcome" })).toHaveCount(2);
  await expect(documents).toContainText("Fieldnotes / Welcome.md");
  await expect(documents).toContainText("Projects / Welcome.md");
  await page.getByRole("textbox", { name: "Search Home" }).fill("Research project");
  await expect(projects).toContainText("Research project");
  await page.getByRole("textbox", { name: "Search Home" }).fill("");
  await tasks.getByRole("checkbox", { name: "Complete Compare the sources" }).click();
  await expect(tasks.getByRole("checkbox", { name: "Complete Compare the sources" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__test.secondFiles["Welcome.md"])).toContain("- [x] Compare the sources");
  await page.getByRole("combobox", { name: "New note project" }).selectOption({ label: "Research project" });
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("textbox", { name: "Note name" }).fill("Cockpit note");
  await page.evaluate(() => { (window as any).__test.dates["Cockpit note.md"] = Date.now(); });
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Cockpit note");
  expect(await page.evaluate(() => (window as any).__test.secondFiles["Cockpit note.md"])).toContain("Cockpit note");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("region", { name: "Continue working" }).getByRole("button").first()).toContainText("Cockpit note");
  await page.screenshot({ path: "test-results/home-dashboard.png", animations: "disabled" });
  await page.setViewportSize({ width: 760, height: 520 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/home-dashboard-compact.png", animations: "disabled" });
});

test("projects collect two roots, persist settings, and open the correct same-named note", async ({ page }) => {
  await page.goto("/");
  await createResearchProject(page);
  await expect(page.getByRole("region", { name: "Project tasks" })).toContainText("Compare the sources");
  await page.getByRole("button", { name: "Pin project", exact: true }).click();
  await page.reload();
  await showProjects(page);
  await expect(page.getByRole("heading", { name: "Research project", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpin project", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search project" }).fill("cross-folder discovery");
  await expect(page.getByRole("region", { name: "Project files" }).locator(".recent-notes").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Project files" })).toContainText("Research.md");
  await page.getByRole("textbox", { name: "Search project" }).fill("Welcome");
  await expect(page.getByRole("region", { name: "Project files" }).locator(".recent-notes").getByRole("button")).toHaveCount(2);
  await page.getByRole("region", { name: "Project files" }).getByRole("button").filter({ hasText: "Projects · Welcome.md" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Project research");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project note" }).click();
  await page.getByRole("textbox", { name: /name|path/i }).fill("Project draft.md");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Project draft");
  expect(await page.evaluate(() => (window as any).__test.secondFiles["Project draft.md"])).toContain("Project draft");
  expect(await page.evaluate(() => (window as any).__test.files["Project draft.md"])).toBeUndefined();
});

test("project tasks write to their own root and archiving keeps files", async ({ page }) => {
  await page.goto("/");
  await createResearchProject(page);
  await page.getByRole("checkbox", { name: "Complete Compare the sources in Projects" }).click();
  await expect(page.getByRole("region", { name: "Project tasks" })).not.toContainText("Compare the sources");
  expect(await page.evaluate(() => (window as any).__test.secondFiles["Welcome.md"])).toContain("[x]");
  expect(await page.evaluate(() => (window as any).__test.files["Welcome.md"])).toContain("A little room");
  await page.getByRole("button", { name: "Archive project", exact: true }).click();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore project" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.secondFiles["Welcome.md"])).toContain("[x]");
  await page.getByRole("button", { name: "Restore project" }).click();
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(page.locator(".project-select")).toContainText("Research project");
});

test("offline project folders can reconnect while other folders remain searchable", async ({ page }) => {
  await page.goto("/");
  await createResearchProject(page);
  await page.evaluate(() => (window as any).__test.unavailable.add("/test/Fieldnotes"));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reconnect folder" })).toBeVisible();
  await page.locator(".project-detail").getByRole("tab", { name: /^Files/ }).click();
  await expect(page.getByRole("region", { name: "Project files" })).toContainText("Research.md");
  await page.getByRole("button", { name: "Reconnect folder" }).click();
  await expect(page.getByRole("button", { name: "Reconnect folder" })).toHaveCount(0);
  await expect(page.locator(".project-folders")).not.toContainText("/test/Fieldnotes");
  await expect(page.locator(".project-folders")).toContainText("/test/Projects");
});

test("a failed editor save blocks navigation to projects and preserves the draft", async ({ page }) => {
  await page.goto("/");
  await createResearchProject(page);
  await page.getByRole("textbox", { name: "Search project" }).fill("Welcome");
  await page.getByRole("region", { name: "Project files" }).getByRole("button").filter({ hasText: "Fieldnotes · Welcome.md" }).click();
  await page.evaluate(() => (window as any).__test.failSave(true));
  await page.locator(".ProseMirror").fill("A draft that must survive");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Disk is read-only");
  await expect(page.locator(".ProseMirror")).toContainText("A draft that must survive");
  await expect(page.getByRole("complementary", { name: "Project document" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Current scope" })).toContainText("Research project");
});

test("project settings support shared folders, detaching, and compact windows", async ({ page }, testInfo) => {
  await page.goto("/");
  await createResearchProject(page);
  await page.screenshot({ path: `test-results/projects-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Fieldnotes /test/Fieldnotes" }).uncheck();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Research revised");
  await page.getByRole("combobox", { name: "Color", exact: true }).selectOption("violet");
  const iconPicker = page.getByRole("group", { name: "Project icon", exact: true });
  await expect(iconPicker.getByRole("button")).toHaveCount(24);
  await expect(iconPicker.getByRole("button", { name: "Project icon Sports", exact: true })).toBeVisible();
  await expect(iconPicker.getByRole("button", { name: "Project icon Home", exact: true })).toBeVisible();
  expect(await iconPicker.getByRole("button").evaluateAll(buttons => new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size)).toBe(2);
  await page.getByRole("button", { name: "Project icon Car", exact: true }).click();
  await page.screenshot({ path: `test-results/project-appearance-${testInfo.project.name}.png` });
  const settings = page.getByRole("form", { name: "Project settings", exact: true });
  expect(await settings.getByRole("combobox").evaluateAll(fields => fields.every(field => field.getBoundingClientRect().height === 40))).toBe(true);
  expect(await settings.getByRole("checkbox").evaluateAll(fields => fields.every(field => {
    const rect = field.getBoundingClientRect(); return rect.width === 18 && rect.height === 18;
  }))).toBe(true);
  await settings.getByLabel("Default folder for new notes").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/project-folders-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.locator(".project-bookmark.project-violet .lucide-car-front")).toBeVisible();
  expect(await page.evaluate(async () => (await (window as any).__TAURI_INTERNALS__.invoke("load_projects")).projects.find((project: any) => project.name === "Research revised")))
    .toMatchObject({ color: "violet", icon: "car" });
  await expect(page.locator(".project-folders")).not.toContainText("/test/Fieldnotes");
  expect(await page.evaluate(() => (window as any).__test.files["Welcome.md"])).toContain("A little room");
  await createResearchProject(page);
  await expect(page.getByRole("complementary", { name: "Your projects" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.locator(".project-select")).toHaveCount(2);
  await page.getByRole("button", { name: "Project overview", exact: true }).click();
  await page.setViewportSize({ width: 760, height: 520 });
  await expect(page.getByRole("textbox", { name: "Search project" })).toBeVisible();
  expect(await page.locator(".projects-page").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/projects-compact-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Default folder for new notes")).toBeVisible();
  expect(await page.locator(".projects-page").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByLabel("Default folder for new notes").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/project-settings-compact-${testInfo.project.name}.png` });
  await page.getByLabel("Default folder for new notes").selectOption("");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("button", { name: "New project note" })).toBeDisabled();
  await page.getByLabel("New note destination").selectOption("/test/Fieldnotes");
  await expect(page.getByRole("button", { name: "New project note" })).toBeEnabled();
});

async function createLibrary(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await page.getByRole("button", { name: "New library", exact: true }).click();
  await page.getByRole("textbox", { name: "Library name" }).fill(name);
  await page.getByRole("button", { name: "Choose location and create" }).click();
  await expect(page.getByRole("combobox", { name: "Current library" })).toHaveValue(`/test/libraries/${name}`);
}

async function showProjects(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Projects", exact: true }).click();
}
async function showSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
}

test("libraries are managed in Settings while projects stay uncluttered", async ({ page }, testInfo) => {
  await page.goto("/");
  await showProjects(page);
  await expect(page.getByRole("button", { name: "New project", exact: true })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Library", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Set up a library" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await createLibrary(page, "Work");
  await createResearchProject(page);
  await expect(page.getByRole("button", { name: "New library", exact: true })).toHaveCount(0);
  await createLibrary(page, "Personal");
  await showProjects(page);
  await expect(page.locator(".project-select")).toHaveCount(0);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("My notebook");
  await expect(page.getByRole("button", { name: "App settings", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My notebook", exact: true })).toBeVisible();
  await expect(page.locator(".project-folders")).toContainText("/test/libraries/Personal/projects/my-notebook-");
  await page.getByRole("button", { name: "New project note" }).click();
  await page.getByRole("textbox", { name: "Note name" }).fill("Personal thought");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Personal thought");
  await page.locator(".ProseMirror").fill("A thought saved before opening Settings");
  await showSettings(page);
  expect(await page.evaluate(() => Object.values((window as any).__test.libraryFiles).some((files: any) => files["Personal thought.md"]?.includes("A thought saved before opening Settings")))).toBe(true);
  await page.getByRole("combobox", { name: "Current library" }).selectOption("/test/libraries/Work");
  await showProjects(page);
  await expect(page.getByRole("heading", { name: "Research project", exact: true })).toBeVisible();
  await expect(page.locator(".project-select")).not.toContainText("My notebook");
  await page.reload();
  await showProjects(page);
  await expect(page.getByRole("heading", { name: "Research project", exact: true })).toBeVisible();
  await showSettings(page);
  await expect(page.getByRole("combobox", { name: "Current library" })).toHaveValue("/test/libraries/Work");
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(page.getByRole("combobox", { name: "Current library" })).toHaveValue("");
  await page.evaluate(() => (window as any).__test.pickLibrary("/test/libraries/Work"));
  await page.getByRole("button", { name: "Open library", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Current library" })).toHaveValue("/test/libraries/Work");
  await page.screenshot({ path: `test-results/settings-${testInfo.project.name}.png` });
  await page.setViewportSize({ width: 760, height: 520 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "App settings", exact: true })).toBeInViewport();
  await page.screenshot({ path: `test-results/settings-compact-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "View projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Research project", exact: true })).toBeVisible();
});

test("older project import is repeatable and cancelling library creation changes nothing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as any).__test.setLegacy());
  await page.reload();
  await showProjects(page);
  await expect(page.getByRole("heading", { name: "Older work", exact: true })).toBeVisible();
  await showSettings(page);
  await page.getByRole("button", { name: "New library", exact: true }).click();
  await page.getByRole("textbox", { name: "Library name" }).fill("Cancelled");
  await page.evaluate(() => (window as any).__test.cancelLibraryPicker());
  await page.getByRole("button", { name: "Choose location and create" }).click();
  await expect(page.getByRole("combobox", { name: "Current library" })).toHaveValue("");
  await page.getByRole("form", { name: "Create library" }).getByRole("button", { name: "Cancel", exact: true }).click();
  await createLibrary(page, "Migrated");
  await page.evaluate(() => (window as any).__test.pickLibrary("/test/not-a-library"));
  await page.getByRole("button", { name: "Open library", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a NotesDive library");
  await expect(page.getByRole("combobox", { name: "Current library" })).toHaveValue("/test/libraries/Migrated");
  await page.getByRole("button", { name: "Import older projects" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await showProjects(page);
  await expect(page.locator(".project-select")).toHaveCount(1);
  await expect(page.locator(".project-select")).toContainText("Older work");
  await expect(page.getByRole("heading", { name: "Choose a project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create your first project" })).toHaveCount(0);
  await showSettings(page);
  await page.getByRole("button", { name: "Open library", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a NotesDive library");
  await showProjects(page);
  await page.getByRole("button", { name: "Open Older work", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Older work", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await showSettings(page);
  await page.getByRole("button", { name: "Import older projects" }).click();
  const legacy = await page.evaluate(() => JSON.parse(localStorage.getItem("test-projects")!));
  expect(legacy.projects[0].folders).toEqual(["/test/Fieldnotes"]);
  await showProjects(page);
  await expect(page.locator(".project-select")).toHaveCount(1);
  await showSettings(page);
  await page.getByRole("combobox", { name: "Current library" }).selectOption("");
  await showProjects(page);
  await expect(page.getByRole("heading", { name: "Older work", exact: true })).toBeVisible();
});

test("external metadata changes require reload and missing libraries can be left safely", async ({ page }) => {
  await page.goto("/");
  await createResearchProject(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("My unsaved title");
  await page.evaluate(() => (window as any).__test.changeProjectMetadata());
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("metadata changed");
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("My unsaved title");
  await page.getByRole("form", { name: "Project settings" }).getByRole("button", { name: "Cancel", exact: true }).click();
  await showSettings(page);
  await page.getByRole("button", { name: "Reload library", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await showProjects(page);
  await expect(page.getByRole("heading", { name: "Changed on disk", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__test.unavailable.add("/test/libraries/Test library"));
  await showSettings(page);
  await page.getByRole("button", { name: "Reload library", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Library unavailable");
  await showProjects(page);
  await expect(page.locator(".project-select")).toHaveCount(0);
  await createLibrary(page, "Available");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Current library" })).toHaveValue("/test/libraries/Available");
  await showProjects(page);
  await expect(page.getByRole("button", { name: "New project", exact: true })).toBeEnabled();
});

test("project cockpit puts the goal, cross-folder work and editable links together", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.external("Links.md", "# References\n\n[Project board](https://board.example/project)\n[Research archive](https://archive.example)\n");
    app.external("Planning.md", "# Next steps\n\n- [ ] Review the project brief\n- [ ] Prepare the workshop\n");
    for (let i = 1; i <= 8; i++) { app.files[`Recent ${i}.md`] = `# Recent ${i}`; app.dates[`Recent ${i}.md`] = i * 1000; }
  });
  await createResearchProject(page);
  await expect(page.locator(".project-purpose")).toContainText("Notes and references from two folders.");
  const tasks = page.getByRole("region", { name: "Project tasks" });
  const files = page.getByRole("region", { name: "Project files" });
  const links = page.getByRole("region", { name: "Project links" });
  await expect(tasks).toContainText("Review the project brief");
  await expect(tasks).toContainText("Compare the sources");
  await expect(links).toContainText("Project board");
  await expect(page.locator(".project-sources")).not.toHaveAttribute("open", "");
  const fileBox = (await files.boundingBox())!;
  const taskBox = (await tasks.boundingBox())!;
  expect(Math.abs(fileBox.y - taskBox.y)).toBeLessThan(2);
  expect(taskBox.x).toBeGreaterThan(fileBox.x);
  const linkBox = (await links.boundingBox())!;
  expect(linkBox.x).toEqual(taskBox.x);
  expect(linkBox.y).toBeLessThan(700);
  await expect(files.getByRole("heading", { name: "Project stream" })).toBeVisible();
  await expect(files.locator(".recent-notes > button").first()).toContainText("Recent 8.md");
  await expect(files.locator(".recent-notes > button").nth(4)).toBeInViewport();
  await page.screenshot({ path: `test-results/project-documents-height-${testInfo.project.name}.png`, animations: "disabled" });
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => { (window as any).__copiedLink = text; } },
  }));
  await links.getByRole("button", { name: "Copy link Project board", exact: true }).click();
  await expect(links.getByRole("status")).toHaveText("Copied Project board");
  expect(await page.evaluate(() => (window as any).__copiedLink)).toBe("https://board.example/project");
  const spacing = await page.locator(".projects-page").evaluate((el) => [getComputedStyle(el).paddingTop, getComputedStyle(el).paddingLeft]);
  expect(spacing).toEqual(["16px", "32px"]);
  await page.screenshot({ path: `test-results/project-cockpit-${testInfo.project.name}.png` });
  await page.getByRole("textbox", { name: "Search project" }).fill("archive.example");
  await expect(links).toContainText("Research archive");
  await expect(links).not.toContainText("Project board");
  await page.getByRole("textbox", { name: "Search project" }).fill("");
  const webLink = links.getByRole("link", { name: "Project board", exact: false });
  await expect(webLink).toHaveAttribute("target", "_blank");
  await expect(webLink).toHaveAttribute("rel", "noopener noreferrer");
  await webLink.click();
  expect(await page.evaluate(() => (window as any).__test.openedWebLink)).toBe("https://board.example/project");
  await expect(page.getByRole("heading", { name: "Research project", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__test.openedWebLink = null; });
  await webLink.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as any).__test.openedWebLink)).toBe("https://board.example/project");
  await links.getByRole("button", { name: "Edit link Project board in Fieldnotes", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("References");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.setViewportSize({ width: 760, height: 620 });
  expect(await page.locator(".projects-page").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/project-cockpit-compact-${testInfo.project.name}.png` });
});

test("version notice offers a newer release, opens the browser and caches automatic checks", async ({ page }, testInfo) => {
  let requests = 0;
  const parts = appPackage.version.split(".").map(Number);
  parts[2]++;
  const futureVersion = parts.join(".");
  let published = futureVersion;
  await page.route("https://api.github.com/repos/markmastop/notesdive/releases/latest", (route) => {
    requests++;
    return route.fulfill({ json: githubRelease(published), headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Version and updates" });
  await expect(trigger).toContainText("Update available");
  expect(requests).toBe(1);
  await trigger.click();
  const panel = page.getByRole("region", { name: "Software updates" });
  await expect(panel).toContainText(`NotesDive ${futureVersion} is available`);
  await panel.getByRole("button", { name: `Download ${futureVersion}` }).click();
  expect(await page.evaluate(() => (window as any).__test.openedReleasePage)).toBe("download");
  expect(await page.evaluate(() => (window as any).__test.openedReleaseVersion)).toBe(futureVersion);
  await panel.getByRole("button", { name: "What’s new" }).click();
  expect(await page.evaluate(() => (window as any).__test.openedReleasePage)).toBe("notes");
  await page.screenshot({ path: `test-results/update-notice-${testInfo.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(trigger).toContainText("Update available");
  expect(requests).toBe(1);
  await page.setViewportSize({ width: 760, height: 520 });
  await trigger.click();
  expect(await page.locator(".update-panel").evaluate((el) => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  published = "0.8.0";
  await panel.getByRole("button", { name: "Check for updates" }).click();
  await expect(panel).toContainText("You’re up to date.");
  await expect(trigger).not.toContainText("Update available");
  expect(requests).toBe(2);
});

test("offline version checks stay quiet and a manual retry explains the failure", async ({ page }) => {
  await page.route("https://api.github.com/repos/markmastop/notesdive/releases/latest", (route) => route.abort());
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Version and updates" });
  await expect(trigger).not.toContainText("Update available");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await trigger.click();
  const panel = page.getByRole("region", { name: "Software updates" });
  await panel.getByRole("button", { name: "Check for updates" }).click();
  await expect(panel).toContainText("Could not check for updates");
  await expect(panel).not.toContainText("You’re up to date.");
  await expect(panel).toContainText("Not checked yet");
  await page.getByRole("heading", { name: "Home", exact: true }).click();
  await expect(panel).toHaveCount(0);
});


async function exportedPdf(page: import("@playwright/test").Page) {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__test.exportedPdf))).toBe(true);
  return page.evaluate(async () => {
    const exported = (window as any).__test.exportedPdf;
    const moduleUrl = "/node_modules/pdfjs-dist/build/pdf.mjs";
    const pdfjs = await import(moduleUrl);
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const bytes = Uint8Array.from(atob(exported.data), (char) => char.charCodeAt(0));
    const loading = pdfjs.getDocument({ data: bytes });
    const pdf = await loading.promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push({ text: content.items.map((item: any) => item.str).join(" "), width: page.view[2], height: page.view[3] });
    }
    await loading.destroy();
    return { filename: exported.filename, data: exported.data, pages };
  });
}

test("PDF export generates A4 with every filtered task and a footer on every page", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.print = () => { throw new Error("PDF export must not print"); };
    (window as any).__test.external("Export.md", "# Export\n\n" + Array.from({ length: 90 }, (_, i) => `- [ ] Export task ${i}`).join("\n") + "\n- [x] Finished export task\n");
  });
  await page.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(page.getByText("Export task 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const pdf = await exportedPdf(page);
  expect(pdf.filename).toMatch(/^All_tasks_\d{8}\.pdf$/);
  expect(pdf.pages.length).toBeGreaterThan(1);
  const text = pdf.pages.map((page) => page.text).join(" ");
  expect(text).toContain("Export task 89");
  expect(text).not.toContain("Finished export task");
  for (const [index, page] of pdf.pages.entries()) {
    expect(page.width).toBeCloseTo(595.28, 1);
    expect(page.height).toBeCloseTo(841.89, 1);
    expect(page.text).toContain("All tasks");
    expect(page.text).toMatch(/\d{2}-\d{2}-\d{4}.*\d{2}:\d{2}:\d{2}/);
    expect(page.text).toContain(`${index + 1}/${pdf.pages.length}`);
  }
  await writeFile(testInfo.outputPath("generated-todos.pdf"), Buffer.from(pdf.data, "base64"));
  await testInfo.attach("generated-todos.pdf", { body: Buffer.from(pdf.data, "base64"), contentType: "application/pdf" });
});

test("PDF export generates selectable Markdown text with document name", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  await expect(page.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true })).toBeVisible();
  await expect(page.locator(".topbar").getByRole("button", { name: "Export PDF", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const pdf = await exportedPdf(page);
  expect(pdf.filename).toMatch(/^Welcome_\d{8}\.pdf$/);
  expect(pdf.pages[0].text).toContain("A little room to think");
  expect(pdf.pages[0].text).toContain("Good ideas");
  expect(pdf.pages[0].text).toContain("Welcome.md");
  expect(pdf.pages[0].text).not.toContain("Autosave on");
  await writeFile(testInfo.outputPath("generated-markdown.pdf"), Buffer.from(pdf.data, "base64"));
  await testInfo.attach("generated-markdown.pdf", { body: Buffer.from(pdf.data, "base64"), contentType: "application/pdf" });
});

async function pdfPageImage(page: import("@playwright/test").Page, number: number) {
  return page.evaluate(async (number) => {
    const moduleUrl = "/node_modules/pdfjs-dist/build/pdf.mjs";
    const pdfjs = await import(moduleUrl);
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const data = Uint8Array.from(atob((window as any).__test.exportedPdf.data), (char) => char.charCodeAt(0));
    const loading = pdfjs.getDocument({ data });
    const pdf = await loading.promise;
    const sheet = await pdf.getPage(number);
    const viewport = sheet.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    const context = canvas.getContext("2d")!;
    await sheet.render({ canvasContext: context, canvas, viewport }).promise;
    const background = Array.from(context.getImageData(8, 8, 1, 1).data).slice(0, 3);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (Math.abs(pixels[offset] - background[0]) + Math.abs(pixels[offset + 1] - background[1]) + Math.abs(pixels[offset + 2] - background[2]) > 80) ink++;
    }
    const png = canvas.toDataURL("image/png").split(",")[1];
    await loading.destroy();
    return { background, ink, png };
  }, number);
}

test("document header PDF exports every Marp slide with custom theme, artwork and slide size", async ({ page }, testInfo) => {
  const remoteRequests: string[] = [];
  await page.route("https://pdf-tracker.invalid/**", (route) => { remoteRequests.push(route.request().url()); return route.abort(); });
  await page.goto("/");
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.files["themes/export.css"] = '/* @theme export */\n@import "default";\nsection { background: #243b45; color: white; } h1 { color: white; } section.second { background-image: url("art.svg"); background-size: cover; }';
    app.files["themes/art.svg"] = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="960" height="720" fill="#a16b42"/></svg>';
    app.files["diagram.svg"] = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#ffee88"/></svg>';
    app.external("Deck.md", '---\nmarp: true\ntheme: export\nsize: 4:3\npaginate: true\nfooter: Workshop\n---\n# First slide\n\nThe complete themed deck.\n\n<!-- Private speaker notes -->\n\n---\n\n<!-- _class: second -->\n# Second slide\n\n![width:120px Diagram](diagram.svg)\n\n![Remote](https://pdf-tracker.invalid/image.png)\n\n---\n\n<!-- _backgroundColor: #41634b -->\n# Third slide\n');
  });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Deck", exact: true }).click();
  await expect(page.getByRole("heading", { name: "First slide", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "First slide", exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true }).click();
  const pdf = await exportedPdf(page);
  expect(pdf.filename).toMatch(/^Deck_\d{8}\.pdf$/);
  expect(pdf.pages).toHaveLength(3);
  expect(pdf.pages[0].width).toBe(720);
  expect(pdf.pages[0].height).toBe(540);
  for (const [index, background] of [[36, 59, 69], [161, 107, 66], [65, 99, 75]].entries()) {
    const rendered = await pdfPageImage(page, index + 1);
    expect(rendered.background).toEqual(background);
    expect(rendered.ink).toBeGreaterThan(1000);
    await writeFile(testInfo.outputPath(`marp-slide-${index + 1}.png`), Buffer.from(rendered.png, "base64"));
  }
  expect(remoteRequests).toEqual([]);
  expect(await page.locator('iframe[aria-hidden="true"]').count()).toBe(0);
  await writeFile(testInfo.outputPath("generated-marp.pdf"), Buffer.from(pdf.data, "base64"));
  // Export from source mode uses the same deck, including the theme and all slides.
  await page.getByRole("button", { name: "Edit Markdown", exact: true }).click();
  await page.evaluate(() => { (window as any).__test.exportedPdf = null; });
  await page.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true }).click();
  expect((await exportedPdf(page)).pages).toHaveLength(3);
});

test("document PDF refuses an unavailable Marp theme instead of dropping its design", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as any).__test.external("Missing theme.md", "---\nmarp: true\ntheme: missing\n---\n# My design"));
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Missing theme", exact: true }).click();
  await page.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText('Theme "missing" not found');
  expect(await page.evaluate(() => Boolean((window as any).__test.exportedPdf))).toBe(false);
});

test("document PDF exports a local PDF unchanged and the whole EPUB from its header", async ({ page }) => {
  const original = Buffer.from(samplePdf(), "binary").toString("base64");
  const book = await sampleEpub();
  await page.goto("/");
  await page.evaluate(({ original, book }) => {
    const app = (window as any).__test;
    app.files["Whole.pdf"] = atob(original);
    app.files["Book.epub"] = atob(book);
  }, { original, book });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Whole.pdf", exact: true }).click();
  const header = page.locator(".notes-reader-header");
  await header.getByRole("button", { name: "Export PDF", exact: true }).click();
  expect((await exportedPdf(page)).data).toBe(original);
  await page.getByRole("button", { name: "Book.epub", exact: true }).click();
  await expect(page.frameLocator('iframe[title="EPUB chapter"]').getByRole("heading", { name: "First chapter" })).toBeVisible();
  await page.evaluate(() => { (window as any).__test.exportedPdf = null; });
  await header.getByRole("button", { name: "Export PDF", exact: true }).click();
  const pdf = await exportedPdf(page);
  const text = pdf.pages.map((sheet) => sheet.text).join(" ");
  expect(text).toContain("A quiet beginning.");
  expect(text).toContain("The story continues.");
  expect(text).not.toContain("Refresh file");
});

test("document PDF exports all PowerPoint slides and plaintext, without viewer chrome", async ({ page }) => {
  const deck = createPresentation();
  for (const title of ["First", "Second", "Third"]) {
    const slide = addBlankSlide(deck);
    addSlideTextBox(slide, { x: inches(1), y: inches(1), w: inches(8), h: inches(1), text: title });
  }
  const data = Buffer.from(await savePresentation(deck)).toString("base64");
  await page.goto("/");
  await page.evaluate((data) => {
    const app = (window as any).__test;
    app.files["Slides.pptx"] = atob(data);
    app.files["Plain.txt"] = "Every line of the document\n\nSecond line\n";
  }, data);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Slides.pptx", exact: true }).click();
  await page.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true }).click();
  expect((await exportedPdf(page)).pages).toHaveLength(3);
  await page.getByRole("button", { name: "Plain.txt", exact: true }).click();
  await page.evaluate(() => { (window as any).__test.exportedPdf = null; });
  await page.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true }).click();
  const text = (await exportedPdf(page)).pages.map((sheet) => sheet.text).join(" ");
  expect(text).toContain("Every line of the document");
  expect(text).toContain("Second line");
  expect(text).not.toContain("Refresh file");
});



test("reMarkable folder labels hide cloud IDs and open the matching notebook", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.evaluate(() => {
    const rm = (window as any).__test.remarkable;
    rm.connected = true;
    rm.items.push(
      { id: "vdl-folder-uuid", parent: "work", name: "VDL", isFolder: true, modified: null, pinned: false },
      { id: "vdl-sibling-notebook-uuid", parent: "work", name: "VDL", isFolder: false, modified: null, pinned: false },
      { id: "vdl-child-notebook-uuid", parent: "vdl-folder-uuid", name: "Meeting", isFolder: false, modified: null, pinned: false },
    );
    window.dispatchEvent(new Event("notesdive-remarkable-changed"));
  });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "All files", exact: true }).click();
  const tree = page.getByRole("navigation", { name: "File folders" });
  await tree.getByRole("button", { name: "Toggle folder reMarkable · My files", exact: true }).click();
  await tree.getByRole("button", { name: "Toggle folder reMarkable · My files/Work", exact: true }).click();
  await expect(tree).not.toContainText("vdl-folder-uuid");
  await tree.getByRole("button", { name: "Folder reMarkable · My files/Work/VDL", exact: true }).click();
  const files = page.getByRole("region", { name: "Notes overview" });
  await expect(files.getByRole("button", { name: "Meeting", exact: true })).toBeVisible();
  await expect(files.getByRole("button", { name: "VDL", exact: true })).toHaveCount(0);
  await files.getByRole("button", { name: "Meeting", exact: true }).click();
  await expect(page.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls)).toContain("remarkable_detail:vdl-child-notebook-uuid");
});

test("folder sync setup confirms, persists and pauses without transferring files", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-projects")) return;
    localStorage.setItem("test-projects", JSON.stringify({ active: "summa", library: null, revision: "legacy", projects: [{
      id: "summa", name: "Summa", description: "", color: "sage", pinned: false, archived: false,
      folders: ["/test/Fieldnotes"], defaultFolder: "/test/Fieldnotes", remarkableFolders: [{ id: "work", name: "3.1 Summa" }],
    }] }));
  });
  await page.goto("/");
  await page.reload();
  const showFolder = async () => {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Project files", exact: true }).click();
    const tree = page.getByRole("navigation", { name: "File folders" });
    await tree.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true }).click();
    await tree.getByRole("button", { name: "Folder Fieldnotes/Ideas", exact: true }).click();
  };
  await showFolder();
  const toggle = page.getByRole("switch", { name: "Sync Ideas with reMarkable" });
  await toggle.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("reMarkable / 3.1 Summa / Ideas");
  await expect(dialog).toContainText("Enabling Sync does not transfer files");
  await page.screenshot({ path: `test-results/folder-sync-${testInfo.project.name}.png` });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await dialog.getByRole("button", { name: "Enable sync", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(toggle).toBeChecked();
  const readSetup = () => page.evaluate(() => JSON.parse(localStorage.getItem("test-projects")!).projects[0].remarkableSync);
  const initial = await readSetup();
  expect(initial).toHaveLength(1);
  expect(initial[0]).toMatchObject({ localFolder: "/test/Fieldnotes", path: "Ideas", remoteParentId: "work", enabled: true });
  await expect(page.getByRole("button", { name: "Open sync for Fieldnotes/Ideas", exact: true })).toBeVisible();
  await page.reload();
  await showFolder();
  await expect(toggle).toBeChecked();
  // The tree icon opens the right popup even when another folder is selected.
  await page.getByRole("button", { name: "Folder Fieldnotes", exact: true }).click();
  const treeSync = page.getByRole("button", { name: "Open sync for Fieldnotes/Ideas", exact: true });
  await treeSync.focus(); await page.keyboard.press("Enter");
  await expect(dialog).toContainText("Ideas, on both devices.");
  await expect(dialog.getByRole("button", { name: "Sync now", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(treeSync).toBeFocused();
  await treeSync.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await toggle.click();
  await dialog.getByRole("button", { name: "Pause sync", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  expect((await readSetup())[0]).toMatchObject({ id: initial[0].id, enabled: false });
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls.every((call: string) =>
    /^(remarkable_status|remarkable_list|remarkable_detail|remarkable_preview)(:|$)/.test(call)))).toBe(true);
});

test("folder sync setup requires a project destination and inherits parent configuration", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-projects")) return;
    localStorage.setItem("test-projects", JSON.stringify({ active: "summa", library: null, revision: "legacy", projects: [{
      id: "summa", name: "Summa", description: "", color: "sage", pinned: false, archived: false,
      folders: ["/test/Fieldnotes"], defaultFolder: "/test/Fieldnotes",
    }] }));
  });
  await page.goto("/");
  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Project files", exact: true }).click();
  const tree = page.getByRole("navigation", { name: "File folders" });
  await tree.getByRole("button", { name: "Folder Fieldnotes", exact: true }).click();
  await page.getByRole("switch", { name: "Sync Fieldnotes with reMarkable" }).click();
  await expect(page.getByRole("dialog")).toContainText("Link a reMarkable folder in project settings first");
  await expect(page.getByRole("button", { name: "Enable sync", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("test-projects")!);
    config.projects[0].remarkableFolders = [{ id: "work", name: "Work" }];
    config.projects[0].remarkableSync = [{ id: "root", localFolder: "/test/Fieldnotes", path: "", remoteParentId: "work", enabled: true }];
    localStorage.setItem("test-projects", JSON.stringify(config));
  });
  await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Project files", exact: true }).click();
  await tree.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true }).click();
  await tree.getByRole("button", { name: "Folder Fieldnotes/Ideas", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Sync Ideas with reMarkable" });
  await expect(toggle).toBeChecked(); await expect(toggle).toBeDisabled();
});

test("project links reMarkable folders and combines read-only cloud files and typed tasks", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-projects")) return;
    localStorage.setItem("test-projects", JSON.stringify({ active: "cloud", library: null, revision: "legacy", projects: [{
      id: "cloud", name: "Cloud project", description: "One overview", color: "sage", pinned: false, archived: false,
      folders: ["/test/Fieldnotes", "/test/Projects"], defaultFolder: "/test/Fieldnotes",
    }] }));
  });
  await page.goto("/");
  await page.reload();
  await page.evaluate((data) => {
    const app = (window as any).__test;
    app.remarkable.connected = true;
    app.remarkable.pageData = [null, data, null, null];
    app.files["Plan.md"] = "# Plan\n- [ ] Local task\n";
  }, readFileSync(new URL("./fixtures/remarkable/v6-sample.rm", import.meta.url)).toString("base64"));
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const project = page.getByRole("region", { name: "Projects workspace" });
  await project.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Choose reMarkable folders", exact: true }).click();
  const picker = page.getByRole("group", { name: "Choose reMarkable project folders" });
  await expect(picker.getByRole("checkbox", { name: "Work", exact: true })).toBeVisible();
  await expect(picker.getByRole("checkbox", { name: "Meetings", exact: true })).toHaveCount(0);
  await picker.getByRole("checkbox", { name: "Work", exact: true }).check();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(project.getByRole("region", { name: "Project files" })).toContainText("reMarkable · Work");
  await expect(project.getByRole("complementary", { name: "Your projects" })).toHaveCount(0);
  await expect(project.getByRole("button", { name: "New project", exact: true })).toHaveCount(0);
  await project.getByRole("tab", { name: /^reMarkable/ }).click();
  const cloudDocuments = project.getByRole("region", { name: "Project reMarkable documents" });
  await expect(cloudDocuments).toContainText("Weekly notes");
  await expect(cloudDocuments).not.toContainText("Quick sheets");
  await expect(cloudDocuments).not.toContainText("Plan.md");
  await project.getByRole("textbox", { name: "Search project" }).fill("Meetings");
  await expect(cloudDocuments.locator(".recent-notes .document-action-row")).toHaveCount(1);
  await project.getByRole("textbox", { name: "Search project" }).fill("");
  await expect(cloudDocuments.locator(".recent-notes .document-action-row")).toHaveCount(2);
  await page.screenshot({ path: `test-results/project-remarkable-${testInfo.project.name}.png` });
  await cloudDocuments.getByRole("button").filter({ hasText: "Meetings/Weekly notes" }).click();
  await expect(page.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A little room to read.", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Project overview", exact: true }).click();
  await project.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(project.getByRole("region", { name: "Project tasks" }).getByRole("checkbox", { name: "Complete Checkbox in reMarkable · Work", exact: true }).first()).toBeDisabled();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Project files", exact: true }).click();
  const files = page.getByRole("region", { name: "Notes overview" });
  const tree = page.getByRole("navigation", { name: "File folders" });
  await expect(files).toContainText("Fieldnotes/Plan.md");
  await expect(files).toContainText("Projects/Research.md");
  await expect(tree.getByRole("button", { name: "Folder reMarkable · Work", exact: true })).toBeVisible();
  await expect(tree.getByRole("button", { name: "Folder reMarkable · Work/Meetings", exact: true })).toHaveCount(0);
  await tree.getByRole("button", { name: "Folder reMarkable · Work", exact: true }).click();
  await expect(files.getByRole("button", { name: "Weekly notes", exact: true })).toHaveCount(1);
  await expect(files).not.toContainText("Quick sheets");
  await expect(tree.getByRole("button", { name: "Toggle folder reMarkable · Work", exact: true })).toHaveAttribute("aria-expanded", "true");
  await tree.getByRole("button", { name: "Folder reMarkable · Work/Meetings", exact: true }).click();
  await expect(files.getByRole("button", { name: "Weekly notes", exact: true })).toHaveCount(1);
  await files.getByRole("button", { name: "Weekly notes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Document viewer" })).toContainText("reMarkable · Read only");
  await expect(page.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Project tasks", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Complete: Local task", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "Complete: Checkbox", exact: true })).toHaveCount(2);
  await expect(page.getByRole("checkbox", { name: "Complete: Checkbox", exact: true }).first()).toBeDisabled();
  await expect(page.locator(".task-results")).toContainText("Page 2 · Read only");
  await page.getByRole("checkbox", { name: "Complete: Local task", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__test.files["Plan.md"])).toContain("[x] Local task");
  await page.getByRole("group", { name: "Task filter", exact: true }).getByRole("button", { name: /Completed/ }).click();
  await expect(page.getByRole("checkbox", { name: "Reopen: Checked and bold, italic", exact: true })).toHaveCount(2);
  await expect(page.getByRole("checkbox", { name: "Reopen: Checked and bold, italic", exact: true }).first()).toBeDisabled();
  await page.getByRole("group", { name: "Task filter", exact: true }).getByRole("button", { name: /^Open/ }).click();
  await page.locator(".task-content").filter({ hasText: "Checkbox" }).first().click();
  await expect(page.getByRole("img", { name: "Notebook page 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("status", { name: "Current scope" })).toContainText("All added local folders");
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await expect(page.getByRole("button", { name: "Document Quick sheets", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "reMarkable folder Empty", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "reMarkable folder Work", exact: true })).toBeVisible();
  await page.reload();
  await page.evaluate(() => { (window as any).__test.remarkable.connected = true; });
  await page.getByRole("button", { name: "Project files", exact: true }).click();
  await expect(tree.getByRole("button", { name: "Folder reMarkable · Work", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("test-projects")!).projects[0].remarkableFolders)).toEqual([{ id: "work", name: "Work" }]);
  await page.setViewportSize({ width: 2560, height: 1300 });
  await page.screenshot({ path: `/private/tmp/notesdive-cloud-project-${testInfo.project.name}.png` });
  await page.setViewportSize({ width: 760, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("missing or disconnected project cloud folders keep local files available without cloud writes", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-projects")) return;
    localStorage.setItem("test-projects", JSON.stringify({ active: "cloud", library: null, revision: "legacy", projects: [{
      id: "cloud", name: "Cloud project", description: "", color: "sage", pinned: false, archived: false,
      folders: ["/test/Fieldnotes"], defaultFolder: "/test/Fieldnotes", remarkableFolders: [{ id: "missing", name: "Moved folder" }],
    }] }));
  });
  await page.goto("/");
  await page.reload();
  await page.getByRole("button", { name: "Project files", exact: true }).click();
  const files = page.getByRole("region", { name: "Notes overview" });
  await expect(files.getByRole("button", { name: "Welcome", exact: true })).toBeVisible();
  await files.getByText("Some files could not be searched").click();
  await expect(files).toContainText("Connect reMarkable to read the linked project folders");
  await page.evaluate(() => { (window as any).__test.remarkable.connected = true; });
  await page.getByRole("button", { name: "Refresh files", exact: true }).click();
  await expect(files).toContainText("Moved folder is unavailable");
  await expect(files).not.toContainText("Weekly notes");
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls.every((call: string) => !/remarkable_(pair|disconnect|put|upload|save)/.test(call)))).toBe(true);
});

test("Home shows paired reMarkable metadata without downloading notebook pages", async ({ page }, testInfo) => {
  await page.goto("/");
  const card = page.getByRole("region", { name: "reMarkable Cloud", exact: true });
  await expect(card).toBeHidden();
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByLabel("One-time code").fill("abcdefgh");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "reMarkable folder Work", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__test.remarkable.calls = []; });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls.some((call: string) => call.startsWith("remarkable_preview")))).toBe(false);
  const main = await page.getByRole("region", { name: "Open project tasks" }).boundingBox();
  const sidebar = await page.locator(".cockpit-sidebar").boundingBox();
  expect(sidebar!.x).toBeGreaterThanOrEqual(main!.x + main!.width);
  await page.screenshot({ path: `/tmp/notesdive-home-remarkable-${testInfo.project.name}.png` });
  await page.setViewportSize({ width: 650, height: 820 });
  const compactMain = await page.getByRole("region", { name: "Open project tasks" }).boundingBox();
  const compactSidebar = await page.locator(".cockpit-sidebar").boundingBox();
  expect(compactSidebar!.y).toBeGreaterThanOrEqual(compactMain!.y + compactMain!.height);
  await card.getByRole("button", { name: "Open your reMarkable library", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "reMarkable folder", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(card).toBeHidden();
});

test("reMarkable pairs, browses folders and fetches details only after selection", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your notebooks, within reach." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Get a pairing code" }).click();
  expect(await page.evaluate(() => (window as any).__test.openedWebLink)).toBe("https://my.remarkable.com/device/remarkable");
  await page.getByLabel("One-time code").fill("badcode1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid pairing code");
  await page.getByLabel("One-time code").fill("abcdefgh");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "reMarkable folder Work", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls.some((call: string) => call.startsWith("remarkable_detail")))).toBe(false);
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeHidden();
  await page.getByRole("button", { name: "reMarkable folder Work", exact: true }).click();
  await expect(page.getByRole("button", { name: "reMarkable folder Work", exact: true }).locator("b")).toHaveText("1");
  await expect(page.locator(".document-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Document Weekly notes", exact: true }).click();
  await page.getByRole("button", { name: "Show document details" }).click();
  const details = page.getByRole("region", { name: "reMarkable document details" });
  await expect(details.getByText("4", { exact: true })).toBeVisible();
  await expect(details.getByRole("heading", { name: "Weekly notes" })).toBeVisible();
  await page.getByRole("button", { name: "Show document details" }).click();
  await expect(page.getByRole("img", { name: "Notebook page 1" })).toBeVisible();
  await expect.poll(() => page.getByRole("img", { name: "Notebook page 1" }).evaluate((img) => img.getBoundingClientRect().width / img.parentElement!.clientWidth)).toBeGreaterThan(0.85);
  await page.screenshot({ path: `/tmp/notesdive-remarkable-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByLabel("One-time code")).toHaveValue("");
  expect(await page.evaluate(() => (window as any).__test.remarkable.connected)).toBe(false);
});

test("reMarkable searches across folders, preserves stale lists on errors and refreshes removed folders", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { (window as any).__test.remarkable.connected = true; });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "reMarkable folder Empty", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This folder is empty" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search reMarkable" }).fill("Weekly");
  await expect(page.getByRole("button", { name: "Document Weekly notes", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Pinned", exact: true }).click();
  await expect(page.getByRole("button", { name: "Document Weekly notes", exact: true })).toHaveCount(1);
  await page.evaluate(() => { (window as any).__test.remarkable.failList = true; });
  await page.getByRole("button", { name: "Refresh reMarkable" }).click();
  await expect(page.getByRole("alert")).toContainText("The previous list is still shown");
  await expect(page.getByRole("button", { name: "Document Weekly notes", exact: true })).toHaveCount(1);
  await page.evaluate(() => {
    const rm = (window as any).__test.remarkable;
    rm.failList = false; rm.items = rm.items.filter((item: any) => item.id !== "empty");
  });
  await page.getByRole("button", { name: "Refresh reMarkable" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear reMarkable search" }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("button", { name: "reMarkable folder Work", exact: true })).toBeVisible();
});

test("reMarkable retries failed detail loads and uses a folder selector on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 820 });
  await page.goto("/");
  await page.evaluate(() => { (window as any).__test.remarkable.connected = true; (window as any).__test.remarkable.failDetail = true; });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "reMarkable folder", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "reMarkable folder", exact: true }).selectOption("work");
  await page.getByRole("button", { name: "Document Weekly notes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Document details unavailable");
  await page.evaluate(() => { (window as any).__test.remarkable.failDetail = false; });
  await page.getByRole("button", { name: "Retry details" }).click();
  await page.getByRole("button", { name: "Show document details" }).click();
  await expect(page.getByRole("region", { name: "reMarkable document details" }).getByText("4", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("switching to reMarkable respects a failed local note save", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  await page.evaluate(() => { (window as any).__test.failSave(true); });
  const editor = page.locator(".cm-content");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await editor.fill("# Unsaved note");
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await expect(page.getByRole("region", { name: "reMarkable workspace" })).toHaveCount(0);
  await expect(editor).toContainText("Unsaved note");
});


test("reMarkable keeps a consumed registration when cloud authentication fails and retries without pairing again", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { (window as any).__test.remarkable.failList = true; });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByLabel("One-time code").fill("abcdefgh");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not reach reMarkable Cloud");
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await expect(page.getByLabel("One-time code")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__test.remarkable.failList = false; });
  await page.getByRole("button", { name: "Refresh reMarkable" }).click();
  await expect(page.getByRole("button", { name: "reMarkable folder Work", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls.filter((call: string) => call === "remarkable_pair").length)).toBe(1);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await expect(page.getByRole("button", { name: "reMarkable folder Work", exact: true })).toBeVisible();
  await expect(page.getByLabel("One-time code")).toHaveCount(0);
});


test("reMarkable folders can be browsed while the initial scan is running", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.pauseList = true; });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "4 / 6" })).toBeVisible();
  await page.getByRole("button", { name: "reMarkable folder Work", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Work", exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Toggle reMarkable folder Work", exact: true }).click();
  await expect(page.getByRole("button", { name: "reMarkable folder Work / Meetings", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Document Weekly notes", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__test.remarkable.finishList());
  await expect(page.getByRole("button", { name: "Document Weekly notes", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Work", exact: false })).toBeVisible();
});

test("reMarkable discards partial results when the initial scan fails", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.pauseList = true; rm.failAfterProgress = true; });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "reMarkable folder Work", exact: true }).click();
  await page.evaluate(() => (window as any).__test.remarkable.finishList());
  await expect(page.getByRole("alert")).toContainText("Scan interrupted");
  await expect(page.getByRole("button", { name: "reMarkable folder Work", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My files", exact: false })).toBeVisible();
});


test("reMarkable renders real v6 handwriting and text, loads pages lazily and zooms like the PDF viewer", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate((data) => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.pageData[0] = data; }, readFileSync(new URL("./fixtures/remarkable/v6-sample.rm", import.meta.url)).toString("base64"));
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls.some((call: string) => call.startsWith("remarkable_preview")))).toBe(false);
  await page.getByRole("button", { name: "reMarkable folder Work", exact: true }).click();
  await page.getByRole("button", { name: "Document Weekly notes", exact: true }).click();
  const image = page.getByRole("img", { name: "Notebook page 1", exact: true });
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(await image.getAttribute("src")).toContain("Text%20small%20and%20hilight");
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls.filter((call: string) => call.startsWith("remarkable_preview")))).toEqual(["remarkable_preview:note:0"]);
  await page.getByRole("button", { name: "Focus reMarkable viewer" }).click();
  await expect(page.getByRole("region", { name: "reMarkable documents" })).toBeHidden();
  const width = await image.evaluate((img) => img.getBoundingClientRect().width);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  expect(await image.evaluate((img) => img.getBoundingClientRect().width)).toBeGreaterThan(width);
  await page.screenshot({ path: `/tmp/notesdive-rm-viewer-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("img", { name: "Notebook page 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  const blank = page.getByRole("img", { name: "Notebook page 3", exact: true });
  await expect(blank).toBeVisible();
  expect(await blank.getAttribute("src")).not.toContain("polyline");
  await page.getByRole("button", { name: "Show reMarkable folders" }).click();
  await expect(page.getByRole("region", { name: "reMarkable documents" })).toBeVisible();
});

test("reMarkable opens cloud PDFs with the existing PDF viewer", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((pdf) => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.fileType = "pdf"; rm.pdfData = btoa(pdf); }, samplePdf());
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "Document Quick sheets", exact: true }).click();
  await expect(page.getByLabel("PDF page 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Page 1 of 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Original PDF · reMarkable annotations are not included.")).toBeVisible();
});

test("reMarkable recovers failed previews and rejects malformed notebook pages", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.failPreview = true; });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "Document Quick sheets", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Preview unavailable");
  await page.evaluate(() => { const rm = (window as any).__test.remarkable; rm.failPreview = false; rm.pageData[0] = btoa("broken rm"); });
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.getByRole("alert")).toContainText("Truncated input");
  await page.evaluate(() => { const rm = (window as any).__test.remarkable; rm.pageData[0] = rm.pageData[1]; });
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
});

test("reMarkable ignores preview responses after switching documents", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.slowId = "note"; });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "reMarkable folder Work", exact: true }).click();
  await page.getByRole("button", { name: "Document Weekly notes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__test.remarkable.finishPreview))).toBe(true);
  await page.getByRole("button", { name: "My files", exact: true }).click();
  await page.getByRole("button", { name: "Document Quick sheets", exact: true }).click();
  await expect(page.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__test.remarkable.finishPreview());
  await expect(page.getByRole("region", { name: "reMarkable document details" })).toContainText("Quick sheets");
  await expect(page.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
});


async function sampleEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("OPS/book.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>NotesDive EPUB</dc:title></metadata><manifest><item id="second" href="Text/two.xhtml" media-type="application/xhtml+xml"/><item id="first" href="Text/one.xhtml" media-type="application/xhtml+xml"/><item id="image" href="Images/tiny.png" media-type="image/png"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>');
  zip.file("OPS/Text/one.xhtml", '<html><head><title>First chapter</title><script>window.__epubRan=true</script></head><body><h1>First chapter</h1><p>A quiet beginning.</p><img src="../Images/tiny.png" alt="Book illustration"/><img src="https://epub.invalid/tracker"/><p onclick="alert(1)">Safe reading.</p></body></html>');
  zip.file("OPS/Text/two.xhtml", '<html><head><title>Second chapter</title></head><body><h1>Second chapter</h1><p>The story continues.</p></body></html>');
  zip.file("OPS/Images/tiny.png", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XZD8AAAAASUVORK5CYII=", { base64: true });
  return zip.generateAsync({ type: "base64" });
}

test("local EPUB uses spine order, embedded images and inert chapter navigation", async ({ page }) => {
  let remoteRequests = 0;
  await page.route("https://epub.invalid/**", (route) => { remoteRequests++; return route.abort(); });
  await page.goto("/");
  await page.evaluate((data) => (window as any).__test.external("book.epub", atob(data)), await sampleEpub());
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "book.epub", exact: true }).click();
  const chapter = page.frameLocator('iframe[title="EPUB chapter"]');
  await expect(chapter.getByRole("heading", { name: "First chapter" })).toBeVisible();
  await expect.poll(() => chapter.getByRole("img", { name: "Book illustration" }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(chapter.locator("script")).toHaveCount(0);
  await expect(chapter.locator("[onclick]")).toHaveCount(0);
  await page.getByRole("button", { name: "Next chapter" }).click();
  await expect(chapter.getByRole("heading", { name: "Second chapter" })).toBeVisible();
  await page.getByRole("button", { name: "Larger text" }).click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  expect(remoteRequests).toBe(0);
});

test("reMarkable EPUB opens and exports the whole book or current chapter as PDF", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((data) => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.fileType = "epub"; rm.pdfData = data; }, await sampleEpub());
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "Document Quick sheets", exact: true }).click();
  const chapter = page.frameLocator('iframe[title="EPUB chapter"]');
  await expect(chapter.getByRole("heading", { name: "First chapter" })).toBeVisible();
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  let pdf = await exportedPdf(page);
  expect(pdf.pages.map((page) => page.text).join(" ")).toContain("A quiet beginning.");
  expect(pdf.pages.map((page) => page.text).join(" ")).toContain("The story continues.");
  await page.getByRole("button", { name: "Next chapter" }).click();
  await expect(chapter.getByRole("heading", { name: "Second chapter" })).toBeVisible();
  await page.getByLabel("PDF export scope").selectOption("current");
  await page.evaluate(() => { (window as any).__test.exportedPdf = null; });
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  pdf = await exportedPdf(page);
  expect(pdf.pages.map((page) => page.text).join(" ")).toContain("The story continues.");
  expect(pdf.pages.map((page) => page.text).join(" ")).not.toContain("A quiet beginning.");
});

test("reMarkable notebook PDF export preserves page count, blank pages and vector text", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate((data) => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.pageData[0] = data; }, readFileSync(new URL("./fixtures/remarkable/v6-sample.rm", import.meta.url)).toString("base64"));
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "reMarkable folder Work", exact: true }).click();
  await page.getByRole("button", { name: "Document Weekly notes", exact: true }).click();
  await expect(page.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  let pdf = await exportedPdf(page);
  expect(pdf.pages).toHaveLength(4);
  expect(pdf.pages[0].text).toContain("Text small and hilight");
  expect(pdf.pages[2].text).toContain("3/4");
  await writeFile(testInfo.outputPath("generated-rm-notebook.pdf"), Buffer.from(pdf.data, "base64"));
  await testInfo.attach("generated-rm-notebook.pdf", { body: Buffer.from(pdf.data, "base64"), contentType: "application/pdf" });
  await page.getByLabel("PDF export scope").selectOption("current");
  await page.evaluate(() => { (window as any).__test.exportedPdf = null; });
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  pdf = await exportedPdf(page);
  expect(pdf.pages).toHaveLength(1);
});

test("reMarkable PDF export saves the original bytes", async ({ page }) => {
  const original = Buffer.from(samplePdf()).toString("base64");
  await page.goto("/");
  await page.evaluate((data) => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.fileType = "pdf"; rm.pdfData = data; }, original);
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "Document Quick sheets", exact: true }).click();
  await expect(page.getByLabel("PDF page 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  const pdf = await exportedPdf(page);
  expect(pdf.data).toBe(original);
});


test("reMarkable never saves partial notebook exports after a failure or cancellation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { (window as any).__test.remarkable.connected = true; });
  await page.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.getByRole("button", { name: "reMarkable folder Work", exact: true }).click();
  await page.getByRole("button", { name: "Document Weekly notes", exact: true }).click();
  await expect(page.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__test.remarkable.failPreview = true; });
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Preview unavailable");
  expect(await page.evaluate(() => Boolean((window as any).__test.exportedPdf))).toBe(false);
  await page.evaluate(() => { const rm = (window as any).__test.remarkable; rm.failPreview = false; rm.slowId = "note"; });
  await page.getByRole("button", { name: "Export PDF", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__test.remarkable.finishPreview))).toBe(true);
  await page.getByRole("button", { name: "Cancel PDF export" }).click();
  await page.evaluate(() => (window as any).__test.remarkable.finishPreview());
  await expect(page.getByRole("button", { name: "Export PDF", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => Boolean((window as any).__test.exportedPdf))).toBe(false);
});

test("EPUB reports malformed and encrypted books without displaying their resources", async ({ page }) => {
  const zip = await JSZip.loadAsync(await sampleEpub(), { base64: true });
  zip.file("META-INF/encryption.xml", '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><CipherData><CipherReference URI="OPS/Text/one.xhtml"/></CipherData></EncryptedData></encryption>');
  const protectedBook = await zip.generateAsync({ type: "base64" });
  await page.goto("/");
  await page.evaluate((data) => { const app = (window as any).__test; app.external("protected.epub", atob(data)); app.external("broken.epub", "broken zip"); }, protectedBook);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "protected.epub", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("encrypted");
  await page.getByRole("button", { name: "broken.epub", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator('iframe[title="EPUB chapter"]')).toHaveCount(0);
});

test("global navigation remains complete beside local, empty and cloud-only project contexts", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-projects")) return;
    const base = { description: "", color: "rose", pinned: false, archived: false, defaultFolder: null };
    localStorage.setItem("test-projects", JSON.stringify({active:null,library:null,revision:"legacy",projects:[
      {...base,id:"local",name:"Local only",folders:["/test/Fieldnotes"],defaultFolder:"/test/Fieldnotes"},
      {...base,id:"empty",name:"Empty project",folders:[]},
      {...base,id:"cloud",name:"Cloud only",folders:[],remarkableFolders:[{id:"work",name:"Work"}]},
    ]}));
  });
  await page.goto("/"); await page.reload();
  await page.evaluate((data) => {const app=(window as any).__test;app.remarkable.connected=true;app.remarkable.pageData=[null,data,null,null];app.files["Unique local.md"]="# Local\n- [ ] Local task";}, readFileSync(new URL("./fixtures/remarkable/v6-sample.rm", import.meta.url)).toString("base64"));
  const nav=page.getByRole("navigation",{name:"Main navigation"});
  const scope=page.getByRole("status",{name:"Current scope"});
  const files=page.getByRole("region",{name:"Notes overview"});
  await nav.getByRole("button",{name:"reMarkable",exact:true}).click();
  await expect(page.getByRole("button",{name:"Document Quick sheets",exact:true})).toBeVisible();
  await nav.getByRole("button",{name:"All files",exact:true}).click();
  await page.getByRole("button",{name:"Refresh files",exact:true}).click();
  await expect(files).toContainText("Unique local");
  await expect(files).toContainText("Quick sheets");
  await nav.getByRole("button",{name:"All tasks",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:"Complete: Checkbox",exact:true})).toHaveCount(3);
  await expect(page.getByRole("checkbox",{name:"Complete: Checkbox",exact:true}).first()).toBeDisabled();
  await expect(page.getByRole("checkbox",{name:"Complete: Local task",exact:true})).toBeEnabled();
  await nav.getByRole("button",{name:"Projects",exact:true}).click();
  await page.locator(".project-select").filter({hasText:"Local only"}).click();
  const overview = page.getByRole("region", { name: "Projects workspace", exact: true });
  await overview.getByRole("tab", { name: /^reMarkable/ }).click();
  await expect(overview.getByRole("region", { name: "Project reMarkable documents" })).toContainText("No reMarkable folders linked");
  await overview.getByRole("button", { name: "Link reMarkable folders", exact: true }).click();
  await expect(overview.getByRole("form", { name: "Project settings", exact: true })).toBeVisible();
  await overview.getByRole("button", { name: "Cancel", exact: true }).click();
  await nav.getByRole("button",{name:"Project files",exact:true}).click();
  await expect(scope).toContainText("Local only");
  await expect(files).toContainText("Unique local");
  await expect(files).not.toContainText("Quick sheets");
  const projectGroup = nav.getByRole("group", { name: "Project: Local only", exact: true });
  const allGroup = nav.getByRole("group", { name: "All work", exact: true });
  // Global navigation stays above the selected project group.
  expect((await allGroup.boundingBox())!.y).toBeLessThan((await projectGroup.boundingBox())!.y);
  await expect(page.locator(".main-panel")).toHaveClass(/project-workspace project-rose/);
  await expect(nav.getByRole("button", { name: "Open folder", exact: true })).toHaveCount(0);
  await nav.getByRole("button",{name:"Home",exact:true}).click();
  await expect(page.locator(".main-panel")).not.toHaveClass(/project-workspace/);
  await page.evaluate(() => (window as any).__test.cancelFolderPicker());
  await page.getByRole("button",{name:"Open folder",exact:true}).click();
  await expect(nav.getByRole("button",{name:"Home",exact:true})).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Selected project")).toContainText("Local only");
  await page.getByRole("button",{name:"Open folder",exact:true}).click();
  await expect(nav.getByRole("button",{name:"All files",exact:true})).toHaveAttribute("aria-current", "page");
  await expect(files).toContainText("Quick sheets");
  await nav.getByRole("button",{name:"App settings",exact:true}).click();
  await page.locator(".settings-folder-row").getByRole("button").filter({hasText:"Fieldnotes"}).click();
  await expect(nav.getByRole("button",{name:"All files",exact:true})).toHaveAttribute("aria-current", "page");
  await expect(files).toContainText("Unique local");
  await expect(files).not.toContainText("Quick sheets");
  await nav.getByRole("button",{name:"reMarkable",exact:true}).click();
  await expect(page.getByRole("button",{name:"Document Quick sheets",exact:true})).toBeVisible();
  await expect(scope).toContainText("Entire reMarkable library");
  await expect(nav).not.toHaveClass(/project-navigation/);
  await expect(page.getByLabel("Selected project")).toContainText("Local only");
  await nav.getByRole("button",{name:"All files",exact:true}).click();
  await expect(files).toContainText("Quick sheets");
  await expect(files).toContainText("Unique local");
  await page.getByRole("button",{name:"Open project Local only",exact:true}).click();
  await expect(nav).toHaveClass(/project-navigation/);
  await nav.getByRole("button",{name:"Projects",exact:true}).click();
  await page.locator(".project-select").filter({hasText:"Empty project"}).click();
  await nav.getByRole("button",{name:"Project files",exact:true}).click();
  await expect(page.getByRole("button",{name:"New note",exact:true})).toBeDisabled();
  await expect(scope).toContainText("Link folders in project settings");
  await expect(files).not.toContainText("Unique local");
  await expect(files).not.toContainText("Quick sheets");
  await nav.getByRole("button",{name:"Project tasks",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:"Complete: Local task",exact:true})).toHaveCount(0);
  await nav.getByRole("button",{name:"Project overview",exact:true}).click();
  await nav.getByRole("button",{name:"Projects",exact:true}).click();
  await page.locator(".project-select").filter({hasText:"Cloud only"}).click();
  await nav.getByRole("button",{name:"Project files",exact:true}).click();
  await expect(files).toContainText("Weekly notes");
  await expect(files).not.toContainText("Quick sheets");
  await expect(files).not.toContainText("Unique local");
  await expect(page.getByRole("button",{name:"New note",exact:true})).toBeDisabled();
  await page.setViewportSize({width:760,height:520});
  await expect(nav.getByRole("button",{name:"App settings",exact:true})).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/navigation-project-${testInfo.project.name}.png`});
  await page.getByRole("button",{name:"Close project Cloud only",exact:true}).click();
  await page.getByRole("button",{name:"Close project Empty project",exact:true}).click();
  await page.getByRole("button",{name:"Close project Local only",exact:true}).click();
  await expect(page.getByLabel("Selected project")).toHaveCount(0);
  await expect(nav.getByRole("button",{name:"Project files",exact:true})).toHaveCount(0);
  await expect(scope).toContainText("All added local folders");
  await expect(files).toContainText("Quick sheets");
  await expect(files).toContainText("Unique local");
  await page.screenshot({path:`test-results/navigation-all-${testInfo.project.name}.png`});
});

test("All files and All tasks keep every registered source when opening, editing and creating across folders", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("test-projects",JSON.stringify({active:null,library:null,revision:"legacy",projects:[{id:"both",name:"Both",description:"",color:"blue",pinned:false,archived:false,folders:["/test/Fieldnotes","/test/Projects"],defaultFolder:"/test/Fieldnotes"}]}));
  });
  await page.goto("/"); await page.reload();
  await page.evaluate(() => {const app=(window as any).__test;app.files["Plan.md"]="# Field plan\n- [ ] Field task";app.secondFiles["Plan.md"]="# Research plan\n- [ ] Research task";});
  const nav=page.getByRole("navigation",{name:"Main navigation"});
  await nav.getByRole("button",{name:"All files",exact:true}).click();
  await page.getByRole("button",{name:"Refresh files",exact:true}).click();
  const files=page.getByRole("region",{name:"Notes overview"});
  await expect(files).toContainText("Fieldnotes/Plan.md");
  await expect(files).toContainText("Projects/Plan.md");
  await files.getByRole("button",{name:"Plan",exact:true}).filter({hasText:"Projects/Plan.md"}).click();
  await expect(page.locator(".ProseMirror")).toContainText("Research plan");
  await expect(files).toContainText("Fieldnotes/Plan.md");
  await expect(page.getByRole("status",{name:"Current scope"})).toContainText("All added local folders");
  await nav.getByRole("button",{name:"All tasks",exact:true}).click();
  await expect(page.getByRole("checkbox",{name:"Complete: Field task",exact:true})).toBeVisible();
  await page.getByRole("checkbox",{name:"Complete: Research task",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__test.secondFiles["Plan.md"])).toContain("[x] Research task");
  expect(await page.evaluate(() => (window as any).__test.files["Plan.md"])).toContain("[ ] Field task");
  await nav.getByRole("button",{name:"All files",exact:true}).click();
  await page.getByRole("combobox",{name:"New note folder",exact:true}).selectOption("/test/Fieldnotes");
  await page.getByRole("button",{name:"New note",exact:true}).click();
  await page.getByRole("textbox",{name:"Note name",exact:true}).fill("Chosen destination");
  await page.getByRole("button",{name:"Create note",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).__test.files["Chosen destination.md"])).toBeDefined();
  expect(await page.evaluate(() => (window as any).__test.secondFiles["Chosen destination.md"])).toBeUndefined();
});


test("navigation badges keep global and project counts independent and ignore search filters", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("test-projects", JSON.stringify({ library: null, revision: "legacy", active: "research", projects: [
      { id: "research", name: "Research", description: "", color: "blue", pinned: false, archived: false, defaultFolder: "/test/Projects", folders: ["/test/Projects"] },
      { id: "old", name: "Archived", description: "", color: "sage", pinned: false, archived: true, defaultFolder: "/test/Fieldnotes", folders: ["/test/Fieldnotes"] },
    ] }));
  });
  await page.goto("/");
  await page.reload();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const count = (name: string) => nav.getByRole("button", { name, exact: true }).locator(".rail-badge");
  await expect(count("Projects")).toHaveText("1");
  await expect(count("All files")).toHaveText("7");
  await expect(count("Project files")).toHaveText("4");
  await expect(count("reMarkable")).toHaveText("0");
  await page.evaluate(() => (window as any).__test.external("Welcome.md", "# Local\n- [ ] Local task\n- [x] Finished task"));
  await expect(count("All tasks")).toHaveText("2");
  await expect(count("Project tasks")).toHaveText("1");
  await nav.getByRole("button", { name: "Project files", exact: true }).click();
  await page.getByPlaceholder("Search names or content").fill("Research");
  await expect(count("Project files")).toHaveText("4");
  await expect(count("All files")).toHaveText("7");
  await nav.getByRole("button", { name: "Project tasks", exact: true }).click();
  await page.getByRole("checkbox", { name: "Complete: Compare the sources", exact: true }).click();
  await expect(count("Project tasks")).toHaveText("0");
  await expect(count("All tasks")).toHaveText("1");
  await nav.getByRole("button", { name: "Home", exact: true }).click();
  await expect(count("All files")).toHaveText("7");
  await expect(count("Project files")).toHaveText("4");
});

test("navigation badges refresh reMarkable documents without downloading pages and mark unread tasks", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const count = (name: string) => nav.getByRole("button", { name, exact: true }).locator(".rail-badge");
  await expect(count("All files")).toHaveText("3");
  await expect(count("All tasks")).toHaveText("0");
  await page.evaluate(() => { (window as any).__test.remarkable.connected = true; });
  await nav.getByRole("button", { name: "reMarkable", exact: true }).click();
  await expect(count("reMarkable")).toHaveText("3");
  await expect(count("All files")).toHaveText("6");
  await expect(count("All tasks")).toHaveText("0+");
  expect(await page.evaluate(() => (window as any).__test.remarkable.calls.filter((call: string) => call.startsWith("remarkable_preview")))).toEqual([]);
  await page.evaluate((data) => { (window as any).__test.remarkable.pageData = [data, data, data, data]; }, readFileSync(new URL("./fixtures/remarkable/v6-sample.rm", import.meta.url)).toString("base64"));
  await nav.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(count("All tasks")).toHaveText("8");
  await nav.getByRole("button", { name: "reMarkable", exact: true }).click();
  await page.evaluate(() => { const rm = (window as any).__test.remarkable; rm.items = rm.items.filter((item: any) => item.id !== "inbox"); });
  await page.getByRole("button", { name: "Refresh reMarkable", exact: true }).click();
  await expect(count("reMarkable")).toHaveText("2");
  await expect(count("All files")).toHaveText("5");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(count("reMarkable")).toHaveText("0");
  await expect(count("All files")).toHaveText("3");
  await expect(count("All tasks")).toHaveText("0");
});


test("navigation badges include linked reMarkable folders without double-counting their tasks", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-projects")) return;
    localStorage.setItem("test-projects", JSON.stringify({ library: null, revision: "legacy", active: "notebooks", projects: [
      { id: "notebooks", name: "Notebooks", description: "", color: "rose", pinned: false, archived: false, defaultFolder: null, folders: [], remarkableFolders: [{ id: "work", name: "Work" }] },
    ] }));
  });
  await page.goto("/"); await page.reload();
  await page.evaluate((data) => { const rm = (window as any).__test.remarkable; rm.connected = true; rm.pageData = [data, data, data, data]; window.dispatchEvent(new Event("notesdive-remarkable-changed")); }, readFileSync(new URL("./fixtures/remarkable/v6-sample.rm", import.meta.url)).toString("base64"));
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const count = (name: string) => nav.getByRole("button", { name, exact: true }).locator(".rail-badge");
  await expect(count("All files")).toHaveText("6");
  await expect(count("Project files")).toHaveText("2");
  await expect(count("Project tasks")).toHaveText("0+");
  await nav.getByRole("button", { name: "Project tasks", exact: true }).click();
  await expect(count("Project tasks")).toHaveText("6");
  await expect(count("All tasks")).toHaveText("6+");
  await nav.getByRole("button", { name: "All tasks", exact: true }).click();
  await expect(count("All tasks")).toHaveText("8");
  await expect(count("Project tasks")).toHaveText("6");
});


test("project bookmarks keep multiple projects open, switch scope, persist and close individually", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("test-projects")) return;
    const base = { description: "", pinned: false, archived: false };
    localStorage.setItem("test-projects", JSON.stringify({ library: null, revision: "legacy", active: "field", projects: [
      { ...base, id: "field", name: "Field work", color: "rose", folders: ["/test/Fieldnotes"], defaultFolder: "/test/Fieldnotes" },
      { ...base, id: "research", name: "Research", color: "blue", folders: ["/test/Projects"], defaultFolder: "/test/Projects" },
    ] }));
  });
  await page.goto("/"); await page.reload();
  const tabs = page.getByRole("group", { name: "Open projects", exact: true });
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(tabs.getByRole("button", { name: "Open project Field work", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Projects", exact: true }).click();
  await page.locator(".project-select").filter({ hasText: "Research" }).click();
  await expect(tabs.locator(".project-bookmark")).toHaveCount(2);
  await nav.getByRole("button", { name: "Project files", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Project files", exact: true }).locator(".rail-badge")).toHaveText("4");
  await tabs.getByRole("button", { name: "Open project Field work", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Project files", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("button", { name: "Project files", exact: true }).locator(".rail-badge")).toHaveText("3");
  await expect(nav.getByRole("button", { name: "All files", exact: true }).locator(".rail-badge")).toHaveText("7");
  await expect(tabs.getByRole("button", { name: "Open project Field work", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(tabs.getByRole("button", { name: "Open project Research", exact: true })).toHaveAttribute("aria-pressed", "false");
  await tabs.getByRole("button", { name: "Close project Research", exact: true }).click();
  await expect(tabs.locator(".project-bookmark")).toHaveCount(1);
  await expect(page.getByLabel("Selected project")).toContainText("Field work");
  await nav.getByRole("button", { name: "Projects", exact: true }).click();
  await page.locator(".project-select").filter({ hasText: "Research" }).click();
  await tabs.getByRole("button", { name: "Open project Field work", exact: true }).click();
  await page.reload();
  await expect(tabs.locator(".project-bookmark")).toHaveCount(2);
  await tabs.getByRole("button", { name: "Open project Research", exact: true }).click();
  await expect(page.getByLabel("Selected project")).toContainText("Research");
  await page.setViewportSize({ width: 760, height: 520 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/multiple-project-tabs-${testInfo.project.name}.png` });
  await tabs.getByRole("button", { name: "Close project Research", exact: true }).click();
  await expect(tabs.locator(".project-bookmark")).toHaveCount(1);
  await expect(page.getByLabel("Selected project")).toContainText("Field work");
  await tabs.getByRole("button", { name: "Close project Field work", exact: true }).click();
  await expect(tabs).toHaveCount(0);
  await page.reload();
  await expect(tabs).toHaveCount(0);
  await nav.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("region", { name: "My projects" }).getByRole("button").filter({ hasText: "Research" }).click();
  await expect(tabs.locator(".project-bookmark")).toHaveCount(1);
  await expect(page.getByLabel("Selected project")).toContainText("Research");
  await expect(nav.getByRole("button", { name: "All files", exact: true }).locator(".rail-badge")).toHaveText("7");
});

test("project bookmarks stay with their library and archived projects leave the margin", async ({ page }) => {
  await page.goto("/");
  await createResearchProject(page);
  const tabs = page.getByRole("group", { name: "Open projects", exact: true });
  await expect(tabs).toContainText("Research project");
  await showSettings(page);
  await page.getByRole("combobox", { name: "Current library" }).selectOption("");
  await expect(tabs).toHaveCount(0);
  await page.getByRole("combobox", { name: "Current library" }).selectOption("/test/libraries/Test library");
  await expect(tabs).toContainText("Research project");
  await tabs.getByRole("button", { name: "Open project Research project", exact: true }).click();
  await page.getByRole("button", { name: "Archive project", exact: true }).click();
  await expect(tabs).toHaveCount(0);
  await page.reload();
  await expect(tabs).toHaveCount(0);
});


test("the selected project bookmark stays in view when many projects are open", async ({ page }) => {
  await page.addInitScript(() => {
    const projects = Array.from({ length: 8 }, (_, index) => ({ id: `project-${index}`, name: `Project ${index}`, description: "", color: "sage", pinned: false, archived: false, folders: [], defaultFolder: null }));
    if (!localStorage.getItem("test-projects")) localStorage.setItem("test-projects", JSON.stringify({ library: null, revision: "legacy", active: "project-7", projects }));
    localStorage.setItem("notesdive-open-projects", JSON.stringify({ null: projects.map((project) => project.id) }));
  });
  await page.setViewportSize({ width: 760, height: 520 });
  await page.goto("/"); await page.reload();
  const tabs = page.getByRole("group", { name: "Open projects", exact: true });
  await expect(tabs.locator(".project-bookmark")).toHaveCount(8);
  await expect(tabs.getByRole("button", { name: "Open project Project 7", exact: true })).toBeInViewport();
  await expect(tabs.getByRole("button", { name: "Open project Project 0", exact: true })).not.toBeInViewport();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.locator(".project-select").filter({ hasText: /^Project 0/ }).click();
  await expect(tabs.getByRole("button", { name: "Open project Project 0", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("manual folder sync transfers a note and reports failures and conflicts", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("test-projects", JSON.stringify({ active: "summa", library: null, revision: "legacy", projects: [{
    id: "summa", name: "Summa", description: "", color: "sage", pinned: false, archived: false,
    folders: ["/test/Fieldnotes"], defaultFolder: "/test/Fieldnotes", remarkableFolders: [{ id: "work", name: "3.1 Summa" }],
    remarkableSync: [{ id: "ideas", localFolder: "/test/Fieldnotes", path: "Ideas", remoteParentId: "work", enabled: true }],
  }] })));
  await page.goto("/"); await page.reload();
  await page.evaluate((pdfData) => {
    const original = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__syncTest = { fail: false, actions: [] };
    (window as any).__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (command === "remarkable_sync_snapshot") {
        if ((window as any).__syncTest.fail) throw "reMarkable changed during sync. Run sync again.";
        return { id: "snapshot", notes: [{ mapping: { path: "Ideas/test.md", documentId: "be11a099-7c68-4216-94c8-1cc01591717a", pageId: "page", localHash: "", remoteHash: "" }, local: { content: "# Test\n\n- [ ] Check\n", revision: "first" } }], pdfs: [{ path: "Ideas/read.pdf", data: pdfData }, { path: "Ideas/broken.pdf", data: btoa("%PDF-broken") }] };
      }
      if (command === "remarkable_sync_apply") {
        (window as any).__syncTest.actions = args.actions;
        (window as any).__syncTest.pdfActions = args.pdfActions;
        const context = await original("load_projects");
        context.projects[0].remarkableSync[0].state = { files: [], folders: {}, lastSync: 1791144000000 };
        const saved = await original("save_projects", { config: context });
        return { context: saved, uploaded: 1, downloaded: 0, unchanged: 0, createdFolders: 1, conflicts: ["Ideas/test.remarkable-conflict-abc.md"], warnings: [] };
      }
      if (command === "remarkable_sync_cancel") return;
      return original(command, args);
    };
  }, Buffer.from(samplePdf()).toString("base64"));
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Project files", exact: true }).click();
  const tree = page.getByRole("navigation", { name: "File folders" });
  await tree.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true }).click();
  await tree.getByRole("button", { name: "Folder Fieldnotes/Ideas", exact: true }).click();
  await page.getByRole("button", { name: "Sync setup for Ideas", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(dialog).toContainText("1 sent · 0 received · 0 up to date");
  await expect(dialog).toContainText("1 folders created on reMarkable.");
  await expect(dialog).toContainText("Sync never deletes files or folders on either device.");
  await expect(dialog).toContainText("Ideas/test.remarkable-conflict-abc.md");
  const actions = await page.evaluate(() => (window as any).__syncTest.actions);
  expect(actions[0].action).toBe("upload"); expect(Buffer.from(actions[0].data, "base64").subarray(0, 43).toString()).toContain("reMarkable .lines file, version=6");
  const pdfActions = await page.evaluate(() => (window as any).__syncTest.pdfActions);
  expect(pdfActions[0]).toEqual({ path: "Ideas/read.pdf", pageCount: 1, error: null });
  expect(pdfActions[1].error).toBeTruthy();
  await page.evaluate(() => { (window as any).__syncTest.fail = true; });
  await dialog.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("reMarkable changed during sync");
  await expect(dialog.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
});

test("folder sync cloud twin opens the shared setup from its tree icon", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("test-projects", JSON.stringify({ active: "summa", library: null, revision: "legacy", projects: [{
    id: "summa", name: "Summa", description: "", color: "sage", pinned: false, archived: false,
    folders: ["/test/Fieldnotes"], defaultFolder: "/test/Fieldnotes", remarkableFolders: [{ id: "work", name: "Work" }],
    remarkableSync: [{ id: "ideas", localFolder: "/test/Fieldnotes", path: "Ideas", remoteParentId: "work", enabled: true,
      state: { files: [], folders: { Ideas: "meetings" } } }],
  }] })));
  await page.goto("/"); await page.reload();
  await page.evaluate(() => { (window as any).__test.remarkable.connected = true; window.dispatchEvent(new Event("notesdive-remarkable-changed")); });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Project files", exact: true }).click();
  const tree = page.getByRole("navigation", { name: "File folders" });
  await tree.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true }).click();
  await expect(tree.getByRole("button", { name: "Open sync for Fieldnotes/Ideas", exact: true })).toBeVisible();
  await tree.getByRole("button", { name: "Toggle folder reMarkable · Work", exact: true }).click();
  const cloudSync = tree.getByRole("button", { name: "Open sync for reMarkable · Work/Meetings", exact: true });
  await expect(cloudSync).toBeVisible();
  await cloudSync.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Ideas, on both devices.");
  await expect(dialog).toContainText("Fieldnotes/Ideas");
  await expect(dialog.getByRole("button", { name: "Sync now", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(cloudSync).toBeFocused();
  await expect(tree.getByRole("button", { name: "Folder reMarkable · Work/Meetings", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("switch", { name: "Sync Ideas with reMarkable", exact: true }).click();
  await dialog.getByRole("button", { name: "Pause sync", exact: true }).click();
  await expect(cloudSync).toHaveCount(0);
  await expect(tree.getByRole("button", { name: "Open sync for Fieldnotes/Ideas", exact: true })).toHaveCount(0);
});

test("list toolbar converts existing lists and preserves nested items", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await replaceFixture(page, "1. First\n2. Second\n   1. Nested\n3. Third\n");
  const editor = page.getByRole("textbox", { name: "Visual editor" });
  await expect(editor).toBeEditable();
  await editor.locator("p").filter({ hasText: /^Second$/ }).click();
  await page.getByRole("button", { name: "Bullet list", exact: true }).click();
  await expect(editor.locator(":scope > ul > li")).toHaveCount(3);
  await expect(editor.locator("ul ol > li")).toHaveText("Nested");
  await page.getByRole("button", { name: "Numbered list", exact: true }).click();
  await expect(editor.locator(":scope > ol > li")).toHaveCount(3);
  await editor.locator("p").filter({ hasText: /^Nested$/ }).click();
  await page.getByRole("button", { name: "Bullet list", exact: true }).click();
  await expect(editor.locator("ol ul > li")).toHaveText("Nested");
  await expect(editor.locator(":scope > ol > li")).toHaveCount(3);
  await page.getByRole("button", { name: "Save note" }).click();
  expect(await diskContent(page)).toMatch(/[-*] Nested/);
});


test("clipboard screenshots paste into both editors as local Markdown images", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await replaceFixture(page, "Screenshot here\n");
  const paste = async (label: string) => {
    const editor = page.getByRole("textbox", { name: label, exact: true });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await editor.evaluate((element) => {
      const data = new DataTransfer();
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII="), c => c.charCodeAt(0));
      data.items.add(new File([bytes], "Screenshot.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
  };
  await paste("Visual editor");
  await expect(page.getByRole("textbox", { name: "Visual editor" }).locator(".image-placeholder img")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Visual editor" }).locator(".image-placeholder")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Visual editor" }).locator(".image-placeholder img")).toHaveCount(1);
  await page.getByRole("button", { name: "Save note" }).click();
  expect(await diskContent(page)).toContain("![Image](image-test.png)");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await replaceFixture(page, "Source screenshot\n");
  // replaceFixture reopens visual mode; switch back to the source editor.
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await paste("Markdown editor");
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toContainText("![Image](image-test.png)");
  await page.getByRole("button", { name: "Save note" }).click();
  expect(await diskContent(page)).toContain("![Image](image-test.png)");
});


test("project widget buttons create tasks and links in the selected folder", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("test-projects", JSON.stringify({ active: "quick", library: null, revision: "legacy", projects: [{ id: "quick", name: "Quick project", description: "", color: "sage", pinned: false, archived: false, folders: ["/test/Fieldnotes"], defaultFolder: "/test/Fieldnotes" }] })));
  await page.goto("/"); await page.reload();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Projects", exact: true }).click();
  await page.locator(".project-select").filter({ hasText: /^Quick project/ }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("Call the supplier");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Complete Call the supplier in Fieldnotes" })).toBeVisible();
  await page.getByRole("button", { name: "New link", exact: true }).click();
  await page.getByRole("textbox", { name: "Link title", exact: true }).fill("Supplier [catalog]");
  await page.getByRole("textbox", { name: "Link URL", exact: true }).fill("https://example.com/catalog");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(page.getByRole("link", { name: /Supplier \[catalog\]/ })).toHaveAttribute("href", "https://example.com/catalog");
  await page.locator(".project-files-panel").getByRole("button", { name: "New note", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Marp renders themes, directives, speaker notes and local backgrounds without fetching note resources", async ({ page }, testInfo) => {
  const remoteRequests: string[] = [];
  await page.route("https://marp-tracker.invalid/**", (route) => { remoteRequests.push(route.request().url()); return route.abort(); });
  await page.goto("/");
  const markdown = `---
marp: true
theme: gaia
size: 4:3
paginate: true
footer: Workshop
style: |
  @import "https://marp-tracker.invalid/theme.css";
  section h1 { color: #123456; }
  .pdf-toolbar { display: none; }
  section { --tracker: u\\72l(https://marp-tracker.invalid/escaped); }
---
<!-- _class: lead -->
<!-- _paginate: false -->
# Eindkwaliteit en mobiele UI

## Prototype workshop 4

BIM2, week 8

Correcte werking en verzorgde bediening aantonen

<!--
Bespreek **mobiele bediening**.

---

Dit blijft een notitie op dia 1.
-->

---
# Tweede dia

[Workshop website](https://example.com/workshop)

![width:180px Local diagram](diagram.svg)

![bg](diagram.svg)

![Remote image](https://marp-tracker.invalid/image.png)



---
# Derde dia

<!-- _backgroundColor: #112233 -->
<!-- _color: white -->
`;
  await page.evaluate((markdown) => {
    (window as any).__test.external("Workshop.md", markdown);
    (window as any).__test.files["diagram.svg"] = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#81a178"/><circle cx="100" cy="100" r="55" fill="#fff"/></svg>';
  }, markdown);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Workshop", exact: true }).click();
  await page.getByRole("button", { name: "Focus on document" }).click();
  const viewer = page.getByLabel("Marp slide viewer");
  const title = viewer.getByRole("heading", { name: "Eindkwaliteit en mobiele UI", exact: true });
  await expect(title).toBeVisible();
  await expect(viewer.locator('section[id="1"]')).toHaveCSS("width", "960px");
  await expect(title).toHaveCSS("text-align", "center");
  await expect(title).toHaveCSS("color", "rgb(18, 52, 86)");
  await expect(viewer.locator("section.lead")).toHaveCount(1);
  await expect(viewer.locator(".pdf-toolbar")).toBeVisible();
  await expect(viewer.locator('[data-marpit-pagination]')).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Speaker notes" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show speaker notes" }).click();
  const notes = page.getByRole("complementary", { name: "Speaker notes" });
  await expect(notes).toContainText("Dit blijft een notitie op dia 1.");
  await expect(notes.locator("strong")).toHaveText("mobiele bediening");
  await expect.poll(() => viewer.locator(".marp-slide").evaluate((el) => el.getBoundingClientRect().height <= el.parentElement!.getBoundingClientRect().height + 1)).toBe(true);
  await page.screenshot({ path: `test-results/marp-theme-notes-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Next slide" }).click();
  await expect(viewer.getByRole("heading", { name: "Tweede dia", exact: true })).toBeVisible();
  await expect(notes).toContainText("No speaker notes for this slide.");
  await expect(viewer.locator('section[id="2"]')).toHaveAttribute("data-marpit-pagination", "2");
  await expect(viewer.locator('img[data-marp-image="diagram.svg"]')).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
  await expect(viewer.locator('img[data-marp-image="diagram.svg"]')).toHaveCSS("width", "180px");
  await expect.poll(() => viewer.locator("section[data-marp-background]").evaluate((element) => (element as HTMLElement).style.backgroundImage)).toContain("data:image/svg+xml;base64,");
  await viewer.getByRole("link", { name: "Workshop website" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__test.openedWebLink)).toBe("https://example.com/workshop");
  await page.keyboard.press("End");
  await expect(viewer.getByRole("heading", { name: "Derde dia", exact: true })).toBeVisible();
  await expect(viewer.locator('section[id="3"]')).toHaveCSS("background-color", "rgb(17, 34, 51)");
  await page.getByRole("button", { name: "Show slide grid" }).click();
  await expect(viewer.getByRole("button", { name: /^Open slide/ })).toHaveCount(3);
  await viewer.getByRole("button", { name: "Open slide 1", exact: true }).click();
  await expect(title).toBeVisible();
  await page.setViewportSize({ width: 800, height: 620 });
  await expect(title).toBeVisible();
  await expect.poll(() => viewer.locator(".marp-slide").evaluate((element) => {
    const slide = element.getBoundingClientRect();
    const host = element.parentElement!.getBoundingClientRect();
    return slide.left >= host.left - 1 && slide.right <= host.right + 1 && slide.top >= host.top - 1 && slide.bottom <= host.bottom + 1;
  })).toBe(true);
  expect(await page.evaluate(() => (window as any).__test.files["Workshop.md"])).toBe(markdown);
  expect(remoteRequests).toEqual([]);
});

test("Marp renders HTML columns, inline styles and local images without executing HTML or fetching resources", async ({ page }, testInfo) => {
  const remoteRequests: string[] = [];
  await page.route("https://marp-tracker.invalid/**", (route) => { remoteRequests.push(route.request().url()); return route.abort(); });
  await page.goto("/");
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.files["diagram.svg"] = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="green"/></svg>';
    app.external("HTML slides.md", `---
marp: true
style: |
  .twee-kanten { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
---
# Jij bepaalt, de AI helpt bouwen

<div class="twee-kanten"><div><h2>Jij houdt de regie</h2><ul><li>Kiest de gebruikershandeling</li><li>Beslist en bewaart</li></ul></div><div><h2>AI helpt bouwen</h2><ul><li>Stelt code en schermen voor</li><li>Helpt een fout onderzoeken</li></ul></div></div>

Een <strong style="color: #c6002a">prompt</strong> is de opdracht die je aan de AI geeft.

<img src="diagram.svg" width="80" onload="window.htmlExecuted=true">
<img src="https://marp-tracker.invalid/image" srcset="https://marp-tracker.invalid/other 2x" onerror="window.htmlExecuted=true">
<div style="background-image:url(https://marp-tracker.invalid/background)"></div>
<a href="https://example.com/html" onclick="window.htmlExecuted=true">HTML website</a>
<script>window.htmlExecuted=true</script>
`);
  });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "HTML slides", exact: true }).click();
  await page.getByRole("button", { name: "Focus on document" }).click();
  const viewer = page.getByLabel("Marp slide viewer");
  const columns = viewer.locator(".twee-kanten");
  await expect(columns).toHaveCSS("display", "grid");
  await expect(columns.locator(":scope > div")).toHaveCount(2);
  await expect(columns.getByRole("heading", { name: "Jij houdt de regie" })).toBeVisible();
  expect(await columns.evaluate((element) => {
    const [left, right] = Array.from(element.children).map((child) => child.getBoundingClientRect());
    return right.left > left.left && Math.abs(right.top - left.top) < 1;
  })).toBe(true);
  await expect(viewer.locator("strong")).toHaveCSS("color", "rgb(198, 0, 42)");
  await expect(viewer.locator('img[data-marp-image="diagram.svg"]')).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/);
  await viewer.getByRole("link", { name: "HTML website" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__test.openedWebLink)).toBe("https://example.com/html");
  await page.screenshot({ path: testInfo.outputPath("marp-html-columns.png") });
  await page.getByRole("button", { name: "Start presentation", exact: true }).click();
  const presentation = page.getByRole("dialog", { name: "Presentation", exact: true });
  await expect(presentation.locator(".twee-kanten")).toHaveCSS("display", "grid");
  await expect(presentation.getByRole("heading", { name: "AI helpt bouwen", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).htmlExecuted)).toBeUndefined();
  expect(remoteRequests).toEqual([]);
});

test("Marp presents fullscreen, hides notes, navigates and returns to editable slides", async ({ page }, testInfo) => {
  const markdown = "---\nmarp: true\ntheme: uncover\nsize: 4:3\n---\n# First slide\n<!-- Private speaker note -->\n---\n# Second slide\n---\n# Third slide";
  await page.goto("/");
  await page.evaluate((text) => (window as any).__test.external("Present.md", text), markdown);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  const viewer = page.getByLabel("Marp slide viewer");
  await expect(viewer.getByRole("heading", { name: "First slide" })).toBeVisible();
  await viewer.getByRole("button", { name: "Show speaker notes" }).click();
  await expect(page.getByRole("complementary", { name: "Speaker notes" })).toContainText("Private speaker note");
  await viewer.getByRole("button", { name: "Next slide" }).click();
  await viewer.getByRole("button", { name: "Show slide grid" }).click();
  await viewer.getByRole("button", { name: "Start presentation" }).click();
  const presentation = page.getByRole("dialog", { name: "Presentation", exact: true });
  await expect(presentation.getByRole("heading", { name: "Second slide" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__test.fullscreen.active)).toBe(true);
  await expect(page.getByRole("complementary", { name: "Speaker notes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Markdown", exact: true })).toHaveCount(0);
  expect(await presentation.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 820 });
  await expect.poll(() => presentation.locator(".marp-slide").evaluate((element) => {
    const slide = element.getBoundingClientRect();
    return slide.left >= -1 && slide.right <= innerWidth + 1 && slide.top >= -1 && slide.bottom <= innerHeight + 1;
  })).toBe(true);
  await page.keyboard.press("Space");
  await expect(presentation.getByRole("heading", { name: "Third slide" })).toBeVisible();
  await expect(presentation.getByRole("button", { name: "Next slide" })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(presentation.getByRole("heading", { name: "Third slide" })).toBeVisible();
  await page.keyboard.press("Shift+Space");
  await expect(presentation.getByRole("heading", { name: "Second slide" })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(presentation.getByRole("heading", { name: "First slide" })).toBeVisible();
  await expect(presentation.getByRole("button", { name: "Previous slide" })).toBeDisabled();
  await page.keyboard.press("PageDown");
  await expect(presentation.getByRole("heading", { name: "Second slide" })).toBeVisible();
  await expect(presentation.locator(".marp-presentation-controls")).toHaveCSS("opacity", "0");
  await page.screenshot({ path: `test-results/marp-fullscreen-${testInfo.project.name}.png` });
  await page.mouse.move(20, 20);
  await expect(presentation.locator(".marp-presentation-controls")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(presentation).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__test.fullscreen.calls)).toEqual([true, false]);
  await expect(viewer.getByRole("heading", { name: "Second slide" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Start presentation" })).toBeFocused();
  // Entering from an already fullscreen window keeps that window fullscreen.
  await page.evaluate(() => { (window as any).__test.fullscreen.active = true; });
  await viewer.getByRole("button", { name: "Start presentation" }).click();
  await page.keyboard.press("Shift+Tab");
  await expect(presentation.getByRole("button", { name: "Exit presentation" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(presentation).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__test.fullscreen.active)).toBe(true);
  expect(await page.evaluate(() => (window as any).__test.fullscreen.calls)).toEqual([true, false]);
  await page.getByRole("button", { name: "Edit Markdown", exact: true }).click();
  await expect(page.locator(".cm-editor")).toContainText("Private speaker note");
  expect(await page.evaluate(() => (window as any).__test.files["Present.md"])).toBe(markdown);
});

test("Marp restores the viewer on fullscreen failure and on closing during entry", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.external("Present.md", "---\nmarp: true\n---\n# Presentation");
    app.fullscreen.fail = true;
  });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  const start = page.getByRole("button", { name: "Start presentation" });
  await start.click();
  await expect(page.getByRole("alert")).toContainText("Could not start fullscreen presentation");
  await expect(page.getByRole("dialog", { name: "Presentation", exact: true })).toHaveCount(0);
  expect(await page.locator("#root").evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await page.evaluate(() => { const fs = (window as any).__test.fullscreen; fs.fail = false; fs.delay = true; });
  await start.click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__test.fullscreen.finish)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Presentation", exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__test.fullscreen.finish());
  await expect.poll(() => page.evaluate(() => (window as any).__test.fullscreen.calls)).toEqual([true, false]);
  await expect(start).toBeFocused();
});

test("Marp supports default and uncover themes and keeps malformed CSS editable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => (window as any).__test.external("Themes.md", "---\nmarp: true\ntheme: default\n---\n# Theme preview"));
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Themes", exact: true }).click();
  const title = page.getByRole("heading", { name: "Theme preview", exact: true });
  await expect(title).toBeVisible();
  const defaultFont = await title.evaluate((element) => getComputedStyle(element).fontFamily);
  await page.evaluate(() => (window as any).__test.external("Themes.md", "---\nmarp: true\ntheme: uncover\n---\n# Theme preview"));
  await expect(title).toHaveCSS("text-align", "center");
  expect(await title.evaluate((element) => getComputedStyle(element).fontFamily)).not.toBe(defaultFont);
  await page.evaluate(() => (window as any).__test.external("Themes.md", "---\nmarp: true\nstyle: |\n  section { color: ; }}\n---\n# Invalid CSS"));
  await expect(page.getByRole("heading", { name: "Invalid CSS", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Markdown", exact: true }).click();
  await expect(page.locator(".cm-editor")).toContainText("Invalid CSS");
});

test("Marp themes are shared through the library folder, can be reloaded and preserve notes", async ({ page }, testInfo) => {
  await page.goto("/");
  await createLibrary(page, "Work");
  const themes = page.getByRole("region", { name: "Presentation themes" });
  await expect(themes).toContainText("/test/libraries/Work/themes");
  await expect(themes).toContainText("No custom themes yet");
  const markdown = "---\nmarp: true\ntheme: workshop\n---\n# Shared theme";
  await page.evaluate((markdown) => {
    const app = (window as any).__test;
    app.libraryFiles["/test/libraries/Work"] = { "themes/workshop.css": '/* @theme workshop */\n@import "default";\nsection h1 { color: #be1234; }\nsection { background: #eef5ec; }' };
    app.external("Shared slides.md", markdown);
  }, markdown);
  await themes.getByRole("button", { name: "Reload library themes" }).click();
  await expect(themes).toContainText("workshop.css");
  await expect(themes).toContainText("theme: workshop");
  await page.screenshot({ path: `test-results/library-themes-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Shared slides", exact: true }).click();
  const title = page.getByRole("heading", { name: "Shared theme", exact: true });
  await expect(title).toHaveCSS("color", "rgb(190, 18, 52)");
  await page.evaluate(() => { (window as any).__test.libraryFiles["/test/libraries/Work"]["themes/workshop.css"] = '/* @theme workshop */\n@import "default";\nsection h1 { color: #123456; }'; });
  await page.getByRole("button", { name: "Reload presentation theme" }).click();
  await expect(title).toHaveCSS("color", "rgb(18, 52, 86)");
  await page.evaluate(() => { (window as any).__test.libraryFiles["/test/libraries/Work"]["themes/workshop.css"] += '/*' + ' '.repeat(8 * 1024 * 1024) + '*/'; });
  await page.getByRole("button", { name: "Reload presentation theme" }).click();
  await expect(title).toHaveCSS("color", "rgb(18, 52, 86)");
  await expect(page.locator(".marp-theme-status")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__test.libraryFiles["/test/libraries/Work"]["themes/workshop.css"] += ' '.repeat(8 * 1024 * 1024); });
  await page.getByRole("button", { name: "Reload presentation theme" }).click();
  const themeStatus = page.getByRole("status").filter({ hasText: 'Theme "workshop" could not be loaded' });
  await expect(themeStatus).toContainText("exceeds the 16 MiB limit");
  await expect(themeStatus).toContainText("/test/libraries/Work/themes/workshop.css");
  await expect(themeStatus).toContainText("Showing the default theme");
  await page.evaluate(() => { delete (window as any).__test.libraryFiles["/test/libraries/Work"]["themes/workshop.css"]; });
  await page.getByRole("button", { name: "Reload presentation theme" }).click();
  await expect(page.getByRole("status").filter({ hasText: 'Theme "workshop" not found' })).toContainText("Showing the default theme");
  await expect(title).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.files["Shared slides.md"])).toBe(markdown);
  await showSettings(page);
  await page.evaluate(() => (window as any).__test.themeFolders.delete("/test/libraries/Work"));
  await themes.getByRole("button", { name: "Reload library themes" }).click();
  await themes.getByRole("button", { name: "Create themes folder" }).click();
  await expect(themes).toContainText("No custom themes yet");
  expect(await page.evaluate(() => (window as any).__test.themeFolders.has("/test/libraries/Work"))).toBe(true);
});

test("Marp companion theme images load from the CSS folder, reload and work fullscreen", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().startsWith("https://example.com/")) requests.push(request.url()); });
  await page.goto("/");
  await createLibrary(page, "Work");
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.libraryFiles["/test/libraries/Work"] = {
      "themes/workshop.css": '/* @theme workshop */\n@import "default"; section { background-image: url("workshop/background.svg"), url("https://example.com/track.png"); background-size: cover; }',
      "themes/workshop/background.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#eef5ec"/></svg>',
    };
    app.external("Shared graphics.md", "---\nmarp: true\ntheme: workshop\n---\n# Local theme artwork");
  });
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Shared graphics", exact: true }).click();
  const viewer = page.getByLabel("Marp slide viewer");
  await expect(viewer.locator("section")).toHaveCSS("background-image", /data:image\/svg\+xml;base64,/);
  const original = await viewer.locator("section").evaluate((element) => getComputedStyle(element).backgroundImage);
  await viewer.getByRole("button", { name: "Start presentation" }).click();
  const presentation = page.getByRole("dialog", { name: "Presentation", exact: true });
  await expect(presentation.locator("section")).toHaveCSS("background-image", /data:image\/svg\+xml;base64,/);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { (window as any).__test.libraryFiles["/test/libraries/Work"]["themes/workshop/background.svg"] = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#123456"/></svg>'; });
  await viewer.getByRole("button", { name: "Reload presentation theme" }).click();
  await expect.poll(() => viewer.locator("section").evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe(original);
  await page.evaluate(() => { delete (window as any).__test.libraryFiles["/test/libraries/Work"]["themes/workshop/background.svg"]; });
  await viewer.getByRole("button", { name: "Reload presentation theme" }).click();
  await expect(viewer.getByRole("status")).toContainText("theme images are unavailable");
  await expect(viewer.getByRole("heading", { name: "Local theme artwork" })).toBeVisible();
  expect(requests).toEqual([]);
});

test("cockpit attention and saved tag streams filter real Markdown actions", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as any).__test.external("Cockpit.md", "# Cockpit\n\n- [ ] Overdue decision [due:: 2000-01-01] #decisions\n- [ ] Waiting on input [stage:: blocked] #review\n- [ ] High priority action [priority:: high] #decisions\n- [x] Completed decision [due:: 2000-01-01] #decisions\n");
  });
  const attention = page.getByRole("region", { name: "Needs attention" });
  const focus = page.getByRole("region", { name: "Open project tasks" });
  const streams = page.getByRole("region", { name: "Streams", exact: true });
  await expect(attention.getByRole("button", { name: "1 overdue", exact: true })).toBeEnabled();
  await attention.getByRole("button", { name: "1 overdue", exact: true }).click();
  await expect(focus.getByRole("checkbox")).toHaveCount(1);
  await expect(focus).toContainText("Overdue decision");
  await attention.getByRole("button", { name: "1 blocked", exact: true }).click();
  await expect(focus).toContainText("Waiting on input");
  await expect(focus).not.toContainText("Overdue decision");
  await attention.getByRole("button", { name: "1 blocked", exact: true }).click();
  await streams.getByRole("button", { name: "Add stream" }).click();
  await streams.getByRole("textbox", { name: "Stream name" }).fill("Decisions");
  await streams.getByRole("textbox", { name: "Stream task tag" }).fill("#decisions");
  await streams.getByRole("button", { name: "Save stream" }).click();
  await expect(streams.getByRole("button", { name: "Decisions", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(streams.getByRole("checkbox")).toHaveCount(2);
  await expect(streams).not.toContainText("Waiting on input");
  await expect(streams).not.toContainText("Completed decision");
  await streams.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(streams.getByRole("checkbox")).toHaveCount(0);
  await expect(streams).toContainText("No work matches this stream.");
  await streams.getByRole("button", { name: "Actions", exact: true }).click();
  await expect(streams.getByRole("checkbox")).toHaveCount(2);
  await streams.getByRole("checkbox", { name: "Complete Overdue decision", exact: true }).click();
  await expect(attention.getByRole("button", { name: "0 overdue", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__test.files["Cockpit.md"])).toContain("- [x] Overdue decision [due:: 2000-01-01] #decisions");
  await page.reload();
  await expect(streams.getByRole("button", { name: "Decisions", exact: true })).toBeVisible();
  await streams.getByRole("button", { name: "Decisions", exact: true }).click();
  await expect(streams.getByRole("button", { name: "Remove stream" })).toBeVisible();
  await streams.getByRole("button", { name: "Remove stream" }).click();
  await expect(streams.getByRole("button", { name: "Decisions", exact: true })).toHaveCount(0);
  await expect(streams.getByRole("button", { name: "Recent work", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("cockpit columns scroll independently while Home attention stays visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 650 });
  await page.goto("/");
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.external("Scrolling.md", "# Scrolling\n" + Array.from({ length: 40 }, (_, i) => `- [ ] Action ${i}`).join("\n"));
    for (let i = 0; i < 20; i++) app.external(`Document ${i}.md`, `# Document ${i}\nExample content`);
  });
  const focus = page.getByRole("region", { name: "Open project tasks" });
  await expect(focus.getByRole("checkbox")).toHaveCount(5);
  await focus.getByRole("button", { name: "Show more tasks" }).click();
  const documents = page.getByRole("region", { name: "Continue working", exact: true });
  await documents.getByRole("button", { name: "Show more documents" }).click();
  const attention = page.getByRole("region", { name: "Needs attention" });
  const before = await attention.boundingBox();
  const areas = [page.locator('.cockpit-streams .cockpit-column-scroll'), page.locator('.dashboard-tasks .cockpit-column-scroll'), page.locator('.cockpit-sidebar')];
  for (const area of areas) await area.evaluate(el => { el.scrollTop = 0; });
  const sidebarHeading = page.locator('.cockpit-sidebar .dashboard-panel-heading').first();
  const headingBefore = await sidebarHeading.boundingBox();
  for (let i = 0; i < areas.length; i++) {
    expect(await areas[i].evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await areas[i].evaluate(el => { el.scrollTop = 100; });
    expect(await areas[i].evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    for (let j = i + 1; j < areas.length; j++) expect(await areas[j].evaluate(el => el.scrollTop)).toBe(0);
  }
  expect(Math.abs((await sidebarHeading.boundingBox())!.y - headingBefore!.y)).toBeLessThan(4);
  expect((await attention.boundingBox())!.y).toBe(before!.y);
  expect(await page.getByRole("region", { name: "Home", exact: true }).evaluate(el => el.scrollTop)).toBe(0);
  await page.screenshot({ path: 'test-results/cockpit-independent-scroll.png' });
});


test("document actions rename, trash and undo from the document list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Welcome.md", exact: true }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Document name", exact: true }).fill("Renamed welcome");
  await page.getByRole("textbox", { name: "Document name", exact: true }).press("Enter");
  const renamed = page.getByRole("button", { name: "Actions for Renamed welcome.md", exact: true });
  await expect(renamed).toBeVisible();
  await renamed.click();
  await page.getByRole("button", { name: "Move to Trash", exact: true }).click();
  await expect(renamed).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(renamed).toBeVisible();
});

test("project workspace tabs browse trees and edit documents inline", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.files["Ideas/Deep/Project draft.md"] = "# Project draft\n\nEditable here.\n";
    app.files["Planning.md"] = "# Planning\n- [ ] Prepare the workshop\n";
    app.files["Links.md"] = "# References\n[Project board](https://board.example/project)\n";
    app.dates["Ideas/Deep/Project draft.md"] = Date.now();
    app.remarkable.connected = true;
  });
  await createResearchProject(page);
  const workspace = page.getByRole("region", { name: "Projects workspace" });
  await workspace.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Choose reMarkable folders", exact: true }).click();
  await page.getByRole("group", { name: "Choose reMarkable project folders" }).getByRole("checkbox", { name: "Work", exact: true }).check();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(workspace.getByRole("heading", { name: "Project stream" })).toBeVisible();
  await workspace.getByRole("heading", { name: "Research project", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/project-workspace-overview-${testInfo.project.name}.png` });
  await workspace.locator(".project-stream-list > button").filter({ hasText: "Project draft.md" }).click();
  await expect(workspace.getByRole("tab", { name: /^Files/ })).toHaveAttribute("aria-selected", "true");
  const files = workspace.getByRole("region", { name: "Project files" });
  await expect(files.getByRole("button", { name: "Folder Fieldnotes/Ideas/Deep", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(files.locator(".recent-notes")).toContainText("Project draft.md");
  await expect(files.locator(".recent-notes")).not.toContainText("Welcome.md");
  await files.getByRole("button", { name: "Folder Fieldnotes/Ideas", exact: true }).click();
  await expect(files.locator(".recent-notes")).toContainText("A quieter workspace.md");
  await expect(files.locator(".recent-notes")).not.toContainText("Project draft.md");
  await files.getByRole("button", { name: "Folder Fieldnotes", exact: true }).click();
  await expect(files.locator(".recent-notes")).toContainText("Welcome.md");
  await expect(files.locator(".recent-notes")).not.toContainText("A quieter workspace.md");
  await expect(files.locator(".recent-notes")).not.toContainText("Project draft.md");
  await files.getByRole("button", { name: "Folder Fieldnotes/Ideas/Deep", exact: true }).click();
  await files.getByRole("button", { name: "Pin Project draft.md", exact: true }).click();
  await files.locator(".recent-notes .document-action-row > button:first-child").first().click();
  const reader = workspace.getByRole("complementary", { name: "Project document" });
  await expect(reader.locator(".ProseMirror")).toContainText("Editable here.");
  await expect(workspace.getByRole("tab", { name: /^Files/ })).toHaveAttribute("aria-selected", "true");
  await reader.locator(".ProseMirror").fill("Edited inside the project.");
  await reader.getByRole("button", { name: "Save note", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__test.files["Ideas/Deep/Project draft.md"])).toContain("Edited inside the project.");
  await expect(reader.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true })).toBeVisible();
  await reader.getByRole("button", { name: "Export PDF", exact: true }).click();
  const documentPdf = await exportedPdf(page);
  expect(documentPdf.filename).toMatch(/^Project_draft_\d{8}\.pdf$/);
  const pdfText = documentPdf.pages.map((sheet) => sheet.text).join(" ");
  expect(pdfText).toContain("Edited inside the project.");
  expect(pdfText).not.toContain("Prepare the workshop");
  expect(pdfText).not.toContain("Recent activity");
  await page.screenshot({ path: `test-results/project-workspace-files-${testInfo.project.name}.png` });
  await reader.getByRole("button", { name: "Back to notes", exact: true }).click();
  await workspace.getByRole("tab", { name: "Overview", exact: true }).click();
  await workspace.locator(".project-stream-list > button").filter({ hasText: "Meetings/Weekly notes" }).click();
  const cloud = workspace.getByRole("region", { name: "Project reMarkable documents" });
  await expect(cloud.getByRole("button", { name: "Folder reMarkable · Work/Meetings", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(cloud.locator(".recent-notes .document-action-row")).toHaveCount(1);
  await cloud.locator(".recent-notes .document-action-row > button:first-child").click();
  await expect(reader.getByRole("img", { name: "Notebook page 1", exact: true })).toBeVisible();
  await expect(reader.locator(".notes-reader-header").getByRole("button", { name: "Export PDF", exact: true })).toBeVisible();
  await expect(workspace.getByRole("tab", { name: /^reMarkable/ })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: `test-results/project-workspace-remarkable-${testInfo.project.name}.png` });
  await workspace.getByRole("tab", { name: /^Files/ }).click();
  await expect(files.getByRole("button", { name: "Folder Fieldnotes/Ideas/Deep", exact: true })).toHaveAttribute("aria-current", "page");
  await workspace.getByRole("tab", { name: /^Tasks/ }).click();
  const tasks = workspace.getByRole("region", { name: "Project tasks" });
  await expect(tasks).toContainText("Prepare the workshop");
  await tasks.getByRole("checkbox", { name: "Complete Prepare the workshop in Fieldnotes", exact: true }).click();
  await expect(tasks.getByRole("checkbox", { name: "Complete Prepare the workshop in Fieldnotes", exact: true })).toHaveCount(0);
  await tasks.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(tasks.getByRole("checkbox", { name: "Reopen Prepare the workshop in Fieldnotes", exact: true })).toBeChecked();
  await tasks.getByRole("checkbox", { name: "Reopen Prepare the workshop in Fieldnotes", exact: true }).click();
  await expect(tasks.getByRole("checkbox", { name: "Reopen Prepare the workshop in Fieldnotes", exact: true })).toHaveCount(0);
  await tasks.getByRole("button", { name: "Open", exact: true }).click();
  await expect(tasks).toContainText("Prepare the workshop");
  await workspace.getByRole("tab", { name: /^Links/ }).click();
  await expect(workspace.getByRole("region", { name: "Project links" })).toContainText("Project board");
  await workspace.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(workspace.getByRole("region", { name: "Continue working" })).toContainText("Project draft.md");
  await workspace.getByRole("button", { name: "New project note", exact: true }).click();
  await page.getByRole("textbox", { name: "Note name", exact: true }).fill("Inline project note");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(reader.locator(".ProseMirror")).toContainText("Inline project note");
  await expect(workspace.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 760, height: 620 });
  expect(await workspace.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});


test("project trees discover and remove empty subfolders without restarting", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await createResearchProject(page);
  const workspace = page.getByRole("region", { name: "Projects workspace" });
  await workspace.getByRole("tab", { name: /^Files/ }).click();
  const files = workspace.getByRole("region", { name: "Project files" });
  await expect(files.getByRole("button", { name: "Folder Fieldnotes", exact: true })).toBeVisible();
  await files.getByRole("button", { name: "Toggle folder Fieldnotes", exact: true }).click();
  await page.evaluate(() => { (window as any).__test.directories["/test/Fieldnotes"] = ["Empty", "Empty/Nested"]; });
  // No watcher notification: linked roots must also update on the periodic scan.
  await page.clock.runFor(15050);
  const empty = files.getByRole("button", { name: "Folder Fieldnotes/Empty", exact: true });
  await expect(empty).toBeVisible();
  await expect(empty.locator("b")).toHaveText("0");
  await files.getByRole("button", { name: "Toggle folder Fieldnotes/Empty", exact: true }).click();
  await files.getByRole("button", { name: "Folder Fieldnotes/Empty/Nested", exact: true }).click();
  await expect(files.locator(".recent-notes .document-action-row")).toHaveCount(0);
  await page.evaluate(() => { (window as any).__test.directories["/test/Fieldnotes"] = ["Renamed"]; });
  await page.clock.runFor(15050);
  await expect(empty).toHaveCount(0);
  await expect(files.getByRole("button", { name: "Folder Fieldnotes/Renamed", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__test.directories["/test/Fieldnotes"] = []; });
  await page.clock.runFor(15050);
  await expect(files.getByRole("button", { name: "Folder Fieldnotes/Renamed", exact: true })).toHaveCount(0);
});

test("background scans preserve counts and content while detecting external changes", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const filesCount = nav.getByRole("button", { name: "All files", exact: true }).locator(".rail-badge");
  const tasksCount = nav.getByRole("button", { name: "All tasks", exact: true }).locator(".rail-badge");
  await expect(filesCount).toHaveText("3");
  await expect(page.getByText("Checking…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const scans = (window as any).__test.scans;
    scans.lists = 0; scans.reads = 0; scans.paused = true;
  });
  await page.clock.runFor(15050);
  await expect.poll(() => page.evaluate(() => (window as any).__test.scans.releases.length)).toBe(1);
  await expect(filesCount).toHaveText("3");
  await expect(tasksCount).toHaveText("0");
  await expect(page.getByText("Checking tasks…", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Checking…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const scans = (window as any).__test.scans;
    scans.paused = false; scans.releases.splice(0).forEach((release: () => void) => release());
  });
  await expect.poll(() => page.evaluate(() => (window as any).__test.scans.lists)).toBe(2);
  expect(await page.evaluate(() => (window as any).__test.scans.reads)).toBe(0);

  // Polling detects changed timestamps even without a watcher notification.
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.files["Welcome.md"] = "# Welcome\n- [ ] Polled task";
    app.dates["Welcome.md"] = 1;
  });
  await page.clock.runFor(15050);
  await expect(tasksCount).toHaveText("1");
  await expect(page.getByRole("region", { name: "Open project tasks" }).getByRole("checkbox", { name: "Complete Polled task", exact: true })).toBeVisible();

  // Both watcher events and several saves at one timestamp form one scan.
  await page.evaluate(() => {
    const app = (window as any).__test;
    app.scans.lists = 0; app.scans.reads = 0;
    app.external("Welcome.md", "# Welcome\n- [ ] Intermediate task");
    app.external("Welcome.md", "# Welcome\n- [ ] Latest task\n- [ ] Another task");
  });
  await page.clock.runFor(1000);
  await expect(tasksCount).toHaveText("2");
  await expect(page.getByRole("region", { name: "Open project tasks" }).getByRole("checkbox", { name: "Complete Latest task", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__test.scans.lists)).toBe(2);
  expect(await page.evaluate(() => (window as any).__test.scans.reads)).toBe(3);
});

test("project background scans keep the workspace still and task controls usable", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("test-projects", JSON.stringify({ active: "quiet", library: null, revision: "legacy", projects: [{
    id: "quiet", name: "Quiet project", description: "", color: "sage", pinned: false, archived: false,
    folders: ["/test/Projects"], defaultFolder: "/test/Projects",
  }] })));
  await page.clock.install();
  await page.goto("/");
  await page.reload();
  await page.getByRole("region", { name: "My projects" }).getByRole("button").filter({ hasText: "Quiet project" }).click();
  const workspace = page.getByRole("region", { name: "Projects workspace" });
  await expect(workspace.getByRole("heading", { name: "Quiet project", exact: true })).toBeVisible();
  await expect(page.getByText("Checking project folders…", { exact: true })).toHaveCount(0);
  const stream = workspace.locator(".project-stream-list");
  const bounds = await stream.boundingBox();
  await page.evaluate(() => { (window as any).__test.scans.paused = true; });
  await page.clock.runFor(15050);
  await expect.poll(() => page.evaluate(() => (window as any).__test.scans.releases.length)).toBeGreaterThan(0);
  await expect(page.getByText("Checking project folders…", { exact: true })).toHaveCount(0);
  expect(await stream.boundingBox()).toEqual(bounds);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("button", { name: "Project tasks", exact: true }).locator(".rail-badge")).toHaveText("1");
  await nav.getByRole("button", { name: "Project tasks", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Complete: Compare the sources", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const scans = (window as any).__test.scans;
    scans.paused = false; scans.releases.splice(0).forEach((release: () => void) => release());
  });
  await page.clock.runFor(1000);
});

test("project folder pane resizes by dragging and keyboard and remembers its width", async ({ page }) => {
  await page.goto("/");
  await createResearchProject(page);
  const workspace = page.getByRole("region", { name: "Projects workspace" });
  await workspace.getByRole("tab", { name: /^Files/ }).click();
  const divider = workspace.getByRole("separator", { name: "Resize project folder pane" });
  await expect(divider).toBeVisible();
  const initial = Number(await divider.getAttribute("aria-valuenow"));
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 30);
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", String(initial + 60));
  await divider.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", String(initial + 40));
  const maximum = (await divider.getAttribute("aria-valuemax"))!;
  await workspace.getByRole("tab", { name: "Overview", exact: true }).click();
  await workspace.getByRole("tab", { name: /^Files/ }).click();
  await expect(divider).toHaveAttribute("aria-valuenow", String(initial + 40));
  // Wait for ResizeObserver to measure the reopened pane before using its limit.
  await expect(divider).toHaveAttribute("aria-valuemax", maximum);
  await divider.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", maximum);
  await divider.dblclick();
  await expect(divider).toHaveAttribute("aria-valuenow", "210");
});

test("Finder cold-start opens an external Markdown file for viewing and editing in place", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("test-finder-files", JSON.stringify([{ id: "startup", path: "Research.md" }])));
  await page.goto("/");
  await expect(page.locator(".breadcrumb strong")).toHaveText("Research");
  await expect(page.getByRole("textbox", { name: "Visual editor" })).toContainText("A cross-folder discovery");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown editor" }).fill("# Edited from Finder\n\nKept in its original folder.");
  await expect.poll(() => page.evaluate(() => (window as any).__test.secondFiles["Research.md"])).toContain("Edited from Finder");
  expect(await page.evaluate(() => (window as any).__test.files["Research.md"])).toBeUndefined();
});

test("Finder warm-open saves a draft and preserves it if a later open cannot save", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await editor.fill("# Saved before Finder open");
  await page.evaluate(() => (window as any).__test.finderOpen("Research.md"));
  await expect(editor).toContainText("A cross-folder discovery");
  expect(await diskContent(page)).toContain("Saved before Finder open");
  await page.evaluate(() => (window as any).__test.failSave(true));
  await editor.fill("# Keep this unsaved draft");
  await page.evaluate(() => (window as any).__test.finderOpen("Welcome.md"));
  await expect(page.getByRole("alert")).toContainText("Disk is read-only");
  await expect(page.locator(".breadcrumb strong")).toHaveText("Research");
  await expect(editor).toContainText("Keep this unsaved draft");
});

test("Finder startup document stays visible after a slow library restore", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("test-slow-projects", "true");
    localStorage.setItem("test-projects", JSON.stringify({ active: null, projects: [], library: "/test/library", revision: "1" }));
    localStorage.setItem("test-finder-files", JSON.stringify([{ id: "startup", path: "Research.md" }]));
  });
  await page.goto("/");
  await page.reload();
  await expect(page.locator(".breadcrumb strong")).toHaveText("Research");
  await expect.poll(() => page.evaluate(() => (window as any).__test.scans.lists)).toBeGreaterThan(0);
  // Wait for the deliberately delayed library restoration, then check again.
  await page.waitForTimeout(400);
  await expect(page.getByRole("textbox", { name: "Visual editor" })).toContainText("A cross-folder discovery");
  await expect(page.locator(".breadcrumb strong")).toHaveText("Research");
});

test("Finder warm-open reveals an outside file while browsing a project", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("test-projects", JSON.stringify({ active: "work", library: null, revision: "legacy", projects: [
    { id: "work", name: "Work", description: "", color: "sage", pinned: false, archived: false, defaultFolder: "/test/Fieldnotes", folders: ["/test/Fieldnotes"] },
  ] })));
  await page.goto("/");
  await page.reload();
  await page.getByRole("button", { name: "Project files", exact: true }).click();
  await expect(page.locator(".breadcrumb strong")).toHaveText("Project files");
  await page.evaluate(() => (window as any).__test.finderOpen("Research.md"));
  await expect(page.getByRole("textbox", { name: "Visual editor" })).toContainText("A cross-folder discovery");
  await expect(page.locator(".breadcrumb strong")).toHaveText("Research");
});


test("Marp edits one slide with live preview, navigation and preserved full source", async ({ page }, testInfo) => {
  const markdown = "---\nmarp: true\ntheme: uncover\n---\n# First slide\n<!-- Private note -->\n---\n# Second slide\n---\n# Third slide";
  await page.goto("/");
  await page.evaluate((text) => (window as any).__test.external("Editing.md", text), markdown);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Editing", exact: true }).click();
  const viewer = page.getByLabel("Marp slide viewer");
  await viewer.getByRole("button", { name: "Next slide", exact: true }).click();
  await viewer.getByRole("button", { name: "Edit slide", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await expect(editor).toContainText("# Second slide");
  await expect(editor).not.toContainText("Private note");
  await expect(viewer.locator(".marp-stage")).toBeInViewport();
  await expect(editor).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("slide-editor.png") });
  await editor.fill("# Updated second");
  await expect(viewer.getByRole("heading", { name: "Updated second", exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(editor).toContainText("# Third slide");
  await viewer.getByRole("button", { name: "Previous slide", exact: true }).click();
  await expect(editor).toContainText("# Updated second");
  await viewer.getByRole("combobox", { name: "Go to slide" }).selectOption("0");
  await expect(editor).toContainText("Private note");
  await viewer.getByRole("combobox", { name: "Go to slide" }).selectOption("1");
  await page.getByRole("button", { name: "Edit Markdown", exact: true }).click();
  await expect(editor).toContainText("theme: uncover");
  await page.getByRole("button", { name: "Slides", exact: true }).click();
  await expect(viewer.getByRole("heading", { name: "Updated second", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__test.files["Editing.md"])).toBe(markdown.replace("# Second slide", "# Updated second"));
});

test("Marp inserts, removes and restores slides while preserving notes and settings", async ({ page }, testInfo) => {
  const markdown = "---\nmarp: true\ntheme: uncover\n---\n# First slide\n<!-- Keep this note -->\n---\n# Middle slide\n<!-- Remove with slide -->\n---\n# Last slide";
  await page.goto("/");
  await page.evaluate((text) => (window as any).__test.external("Structure.md", text), markdown);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Structure", exact: true }).click();
  const viewer = page.getByLabel("Marp slide viewer");
  await viewer.getByRole("button", { name: "Next slide", exact: true }).click();
  await viewer.getByRole("button", { name: "Edit slide", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  await viewer.getByRole("button", { name: "Insert before", exact: true }).click();
  await expect(viewer).toContainText("Slide 2 of 4");
  await expect(editor).toContainText("# New slide");
  await editor.fill("# Inserted slide");
  await viewer.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(editor).toContainText("# Middle slide");
  await viewer.getByRole("button", { name: "Delete slide", exact: true }).click();
  await expect(viewer).toContainText("Slide 3 of 3");
  await expect(editor).toContainText("# Last slide");
  await viewer.getByRole("button", { name: "Undo slide change", exact: true }).click();
  await expect(editor).toContainText("Remove with slide");
  await viewer.getByRole("button", { name: "Delete slide", exact: true }).click();
  await viewer.getByRole("button", { name: "Insert after", exact: true }).click();
  await expect(viewer).toContainText("Slide 4 of 4");
  await expect(editor).toContainText("# New slide");
  await page.screenshot({ path: testInfo.outputPath("slide-actions.png") });
  await viewer.getByRole("button", { name: "Delete slide", exact: true }).click();
  await expect(editor).toContainText("# Last slide");
  await viewer.getByRole("combobox", { name: "Go to slide" }).selectOption("0");
  await viewer.getByRole("button", { name: "Delete slide", exact: true }).click();
  await expect(editor).toContainText("# Inserted slide");
  await viewer.getByRole("button", { name: "Delete slide", exact: true }).click();
  await expect(editor).toContainText("# Last slide");
  await viewer.getByRole("button", { name: "Clear slide", exact: true }).click();
  await expect(editor.locator(".cm-placeholder")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__test.files["Structure.md"])).toBe("---\nmarp: true\ntheme: uncover\n---\n");
  await viewer.getByRole("button", { name: "Undo slide change", exact: true }).click();
  await expect(editor).toContainText("# Last slide");
});

test("Marp reorders slides with notes and keeps the moved slide selected", async ({ page }, testInfo) => {
  const markdown = "---\nmarp: true\ntheme: uncover\n---\n# First slide\n<!-- First note -->\n---\n# Second slide\n<!-- Second note -->\n---\n# Third slide";
  await page.goto("/");
  await page.evaluate((text) => (window as any).__test.external("Reorder.md", text), markdown);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  await page.getByRole("button", { name: "Reorder", exact: true }).click();
  const viewer = page.getByLabel("Marp slide viewer");
  await viewer.getByRole("button", { name: "Edit slide", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown editor" });
  const earlier = viewer.getByRole("button", { name: "Move earlier", exact: true });
  const later = viewer.getByRole("button", { name: "Move later", exact: true });
  await expect(earlier).toBeDisabled();
  await later.click();
  await expect(viewer).toContainText("Slide 2 of 3");
  await expect(editor).toContainText("First note");
  await expect(viewer.getByRole("heading", { name: "First slide", exact: true })).toBeVisible();
  await later.click();
  await expect(viewer).toContainText("Slide 3 of 3");
  await expect(later).toBeDisabled();
  await expect(editor).toContainText("First note");
  await earlier.click();
  await expect(viewer).toContainText("Slide 2 of 3");
  await viewer.getByRole("button", { name: "Undo slide change", exact: true }).click();
  await expect(viewer).toContainText("Slide 3 of 3");
  await expect(editor).toContainText("First note");
  await viewer.getByRole("combobox", { name: "Go to slide" }).selectOption("0");
  await expect(editor).toContainText("Second note");
  await expect(earlier).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("slide-reorder.png") });
  await expect.poll(() => page.evaluate(() => (window as any).__test.files["Reorder.md"])).toBe("---\nmarp: true\ntheme: uncover\n---\n# Second slide\n<!-- Second note -->\n\n\n---\n# Third slide\n\n---\n# First slide\n<!-- First note -->\n");
});
