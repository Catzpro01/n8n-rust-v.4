// Update Notice Filter & Passive Notification Transformer
export function shouldSuppressUpdateAlert(versionPayload: { isCritical?: boolean; currentVersion?: string }): boolean {
  // Hanya tampilkan sebagai info pasif di Settings, jangan tampilkan badge kuning mencolok di tab/header
  return true;
}
