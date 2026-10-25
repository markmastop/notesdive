# Navigation and project scope

## Problems found in the previous flow

- Home combined several project folders, but Files and Todos without a project used only the last editor folder. Opening a document elsewhere could change what “all” meant.
- The reMarkable menu silently switched between the full library and linked project folders. Selecting a local-only project made the cloud browser appear empty.
- A selected project colored general screens such as Settings, suggesting those screens were filtered too.
- Clearing the project returned to the last local folder rather than a complete overview. A remembered project and the current viewing context were treated as the same state.
- New notes in an aggregated file tree could use the editor's last folder or include a display root label in the filename.

## One rule for every screen

Project selection and viewing context are separate. The global menu always opens **All work**. The project menu explicitly opens the selected project's workspace. The project menu is at the top of the navigation rail; general overviews and Settings are grouped at the bottom. A context label above the content and the navigation/workspace background color identify which is active. Project pages use a soft version of the selected color; document surfaces remain white.

“All” means sources registered with NotesDive: saved local folders, linked folders in active projects in the current project library, and the connected reMarkable library. It does not scan arbitrary folders on the computer. Files are the document types supported by the existing reader.

| Menu | Scope | Behavior |
| --- | --- | --- |
| Home | All work | Recent documents, project choices and local/cached cloud tasks across registered sources. Opening All tasks reads cloud checkbox tasks. |
| Projects | Current project library | Browse, create, restore and configure projects; opening a project activates its workspace. |
| All files | All registered local roots and the entire connected cloud library | Root folders stay visible independently of the document currently being edited. Search includes local Markdown content and cloud names/paths. |
| All tasks | All registered local roots and the entire connected cloud library | Local Markdown tasks and native typed cloud checkbox tasks; cloud reading reports progress, and cloud tasks are read-only. |
| reMarkable | Entire connected reMarkable library | Always available, including without a selected project or without linked cloud folders. Pairing, disconnection, browsing and the reader live here. |
| Project overview | Selected project | Linked local and cloud documents, tasks, links and project settings, without a project picker. The reMarkable tab lists only linked cloud documents. |
| Project files | Selected project | Only linked local/cloud roots and descendants. |
| Project tasks | Selected project | Only tasks from linked local/cloud roots and descendants. |
| Settings | Application | Project libraries and saved folder connections. |

## Transitions and edge cases

| Situation | Expected outcome |
| --- | --- |
| Start/restart | Home opens in All work. A remembered project remains available as a bookmark and project menu. |
| Select from Home or Projects | Save pending edits, remember the project and enter its workspace. |
| Open a general menu while a project is selected | Use all sources; retain the bookmark for returning. The menu is neutral. |
| Click All files or Project files | Open the corresponding file overview with folder and recent filters cleared. |
| Click the project bookmark or project menu | Return to the selected project. The menu adopts its color. |
| Close project | Save pending edits, remove the bookmark and project menu, and use the equivalent global screen. |
| Switch project | Save pending edits; clear previous file selection, folder expansion, search and task filters. |
| Local-only project | Project files/tasks contain local sources; reMarkable still opens the complete cloud library. |
| Cloud-only project | Cloud documents and read-only tasks work; creating a local note is disabled until a local folder is linked. |
| Empty project | Show an empty project scope with an action to link folders; never fall back to unrelated sources. |
| Missing or disconnected cloud folder | Warn within that project while keeping local files usable. |
| Unavailable local folder | Show a source warning while retaining accessible roots. |
| Archive selected project | Remove it as the active scope and return to all work; other projects remain available. |
| Missing/archived remembered project | No project scope is activated. |
| Open/edit a file from another root | Keep the displayed scope; activate only that file's root for saving. |
| Open folder from Home | Register the chosen folder and open All files. Canceling keeps the current context. |
| Open a saved folder in Settings | Open All files with that root selected; it does not change the selected project. |
| Create a note | Use the displayed local destination or selected local subfolder. Cloud paths are never used as local paths. |
| Duplicate names/shared folders | Preserve source identities; deduplicate the same absolute local file and overlapping linked cloud roots. |
| Unsaved changes or save failure | Use the existing save/conflict gate before changing context, selection or library. |
| Small window | Both menu groups and Settings remain reachable; folder trees start at the first level. |

## Cloud reading

Opening global Files/Home reads cloud metadata. Opening All tasks reads native typed checkbox paragraphs across cloud documents and displays progress. Project tasks are read only within linked roots. Handwriting and drawn boxes are not recognized as tasks. The cloud browser stays read-only. Explicitly enabled project folders now support [manual Markdown/notebook sync](remarkable-folder-sync.md) through their Sync now button. Large task scans can take time and stop when the relevant view is left.
