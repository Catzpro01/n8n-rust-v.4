// Update Banner Filter — Redam Indikator Kuning & Banner Update Agresif
// 100% compatible dengan UI asli n8n 2.9.4, tidak mengubah Vue bundle

export interface BannerFilterState {
  isUpdateBannerSuppressed: boolean;
  isYellowIndicatorMuted: boolean;
  lastCheck: string;
}

export class UpdateBannerFilter {
  private static state: BannerFilterState = {
    isUpdateBannerSuppressed: true,
    isYellowIndicatorMuted: true,
    lastCheck: new Date().toISOString(),
  };

  static getState(): BannerFilterState {
    return { ...this.state };
  }

  static suppressAggressiveBanners(): boolean {
    this.state.isUpdateBannerSuppressed = true;
    this.state.isYellowIndicatorMuted = true;
    this.state.lastCheck = new Date().toISOString();
    return true;
  }

  static shouldShowUpdateBanner(version: string): boolean {
    // Selalu false — banner update diredam native tanpa ubah UI
    return false;
  }
}
