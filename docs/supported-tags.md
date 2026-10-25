# Supported Markdown task syntax

NotesDive collects task checkboxes from `.md` and `.markdown` files. Keep tasks as ordinary Markdown list items:

```markdown
- [ ] Write the proposal
- [x] Send the proposal
```

Nested and numbered tasks work too. A checkbox marks a task complete; changing it in NotesDive updates the original file.

## Available in the current download (0.18.9)

The current macOS download recognizes these optional fields on task lines:

| Field | Example | Meaning |
| --- | --- | --- |
| Due date | `due:2026-10-09` | Deadline |
| Start date | `start:2026-10-05` | Earliest start date |
| Priority | `priority:high` | `high`, `medium`, or `low` |
| Tag | `#website` | Topic or project label |

Dates use `YYYY-MM-DD`. Invalid values remain visible as ordinary task text.

## Inline task fields (0.18.9)

The current download also recognizes bracketed inline fields. This follows [Dataview's inline field syntax](https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-tasks/); the field meanings below are NotesDive conventions.

```markdown
- [ ] Write the proposal [assignee:: @alex] [start:: 2026-10-05] [due:: 2026-10-09] [priority:: high] [stage:: doing] #website
```

| Field | Accepted values | Meaning |
| --- | --- | --- |
| `assignee` | One `@name`, such as `@alex` | Person responsible |
| `start` | Date in `YYYY-MM-DD` | Earliest start date |
| `due` | Date in `YYYY-MM-DD` | Deadline |
| `priority` | `urgent`, `high`, `normal`, `medium`, `low` | Importance; `medium` and `normal` have the same sorting rank |
| `stage` | `backlog`, `todo`, `doing`, `review`, `blocked`, `done` | Workflow label |
| Tags | `#name`, for example `#website` | Topic or project label; multiple tags are allowed |

When a task is checked, NotesDive displays its effective stage as `done`. If you uncheck it, its written open stage applies again; a written `done` on an unchecked task is treated as `todo`. A missing stage means `todo` for open tasks and `done` for checked tasks. The stage is currently a label: a drag-and-drop Kanban board and controls for assigning people or changing stages are planned, not part of the current download.

The older `due:`, `start:`, and `priority:` forms remain readable in the current download. Unknown fields and invalid values stay in the task text so your Markdown is never silently discarded.

The checkbox is part of [GitHub Flavored Markdown](https://github.github.com/gfm/#task-list-items-extension-). Bracketed fields are a Dataview convention rather than a universal Markdown standard. Other editors can still read the file as text, but they may not interpret the fields as task properties.

## Global and project task views

All files and All tasks combine saved local folders, local folders linked to active projects in the current library, and the connected reMarkable library. The dedicated reMarkable menu always opens the entire cloud library. Project files and Project tasks use only the selected project’s linked local and cloud folders, including all their subfolders. Selecting a folder in the file browser shows and counts only files directly inside it; open a subfolder to see its files. Home is a global overview and shows local tasks plus cloud tasks already read. Cloud previews remain read-only; selected local folders can use the manual sync workflow described in the release notes.

All tasks reads native typed checkbox paragraphs across the connected reMarkable library, including their checked state. Project tasks limits this reading to linked cloud folders. Large cloud libraries may take time to read; leaving the view stops further page requests. These tasks show their source notebook and page, and cannot be toggled in NotesDive. Edit them on the tablet and refresh to read the updated state. Handwritten text and drawn checkmarks are not recognized as tasks. The task view itself does not convert notebooks or synchronize edits. Manual folder sync separately supports typed checkbox tasks in the original single-page notebooks created through that sync.
