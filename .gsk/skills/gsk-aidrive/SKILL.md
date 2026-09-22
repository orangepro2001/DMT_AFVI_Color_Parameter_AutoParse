---
name: gsk-aidrive
version: 1.0.0
description: 'AI-Drive file storage and management, plus the generic web downloader:
  download_video / download_audio / download_file fetch a URL (YouTube, social media,
  direct file links) server-side into the drive and return a download link. Canonical
  actions: ls, find, mkdir, rm, move, get_readable_url, download, download_video,
  download_audio, download_file, compress, decompress, share, unshare, access, link,
  unlink, upload, list_trash, restore, tree, search, read, overview. Selected Context:
  reuse source/id directly; read a known file, search a known topic, tree for bounded
  structure and existing overviews. read returns a version, coverage, continuation
  and source url. overview generates only with generate=true. `rm` moves native entries
  to recoverable trash and unlinks delegated aliases without touching their source.
  `ls` reads one directory; use indexed `find` to locate names across the drive. `shared_with_me`
  is a view across source containers; list it only when no source is known, then reuse
  `source_id`. A delegated LinkNode row returns `link_workspace_id`; reuse it as `--source`
  to mount the live source entry. `download <ai-drive-path> [local-path]` copies a
  drive file OUT to local disk (the path may be spelled `aidrive://...`); `download_file
  --file_url <url>` goes the opposite direction, saving an external URL INTO the drive.
  share / access / link replies carry `url`, the entry''s share link — hand that to
  the user; `readable_url` is a one-hour bytes URL for tools.'
metadata:
  category: general
  requires:
    bins:
    - gsk
  cliHelp: gsk drive --help
---

# gsk-aidrive

**PREREQUISITE:** Read `../gsk-shared/SKILL.md` for auth, global flags, and security rules.

**THEN READ:** `../gsk-second-brain/SKILL.md` — it says what this command is part of and when to reach for it. This file keeps the flags.

AI-Drive file storage and management, plus the generic web downloader: download_video / download_audio / download_file fetch a URL (YouTube, social media, direct file links) server-side into the drive and return a download link. Canonical actions: ls, find, mkdir, rm, move, get_readable_url, download, download_video, download_audio, download_file, compress, decompress, share, unshare, access, link, unlink, upload, list_trash, restore, tree, search, read, overview. Selected Context: reuse source/id directly; read a known file, search a known topic, tree for bounded structure and existing overviews. read returns a version, coverage, continuation and source url. overview generates only with generate=true. `rm` moves native entries to recoverable trash and unlinks delegated aliases without touching their source. `ls` reads one directory; use indexed `find` to locate names across the drive. `shared_with_me` is a view across source containers; list it only when no source is known, then reuse `source_id`. A delegated LinkNode row returns `link_workspace_id`; reuse it as `--source` to mount the live source entry. `download <ai-drive-path> [local-path]` copies a drive file OUT to local disk (the path may be spelled `aidrive://...`); `download_file --file_url <url>` goes the opposite direction, saving an external URL INTO the drive. share / access / link replies carry `url`, the entry's share link — hand that to the user; `readable_url` is a one-hour bytes URL for tools.

## Usage

```bash
gsk drive [options]
```

**Aliases:** `drive`

## What this command reaches

`gsk drive` opens the **Drive** half of the user's Second Brain — My Drive,
Team Drive, and the Shared-with-me view. For selected Context, start with the
commands below. Consult `../gsk-second-brain/SKILL.md` when you need to discover
an unknown source, resolve shortcuts, or work with GenTeam channel drives.

## Reading selected Context

Reuse the selected `source` and stable `id` without listing every shared source.
For a known file, call `read`; for a topic, call `search`; use `tree` when you
need structure. None of these requires generating an overview first.

```bash
gsk aidrive tree --source '<selected-source>' --depth 2 --limit 100
gsk aidrive search --source '<selected-source>' --query 'Benefits' --query_scope subtree
gsk aidrive search --source '<selected-source>' --queries '["Benefits", "PTO"]'
gsk aidrive read --source '<selected-source>' --id '<entry_id>' --char_limit 12000
gsk aidrive read --source '<selected-source>' --id '<entry_id>' --offset 12000 --source_version '<version>'
gsk aidrive overview --source '<selected-source>' --id '<entry_id>'
gsk aidrive overview --source '<selected-source>' --id '<entry_id>' --generate true
```

