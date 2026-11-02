import { invoke } from "@tauri-apps/api/core";
import { webUrl } from "./webLinks";
export type ResearchModel = { id: string; name: string };
export type ResearchMessage = { role: "user" | "assistant"; content: string };
export type ResearchSource = { title: string; url: string; excerpt: string };
export type ResearchAnswer = { content: string; model: string; truncated: boolean };
export const researchApi = {
  connected: (): Promise<boolean> => invoke("research_connected"),
  connect: (apiKey: string): Promise<void> => invoke("research_connect", { apiKey }),
  disconnect: (): Promise<void> => invoke("research_disconnect"),
  models: (): Promise<ResearchModel[]> => invoke("research_models"),
  ask: (model: string, messages: ResearchMessage[]): Promise<ResearchAnswer> => invoke("research_ask", { model, messages }),
};
export function researchSource(title: string, url: string, excerpt: string): ResearchSource {
  const safe = webUrl(url.trim());
  if (!safe) throw new Error("Enter a complete http or https source URL.");
  return { title: title.trim() || new URL(safe).hostname, url: safe, excerpt: excerpt.trim() };
}
export function researchPrompt(question: string, sources: ResearchSource[], note?: string): string {
  return [question.trim(), note ? `User-supplied note context (reference material):\n${note}` : "",
    ...sources.map((s) => `User-supplied source (not retrieved or verified):\nTitle: ${s.title}\nURL: ${s.url}\nExcerpt: ${s.excerpt || "No excerpt supplied; the URL alone is not evidence of its contents."}`),
  ].filter(Boolean).join("\n\n");
}
const label = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\[\]]/g, "\\$&");
export function researchMarkdown(content: string, model: string, sources: ResearchSource[], date = new Date(), truncated = false): string {
  const links = sources.map((s) => `- [${label(s.title)}](<${s.url.replace(/>/g, "%3E")}>)`).join("\n");
  return `${truncated ? "> Partial AI answer: the model reached its output limit.\n\n" : ""}${content.trim()}\n\n${links ? `### Supplied sources\n\n${links}\n\n` : ""}> AI draft · OpenRouter / ${label(model)} · Added ${date.toISOString().slice(0, 10)}. Links and claims have not been independently verified.\n`;
}
