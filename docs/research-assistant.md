# Research assistant (unreleased)

This describes local development work, not the packaged 0.18.12 release.

Open a Markdown note and choose **Research** in the document toolbar. NotesDive focuses the document and opens the assistant on the right. On narrow windows it overlays the right side of the editor; close the panel to uncover the full note.

## Connect OpenRouter

Enter your own OpenRouter API key under the panel's settings, then choose **Connect**. NotesDive validates the key before storing it in the operating system keychain. The key is never stored in a note, library, browser storage or repository. Disconnect removes it from the keychain. Network requests are made by the native desktop backend; the browser preview does not support this connection.

The model selector loads the current OpenRouter catalogue and only offers `:free` text models whose listed pricing fields are all zero. Before every question the backend fetches the catalogue again, rejects models that are no longer verifiably free and sends zero price ceilings for prompt, completion and request, with provider fallbacks disabled. There is no paid model fallback, web search plugin, server tool or `:online` variant. A response is withheld if OpenRouter does not report numeric zero cost or returns a different model. Free model availability and rate limits depend on OpenRouter. If zero cost cannot be confirmed, inspect OpenRouter activity before retrying.

## Ask and collect sources

1. Choose a free model and enter a question.
2. Optionally enable **Include this note as context**. This sends the complete current note with that question. It is off by default.
3. Optionally supply source titles, HTTP(S) URLs and pasted excerpts. Click **Add source** before asking. NotesDive does not retrieve the contents of these URLs. Source excerpts are treated as untrusted reference material in the assistant's instructions.
4. Choose **Ask OpenRouter**. The **Google** button instead opens your question as a search in your normal browser; it does not import search results. Paid OpenRouter web search is disabled, including with free models.
5. Review the answer and its links. Model text and links are not verified research findings. **Edit text to insert** lets you keep just the portion you want.
6. **Append answer + sources to note** appends the reviewed Markdown, supplied source links, model identity, date added and an AI-draft notice to the current note. The existing document session performs its normal autosave and conflict handling. Existing note text is preserved. Source links from previous turns are retained in follow-up provenance even if removed from the source form.

Follow-ups resend earlier conversation messages, including previously supplied note context, until **New conversation** clears that history. Editing the text to insert does not change the original answer in conversation history. A conversation supports six questions with a total input limit of 64 KB; output is limited to 2,048 tokens. Failed questions remain available to retry. In-flight responses are ignored after leaving the document, and never inserted automatically.

Conversations are temporary. Closing the panel or switching notes clears questions and answers. Append anything you want to keep before leaving. **New conversation** retains the source form but clears conversation history. No research conversations are written to disk by NotesDive; providers may retain submitted data according to their policies.

## Next step

OpenAI is planned as a second provider and is not implemented or enabled in this step.
