# Private content

When creating a note, mock exam or flashcard deck, choose **私人 · 僅自己可見** in the visibility selector. File imports, AI imports, NotebookLM imports and new OpenMAIC course notes accept the same choice. MCP creation tools accept `visibility: "private"`; the course inherits the note's visibility. Visibility is fixed at creation. Sharing requires deliberately creating a new shared copy.

Only the owner can read, edit or delete private content. Other users, including app administrators, cannot access its direct URL, revision history, answers, cards, interactive course or referenced attachments. Lists, search, MCP and the administrator's content catalog omit it. Administrator credentials at the hosting/database level are outside this application access boundary.

Private content never needs administrator review. Revisions immediately become the current baseline, new and edited cards immediately become their accepted baseline, exam answers are approved on save, and an owner can publish an interactive course directly after the generation checks. Generation checks verify the course contract and require the external chatbot's quality review; they are not a moderation queue or a claim of automated browser validation. Private changes are omitted from the shared audit log and all moderation queues.

If an administrator disables a group's **共享內容寫入**, its members can continue using personal functions and creating/editing private work, provided the corresponding feature is readable. Creation without an explicit visibility defaults to private. Requests to create shared content or modify an existing shared resource return 403, including through MCP and already-connected collaboration sessions. Read permissions still apply to private work; they do not grant access to someone else's private content.

Migration `0010_private_content.sql` adds owner-scoped visibility to documents and decks. Existing content remains shared. No new binding or API key is required.

## Changing visibility later

The creator of a note, mock exam or flashcard deck can switch it between private and shared with one button on its page (**分享給成員** / **改為私人**). The interactive course, exam answers and cards follow the document, so one switch moves the whole lesson. The API is `PUT /api/documents/:slug/visibility` and `PUT /api/decks/:id/visibility` with `{ "visibility": "private" | "shared" }`.

- Only the creator can switch; administrators cannot make someone else's content private or shared.
- Making content shared needs 共享內容寫入. Making it private is always allowed to the creator.
- The current text becomes the baseline on every switch, so nothing is left waiting for review, and a deck's current cards become its original version.
- Making content private immediately hides it, and its interactive course, from everyone else, including administrators. It is not audited; making it shared is.
