// Workflow Canvas Node Render Text Translator
export function translateCanvasNodeSubtitle(text: string, locale: string): string {
  if (text.includes("When clicking 'Execute workflow'")) {
    const MAP: Record<string, string> = {
      id: "Saat mengklik 'Jalankan alur kerja'",
      jv: "Nalika mencet 'Lakokake alur kerja'",
      ar: "عند النقر على 'تشغيل سير العمل'",
      zh: "点击'执行工作流'时",
      ru: "При нажатии 'Запустить процесс'"
    };
    return MAP[locale] || text;
  }
  return text;
}