`tree` is breadth-first metadata, bounded by depth, nodes, bytes and query time.
Continue with its `cursor` and the same root/source/depth. Expand returned folder
IDs when deeper traversal or deferred expansion is needed. Overview fields are
existing source-language plain text; listing never generates them.

`search` supports `children`, `subtree` (default) and `drive` (drive-root only),
with `all`, `filename` or `content` search modes. Results are ranked index
candidates checked against the live selected scope. Follow the cursor even when
a bounded page is empty. `coverage`, `effective_mode` and `has_more` describe the
actual search; zero hits do not prove that unindexed source text is absent.
Use `queries` for up to three complementary queries sharing one output budget;
each result keeps its query and its own continuation cursor. Continue one query
with `query` and that cursor. Do not collapse distinct user conditions into one rewrite.
Index failure may explicitly fall back to filenames. Overview text is not indexed.

Pass each returned `entry_id` as `--id` and retain `source_id` as `--source`.
`read` returns character ranges from persisted indexed text, its source version,
available coverage and a human-openable `url`. A pending index has no evidence
yet; use its retry guidance or the existing download/format tools when necessary.
Do not treat partial extraction as a complete document. Successful reads can
refresh file and direct-parent overviews asynchronously from a complete cache.
Cite the returned source `url`, never a temporary `readable_url`.

For active Office documents and edits, use **wo-peer** with the returned
collaboration identifiers. Indexed text is a persisted snapshot, not the live
room. Download only when local processing requires it; editing does not require
download, replace and re-upload.

## Flags

