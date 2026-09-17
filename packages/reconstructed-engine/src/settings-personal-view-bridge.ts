// SettingsPersonalView Native Language Dropdown Bridge
export function renderLanguageSelectorOption(): { id: string; label: string; values: Array<{ key: string; text: string }> } {
  return {
    id: 'language-selector',
    label: 'Bahasa Antarmuka',
    values: [
      { key: 'id', text: 'Bahasa Indonesia' },
      { key: 'en', text: 'English (US)' }
    ]
  };
}
