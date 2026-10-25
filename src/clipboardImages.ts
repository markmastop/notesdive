import { invoke } from "@tauri-apps/api/core";

export function clipboardImage(event: ClipboardEvent): File | null {
  const items = Array.from(event.clipboardData?.items ?? []);
  return items.find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile() ?? null;
}

export async function saveClipboardImage(folder: string, notePath: string, file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("Paste a PNG or JPEG image.");
  if (file.size > 50 * 1024 * 1024) throw new Error("This image exceeds the 50 MiB limit.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read the clipboard image."));
    reader.readAsDataURL(file);
  });
  return invoke("save_clipboard_image", { folder, notePath, mime: file.type, data });
}