| Flag | Required | Description |
|------|----------|-------------|
| `<action>` (positional) | Yes | Action to perform (string, one of: ls, find, mkdir, rm, move, get_readable_url, download, download_video, download_audio, download_file, compress, decompress, share, unshare, access, link, unlink, upload, list_trash, restore, tree, search, read, overview) |
| `--workspace` | No | AI Drive location. my_drive owns your bytes and quota; shared_drive selects managed org, GenTeam, Hub, or authorized knowledge drives; shared_with_me is an ACL-filtered view across both kinds of container and owns no bytes or quota. GenTeam drives are flat: upload files or share source folders at the root; no native mkdir. Moving, renaming, and deleting native files requires an admin. (string, one of: my_drive, shared_with_me, shared_drive, default: `my_drive`) |
| `--source` | No | Stable source_id returned by ls in shared_with_me or shared_drive. It identifies the storage-owning drive and entry; names are accepted only when unique. (string) |
| `--share` | No | Deprecated alias for source, retained for older gsk scripts. (string) |
| `--scope` | No | For find only: search My Drive, accessible shared sources, or both. Use all when only a filename is known. Cannot combine with source/id/url; a specific source keeps the existing directory search behavior. Aggregate search is bounded; inspect coverage before concluding a file is absent. (string, one of: mine, shared, all) |
| `--to` | No | Who to share with, for share/unshare: an email address; My Drive also accepts 'org' / 'group:<uid>' and 'channel:<server_id>:<channel_id>' (a GenTeam channel you belong to — the file is opened to its members and, unless post_card is false, posted there as a card). Managed Drive sources use email or general_access; a Team Drive source (workspace=shared_drive, source=<source_id>) also takes 'channel:…' — for its root, or for one entry inside it named by path (relative to the source) or id — when you manage sharing there. (string) |
| `--post_card` | No | For share to a channel: also post the document card into the channel (default true). false opens the file to the channel's members without a message. (boolean, default: `True`) |
| `--permission` | No | What the recipient or delegated mount may do: view or edit (share/link). The public link audience can only ever view. (string, one of: view, edit, default: `view`) |
| `--link_name` | No | Optional destination alias for link. The source entry's current name is used when omitted. (string) |
| `--general_access` | No | Who else can open it, for share without a recipient: restricted, org, or link. (string, one of: restricted, org, link) |
| `--organization_id` | No | Which organization to share with, when you belong to more than one and use to=org or to=group:<uid>. (string) |
| `--expires_at` | No | Optional ISO-8601 UTC instant after which the access stops, e.g. 2026-12-31T00:00:00+00:00. (string) |
| `-p`, `--path` | No | Path to file or folder for ls, mkdir, rm, move, get_readable_url. For link: the existing source path in My Drive. For unlink: the LinkNode path in the selected managed source. For compress: folder path to compress. For decompress: archive file path to extract. For find: which directory to search. Omit it to search the whole of My Drive, or the root of the selected shared source. Naming a directory searches THAT DIRECTORY ONLY and does not descend into its subfolders — and a shared folder's own root is one such directory. To cover a subtree, use search with query_scope=subtree. tree/search/read/overview also accept a path relative to source or id. (string) |
| `-q`, `--query` | No | Search text. search uses ranked indexed text and names; see search_mode and query_scope. For find: case-insensitive substring matching on the entry name, and on stored search metadata for typed links. A multi-word query matches entries containing EVERY word, in any order — 'budget 2025' finds '2025 budget'. Words are split on spaces only, so a space-free script (Chinese, Japanese) stays one term. (string) |
| `-f`, `--filter_type` | No | Filter by entry type for ls (improves performance): all (default), file, directory. Use 'file' when only need files. (string, one of: all, file, directory) |
| `--file_type` | No | Filter by file MIME type for ls (improves performance): all (default), audio, video, image. Combine with filter_type='file' for best results. (string, one of: all, audio, video, image) |
| `--target_path` | No | Destination entry path for move; destination directory for restore (the original filename is retained); destination directory inside the selected Team Drive source for link. (string) |
| `--entry_id` | No | Stable entry id, required by restore. (string) |
| `--id` | No | Address ANY action by a stable entry id instead of a path — a folder id for ls/find/upload/mkdir, a file id for get_readable_url/download/rm/move. Ids come from ls/find rows and from Drive URLs (#p_fid=…, ?id=…, /s/<owner>/<id>). Your own drive is tried first, then folders shared with you; pass --owner when the URL names one. (string) |
| `--owner` | No | Owner (cogen id) of the entry given by --id, as carried by /s/<owner>/<id> and ?link=<owner>:<folder> URLs. Optional. (string) |
| `--url` | No | A Drive URL copied from the browser (drive?path=…, #p_fid=…, ?id=…&link=…, /s/<owner>/<id>). The ids it carries are extracted and resolved exactly like --id/--owner. (string) |
| `--target_folder` | No | Destination folder for download_video, download_audio, and download_file (string) |
| `--video_url` | No | Video URL to save into Drive with download_video. YouTube: billed 1 credit per MB of the delivered file (min 1 credit); downloads estimated over 1 GB are rejected up front. (string) |
| `--audio_url` | No | Audio/video URL to save into Drive with download_audio. YouTube: billed 1 credit per MB of the delivered file (min 1 credit); downloads estimated over 1 GB are rejected up front. (string) |
| `--file_url` | No | External file URL to save into Drive with download_file (string) |
| `--file_name` | No | Filename for download_file (for example annual_report.pdf); inferred when omitted (string) |
| `--file_content` | No | Content to upload to AI Drive. Can be plain text or base64-encoded binary data. For text files (txt, md, json, csv, etc.), provide plain text content. For binary files, provide base64-encoded content with 'base64:' prefix. Size limit: 1MB without confirmation, 5MB absolute maximum. (string) |
| `--upload_path` | No | Target path for upload action (must start with '/' and include filename). To upload a new version of an existing file, reuse the same path with overwrite=true instead of creating v2/_final name variants; give genuinely new artifacts (e.g. each run of a recurring workflow) their own path. In GenTeam drives, upload at the root. Elsewhere, create missing parent directories with mkdir first. (string) |
| `--overwrite` | No | Set to true to overwrite the existing file at upload_path (upload action only; default false fails if the path exists). (boolean) |
| `--content_type` | No | MIME type of the content. If not provided, will be auto-detected from filename. Common types: text/plain, text/markdown, application/json, text/csv (string) |
| `--confirmed` | No | Set to true to confirm upload when: (1) file size > 1MB, or (2) content contains potentially sensitive patterns. If confirmation is required but not provided, upload will fail with a warning. (boolean) |
| `--queries` | No | For search: up to 3 queries in one request. Each returns its own cursor; omit query/cursor. (array) |
| `--query_scope` | No | For search: children, subtree (default), or drive (requires a selected drive root). (string, one of: children, subtree, drive, default: `subtree`) |
| `--search_mode` | No | For search: all (names and indexed text), filename, or content. Coverage is reported explicitly. (string, one of: all, filename, content, default: `all`) |
| `--limit` | No | Maximum results: tree 1–200 (default 100), search 1–50 (default 20). (integer) |
| `--byte_limit` | No | Maximum query output bytes: tree 4096–65536, search 8192–65536. Default 32768. (integer, default: `32768`) |
| `--depth` | No | Tree breadth-first depth, 1–6 (default 2). Expand a returned folder id for deeper browsing. (integer, default: `2`) |
| `--cursor` | No | Continue tree/search with its cursor and the same id/source/query. Restart if expired or changed. (string, default: ``) |
| `--offset` | No | Read character offset (default 0). Continuation requires the returned version. (integer, default: `0`) |
| `--char_limit` | No | Read character budget, 1–24000 (default 12000). (integer, default: `12000`) |
| `--source_version` | No | Source version returned by read; required for continuation. (string, default: ``) |
| `--generate` | No | For overview: true explicitly generates or regenerates. Default false reads existing overview/job only. (boolean, default: `False`) |

## Address by id or URL

- Every action accepts `--id <entry_id>` instead of a path: a folder id for `ls`/`find`/`upload`/`mkdir`, a file id for `get_readable_url`/`download`/`rm`/`move`. Ids appear in `ls`/`find` rows and in Drive URLs (`#p_fid=…`, `?id=…`, `/s/<owner>/<id>`). Your own drive is tried first, then folders shared with you.
- Add `--owner <cogen_id>` when the URL names one (`/s/<owner>/<id>`, `?link=<owner>:<folder>`), or just pass the whole address with `--url <browser-url>` — the ids are extracted for you.
- With a folder id, a `--path`/`--upload_path` you also pass is RELATIVE to that folder: `mkdir --id <folder> --path reports` creates `<folder>/reports`; `upload --id <folder> --local_file x.pdf` lands in the folder.
- Shared paths `/.shared-workspace/<ws>/…` now accept writes too, under the same edit permission as `--source`.

## Local Drive Transfers

- Upload a file or directory with `gsk drive upload --local_file <local-path> --upload_path /destination` (add `--override` to replace existing files). For shared locations, also pass `--workspace shared_with_me|shared_drive --source <source_id>`. The source drive owns the uploaded bytes and quota.
- Download to this machine with `gsk drive download <drive-path> [local-path]`; this is distinct from `download_file`, which saves an external URL into Drive.

## Discover, resolve, and collaborate

- Start with `ls -p /` for My Drive, `ls --workspace shared_drive` for Team/channel/DM/Hub sources, or `ls --workspace shared_with_me` for all shared sources. Reuse source IDs; duplicate source names require an explicit ID.
- With only a name, use `find --scope all -q <name>`; `mine` and `shared` narrow it. Reuse a hit's `entry_locator` (workspace/source/path). Search is bounded and may use an incomplete index: inspect coverage and never interpret no matches as proof of absence.
- A LinkNode path follows its live source for reads, folder browsing and uploads. Its `content_source_id`/`link_workspace_id` also opens that source at `/`. Do not combine the content mount with the alias's old path. `rm`/`move` on the alias operate on the alias; on a child they operate inside its source. Cross-source moves are refused. Shared source roots cannot be removed. Source-owned shared projections cannot be moved/renamed; unlinking may end that audience's share, reported by share_ended, while preserving source bytes.
- `get_readable_url` returns the native `entry_id` and, for Office files, `collaboration.file_id` and `link_workspace_id`. For live editing use `wo-peer open <file_id> --link-workspace-id <context>` (omit the flag for My Drive). Never use the shortcut ID as the room ID. Minting rechecks edit access; PDF and project links are not Office rooms.
- A DM reference grants no source access by itself. Revoked/unavailable/view-only results are permission outcomes; retrying download on the LinkNode cannot fix them.

## Which link to hand the user

- `share`, `access`, and `link` replies carry `url`: the entry's share link (`/aidrive/s/<drive>/<entry>`, or `/second-brain/s/…` where the Second Brain drive is rolled out). It carries no access of its own — the server decides per visitor — so paste THAT into chat, email, or a card.
- `upload`, `download_*`, `compress`, and `decompress` replies carry a browse-location link to the folder in the user's own drive.
- `ls`/`find` rows for shared shortcuts show their open link in the Type cell (`link:file → <url>`).
- `get_readable_url` is a one-hour bytes URL for tools (`curl`, media analysis). Never hand it to a person as "the link": it expires, and it opens for whoever holds it.

## YouTube Downloads

`download_video` / `download_audio` with a YouTube URL bill 1 credit per MB of the delivered file (min 1 credit); requests estimated over 1 GB are rejected up front. Time-range clipping is not supported for YouTube — provider clip downloads are broken, so download the full video and trim it locally.

## Local File Support

Parameters that accept URLs (`--url`, `--video_url`, `--audio_url`, `--file_url`) also accept local file paths. The CLI automatically uploads local files before sending to the API.

## See Also

- [gsk-shared](../gsk-shared/SKILL.md) — Authentication and global flags
