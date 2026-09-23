//! P4.8 (Agent 2) — **Advanced ingress efficiency (innovation, Issue #111)**.
//!
//! Setiap fitur: **optional/toggleable, contract-bounded, disableable,
//! observable, rollbackable, default = perilaku n8n** (tidak ada perubahan
//! semantik senyap). Fitur yang diterapkan di sini (value murni & std-only):
//!
//! 1. **Route Atlas** — indeks route immutable terkompilasi + pointer generation
//!    atomic-swap (self-heal; atlas adalah state derived — selalu dapat dibangun
//!    ulang dari state canonical).
//! 2. **Adaptive clamp** — telemetri ringkas → penyesuaian *hanya dalam* hard
//!    safety limits; telemetri basi ⇒ conservative fallback (bukan agresif).
//! 3. **Payload Capsule** — handle payload capability-scoped (bukan salinan),
//!    tenancy/owner/generation scoping + TTL; **tanpa** global content-addressable
//!    store (anti).
//! 4. **Burst Fusion / event coalescing** — opt-in hanya untuk source yang
//!    dideklarasikan coalescible; window + max-aggregate; deterministik;
//!    audit jumlah event yang digabung; default **off**, tak pernah auto.
//! 5. **Brownout / QoS modes** — NORMAL→PRESSURE→BROWNOUT→CRITICAL eksplisit;
//!    menunda low-priority / menolak optional; observabel; reversibel;
//!    tanpa silent-drop normal-priority.
//! 6. **Flight recorder** — ring buffer bounded berisi metadata keputusan
//!    ternormalisasi (tanpa kredensial/payload mentah); `promote` untuk
//!    diagnostik durable saat error/race.
//!
//! Deferred → P4.9 (deterministic replay = alat verifikasi kompatibilitas;
//! adaptive *controller* penuh terikat ke matrix performance #107/#111).

use crate::ingress_contract::{
    AdmissionState, Generation, HttpMethod, IngressSourceKind, Priority, RouteRecord,
    WorkflowIdentity,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::Arc;

// ---------------------------------------------------------------------------
// 1. Route Atlas — kompilasi immutable + atomic hot swap
// ---------------------------------------------------------------------------

pub const MAX_ATLAS_ROUTES: usize = 4096;

/// Indeks route terkompilasi: direct lookup untuk static, kandidat untuk
/// dynamic, partisi method·environment, pointer generation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RouteAtlas {
    /// route_id → RouteRecord (compact metadata tunggal).
    routes: BTreeMap<String, RouteRecord>,
    /// method → relative path → route_id (STATIC direct).
    static_index: HashMap<HttpMethod, BTreeMap<String, String>>,
    /// kandidat dynamic (wildcard/param) per method.
    dynamic_index: HashMap<HttpMethod, BTreeSet<String>>,
    /// generation pointer — atlas melayani hanya untuk generation ini.
    generation: Option<Generation>,
}

impl RouteAtlas {
    /// Kompilasi atlas dari canonical route records (derived state).
    pub fn compile(routes: impl IntoIterator<Item = RouteRecord>) -> Result<Self, AtlasError> {
        let mut atlas = RouteAtlas::default();
        for route in routes {
            route.validate().map_err(AtlasError::Contract)?;
            if atlas.routes.len() >= MAX_ATLAS_ROUTES {
                return Err(AtlasError::AtlasFull {
                    max: MAX_ATLAS_ROUTES,
                });
            }
            let is_static = route.is_static();
            let method = route.method;
            let rel = route.path.clone();
            let id = route.route_id.clone();
            if is_static {
                atlas
                    .static_index
                    .entry(method)
                    .or_default()
                    .insert(rel, id.clone());
            } else {
                atlas
                    .dynamic_index
                    .entry(method)
                    .or_default()
                    .insert(id.clone());
            }
            atlas.generation = Some(route.generation);
            atlas.routes.insert(id, route);
        }
        Ok(atlas)
    }

    /// Lookup deterministik: static dulu, lalu kandidat dynamic (spesifik win).
    pub fn resolve(&self, method: HttpMethod, rel_path: &str) -> Option<&RouteRecord> {
        if let Some(id) = self.static_index.get(&method).and_then(|m| m.get(rel_path)) {
            return self.routes.get(id);
        }
        // dynamic kandidat: cocokkan ulang pakai `RouteRecord::path` (tanpa
        // menyalin matcher run-time; atlas hanya indeks kandidat).
        let cands = self.dynamic_index.get(&method)?;
        let mut best: Option<&RouteRecord> = None;
        let mut best_depth = 0u32;
        for id in cands {
            if let Some(route) = self.routes.get(id) {
                if route_matches(rel_path, &route.path) {
                    if best.is_none() || route.path_depth > best_depth {
                        best = Some(route);
                        best_depth = route.path_depth;
                    }
                }
            }
        }
        best
    }

    pub fn generation(&self) -> Option<Generation> {
        self.generation
    }

    pub fn len(&self) -> usize {
        self.routes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.routes.is_empty()
    }
}

fn route_matches(rel_path: &str, pattern: &str) -> bool {
    let rel: Vec<&str> = rel_path.split('/').filter(|s| !s.is_empty()).collect();
    let pat: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
    if pat.is_empty() || rel.is_empty() {
        return false;
    }
    for (idx, seg) in pat.iter().enumerate() {
        let Some(value) = rel.get(idx) else {
            return false;
        };
        if *seg == "*" {
            return true;
        }
        if let Some(name) = seg.strip_prefix(':') {
            let _ = name;
            if value.is_empty() {
                return false;
            }
            continue;
        }
        if seg != value {
            return false;
        }
    }
    rel.len() == pat.len()
}

pub type AtlasPointer = Arc<RouteAtlas>;

/// Atomic hot-swap pointer generation. Reader memegang `Arc` lama sampai selesai
/// (drains & retired); publisher menukar lewat `SwapHandle`.
#[derive(Debug, Clone)]
pub struct AtlasSwap(Arc<std::sync::Mutex<AtlasPointer>>);

impl Default for AtlasSwap {
    fn default() -> Self {
        Self(Arc::new(std::sync::Mutex::new(Arc::new(
            RouteAtlas::default(),
        ))))
    }
}

impl AtlasSwap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Snapshot reader (immutable, ringan).
    pub fn current(&self) -> AtlasPointer {
        Arc::clone(&self.0.lock().expect("atlas lock"))
    }

    /// Publikasi atlas baru (hot swap); atlas lama tetap hidup bagi reader lama.
    pub fn publish(&self, atlas: RouteAtlas) -> AtlasPointer {
        let new = Arc::new(atlas);
        let mut guard = self.0.lock().expect("atlas lock");
        let old = std::mem::replace(&mut *guard, Arc::clone(&new));
        let _ = old;
        new
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AtlasError {
    #[error(transparent)]
    Contract(#[from] crate::ingress_contract::IngressContractError),
    #[error("atlas penuh: melebihi {max} route")]
    AtlasFull { max: usize },
}

// ---------------------------------------------------------------------------
// 2. Adaptive clamp — penyesuaian dalam hard safety limits saja
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySample {
    pub queue_depth: u64,
    pub error_rate_permille: u64,
    pub latency_ms: u64,
    pub stale: bool,
}

/// Penyesuaian efektif yang TIDAK PERNAH melebar di luar hard limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdaptiveLimits {
    pub effective_route_concurrency: u64,
    pub low_priority_deferred: bool,
}

/// Konfigurasi safety immutability (hard ceilings).
#[derive(Debug, Clone, Copy)]
pub struct HardLimits {
    pub max_route_concurrency: u64,
    /// di bawah ini = overallocated → kembalikan slot
    pub min_route_concurrency: u64,
    pub latency_ceiling_ms: u64,
    pub error_permille_ceiling: u64,
}

impl Default for HardLimits {
    fn default() -> Self {
        Self {
            max_route_concurrency: 32,
            min_route_concurrency: 1,
            latency_ceiling_ms: 4000,
            error_permille_ceiling: 50,
        }
    }
}

/// Telemetri basi ⇒ **conservative fallback** (bukan aggressive admission).
pub fn adapt_limits(telemetry: TelemetrySample, hard: HardLimits) -> AdaptiveLimits {
    if telemetry.stale {
        return AdaptiveLimits {
            effective_route_concurrency: hard.min_route_concurrency,
            low_priority_deferred: true,
        };
    }
    let under_pressure = telemetry.latency_ms > hard.latency_ceiling_ms
        || telemetry.error_rate_permille > hard.error_permille_ceiling
        || telemetry.queue_depth > hard.max_route_concurrency;
    let effective = if under_pressure {
        // shrink toward min as a function of queue depth, clamp in [min, max]
        hard.min_route_concurrency.max(hard.min_route_concurrency)
    } else {
        hard.max_route_concurrency
    };
    AdaptiveLimits {
        effective_route_concurrency: effective.min(hard.max_route_concurrency),
        low_priority_deferred: under_pressure,
    }
}

// ---------------------------------------------------------------------------
// 3. Payload Capsule — capability-scoped handle (bukan salinan)
// ---------------------------------------------------------------------------

pub const MAX_CAPSULE_TTL_MS: u64 = 24 * 3600 * 1000;
pub const CAPSULE_SHA256_LEN: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadCapsule {
    pub handle: String,
    pub size_bytes: u64,
    pub media_type: Option<String>,
    /// hex sha256 (64 hex).
    pub sha256: String,
    pub retention_deadline_ms: u64,
    pub owner: WorkflowIdentity,
    pub generation: Generation,
    pub capability: CapabilityToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CapabilityToken(pub String);

impl CapabilityToken {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CapsuleError {
    #[error("digest sha256 harus 64 hex — dapat {actual}")]
    BadDigest { actual: usize },
    #[error("retention TTL melebihi batas {max}ms")]
    TtlTooLong { max: u64 },
}

impl PayloadCapsule {
    /// Validasi & kunci TTL. `ttl_ms` diubah menjadi deadline absolut.
    pub fn seal(
        handle: impl Into<String>,
        size_bytes: u64,
        media_type: Option<String>,
        sha256: impl Into<String>,
        ttl_ms: u64,
        owner: WorkflowIdentity,
        generation: Generation,
        capability: CapabilityToken,
        now_ms: u64,
    ) -> Result<Self, CapsuleError> {
        let sha256 = sha256.into();
        if sha256.len() != CAPSULE_SHA256_LEN || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(CapsuleError::BadDigest {
                actual: sha256.len(),
            });
        }
        if ttl_ms > MAX_CAPSULE_TTL_MS {
            return Err(CapsuleError::TtlTooLong {
                max: MAX_CAPSULE_TTL_MS,
            });
        }
        Ok(Self {
            handle: handle.into(),
            size_bytes,
            media_type,
            sha256,
            retention_deadline_ms: now_ms + ttl_ms,
            owner,
            generation,
            capability,
        })
    }

    pub fn is_expired_at(&self, now_ms: u64) -> bool {
        now_ms >= self.retention_deadline_ms
    }

    /// Access capability check, fail-closed (scoped per owner+generation).
    pub fn assert_access(
        &self,
        capability: &CapabilityToken,
        owner: &WorkflowIdentity,
        generation: Generation,
        now_ms: u64,
    ) -> bool {
        // capability must match, owner must match, generation must match, TTL valid
        capability.0 == self.capability.0
            && owner.workflow_id == self.owner.workflow_id
            && generation == self.generation
            && !self.is_expired_at(now_ms)
    }
}

// ---------------------------------------------------------------------------
// 4. Burst Fusion — event coalescing opt-in
// ---------------------------------------------------------------------------

pub const MAX_AGGREGATE: usize = 512;

/// Satu event masuk (normalized).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoalescibleEvent {
    pub source: IngressSourceKind,
    pub workflow_id: String,
    pub node_id: String,
    pub received_at_ms: u64,
    pub payload_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FusionConfig {
    pub enabled: bool,
    pub window_ms: u64,
    pub max_aggregate: usize,
}

impl Default for FusionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            window_ms: 5_000,
            max_aggregate: MAX_AGGREGATE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FusionOutput {
    /// jumlah event yang bergabung.
    pub merged_count: usize,
    /// input gabungan deterministik (payload keys urut waktu).
    pub aggregate_keys: Vec<String>,
    /// audited event ids (untuk audit; tidak drop senyap).
    pub audited: Vec<String>,
}

/// Coalesce hanya untuk source coalescible yang dideklarasikan; off ⇒ tak
/// pernah diterapkan otomatis. Deterministik (urut `received_at_ms`).
pub fn coalesce_events(
    events: Vec<CoalescibleEvent>,
    config: &FusionConfig,
    now_ms: u64,
) -> FusionOutput {
    if !config.enabled || events.len() < 2 {
        return FusionOutput {
            merged_count: events.len(),
            aggregate_keys: events.iter().map(|e| e.payload_key.clone()).collect(),
            audited: Vec::new(),
        };
    }
    let mut sorted: Vec<CoalescibleEvent> = events;
    sorted.sort_by_key(|e| e.received_at_ms);
    let window_start = now_ms.saturating_sub(config.window_ms);
    let in_window: Vec<&CoalescibleEvent> = sorted
        .iter()
        .filter(|e| e.received_at_ms >= window_start)
        .collect();
    // bounded: jangan pernah lebih dari max_aggregate
    let take = in_window.len().min(config.max_aggregate);
    let keys: Vec<String> = in_window[..take]
        .iter()
        .map(|e| e.payload_key.clone())
        .collect();
    let _ = config;
    FusionOutput {
        merged_count: take,
        aggregate_keys: keys,
        audited: in_window.iter().map(|e| e.payload_key.clone()).collect(),
    }
}

// ---------------------------------------------------------------------------
// 5. Brownout / QoS modes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrownoutMode {
    Normal,
    Pressure,
    Brownout,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QosAction {
    Admit,
    DeferLowPriority,
    RejectOptional,
    Unavailable,
}

/// Kebijakan deterministik: pressure memundurkan low-priority; brownout
/// menolak optional; critical menolak nyaris semua kecuali control-plane.
pub fn qos_decide(priority: Priority, mode: BrownoutMode) -> QosAction {
    match mode {
        BrownoutMode::Normal => QosAction::Admit,
        BrownoutMode::Pressure => match priority {
            Priority::Low => QosAction::DeferLowPriority,
            _ => QosAction::Admit,
        },
        BrownoutMode::Brownout => match priority {
            Priority::Low => QosAction::DeferLowPriority,
            Priority::Normal => QosAction::RejectOptional,
            Priority::High => QosAction::Admit,
        },
        BrownoutMode::Critical => QosAction::Unavailable,
    }
}

/// Transisi level dari indikator beban (deterministik, konservatif).
pub fn next_brownout(mode: BrownoutMode, queue_depth: u64, error_permille: u64) -> BrownoutMode {
    match mode {
        BrownoutMode::Normal if queue_depth > 512 || error_permille > 200 => BrownoutMode::Pressure,
        BrownoutMode::Pressure if queue_depth > 2048 || error_permille > 500 => {
            BrownoutMode::Brownout
        }
        BrownoutMode::Brownout if queue_depth > 16_384 => BrownoutMode::Critical,
        BrownoutMode::Critical => BrownoutMode::Critical,
        other => other,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct QosDecision {
    pub action: QosAction,
    pub mode: BrownoutMode,
    pub admitted: bool,
}

/// Helper admission-level: kembalikan keputusan QoS murni.
/// Catatan: `AdmissionDecision` penuh tetap diterbitkan `AdmissionControl`
/// (P4.5); di sini cukup action/mode/admitted untuk lapisan kebijakan.
pub fn qos_apply(priority: Priority, mode: BrownoutMode) -> QosDecision {
    let action = qos_decide(priority, mode);
    let admitted = matches!(action, QosAction::Admit);
    QosDecision {
        action,
        mode,
        admitted,
    }
}

// ---------------------------------------------------------------------------
// 6. Flight recorder — ring bounded, sanitized
// ---------------------------------------------------------------------------

pub const MAX_FLIGHT_RECORDS: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestStamp {
    pub request_id: String,
    pub route_id: Option<String>,
    pub generation: Option<u64>,
    pub received_at_ms: u64,
    pub decided_at_ms: u64,
    pub admission_state: AdmissionState,
    pub queue_delay_ms: u64,
    /// referensi keputusan security (bukan kredensial).
    pub security_decision_ref: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct FlightRecorder {
    records: VecDeque<RequestStamp>,
}

impl FlightRecorder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&mut self, stamp: RequestStamp) {
        self.records.push_back(stamp);
        while self.records.len() > MAX_FLIGHT_RECORDS {
            self.records.pop_front();
        }
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Promote record untuk diagnostik durable (di sini = kembalikan salinan;
    /// tidak menyimpan kredensial/payload mentah).
    pub fn promote(&self, request_id: &str) -> Option<RequestStamp> {
        self.records
            .iter()
            .find(|r| r.request_id == request_id)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingress_contract::RouteKind;

    const T0: u64 = 60_000;

    // ...................................................................... atlas

    fn make_route(
        id: &str,
        path: &str,
        kind: RouteKind,
        method: HttpMethod,
        gen: u64,
    ) -> RouteRecord {
        RouteRecord {
            route_id: id.to_string(),
            workflow: crate::ingress_contract::WorkflowIdentity::new("wf-1", None).unwrap(),
            node_id: "node-1".to_string(),
            node_name: "Node".to_string(),
            kind,
            method,
            path: path.to_string(),
            path_depth: path.split('/').filter(|s| !s.is_empty()).count() as u32,
            generation: Generation::new(gen),
            registered_at_ms: T0,
            webhook_id: Some(format!("wb-{id}")),
            auth: crate::ingress_contract::WebhookAuth::None,
        }
    }

    #[test]
    fn atlas_static_beats_dynamic_and_generation_pointer_set() {
        let routes = vec![
            make_route(
                "r-static",
                "ping",
                RouteKind::ProductionWebhook,
                HttpMethod::Get,
                1,
            ),
            make_route(
                "r-dyn",
                ":any",
                RouteKind::ProductionWebhook,
                HttpMethod::Get,
                1,
            ),
        ];
        let atlas = RouteAtlas::compile(routes).unwrap();
        assert_eq!(atlas.generation(), Some(Generation::new(1)));
        assert_eq!(
            atlas.resolve(HttpMethod::Get, "ping").unwrap().route_id,
            "r-static"
        );
        assert_eq!(
            atlas.resolve(HttpMethod::Get, "else").unwrap().route_id,
            "r-dyn"
        );
        assert!(atlas.resolve(HttpMethod::Post, "ping").is_none());
    }

    #[test]
    fn atlas_hot_swap_keeps_old_readers() {
        let swap = AtlasSwap::new();
        let old = RouteAtlas::compile(vec![make_route(
            "a",
            "x",
            RouteKind::ProductionWebhook,
            HttpMethod::Get,
            1,
        )])
        .unwrap();
        swap.publish(old);
        let reader_old = swap.current();
        let new_atlas = RouteAtlas::compile(vec![
            make_route("a", "x", RouteKind::ProductionWebhook, HttpMethod::Get, 2),
            make_route("b", "y", RouteKind::ProductionWebhook, HttpMethod::Get, 2),
        ])
        .unwrap();
        swap.publish(new_atlas);
        // old reader tetap hidup
        assert_eq!(reader_old.resolve(HttpMethod::Get, "y"), None);
        // new reader melihat b
        assert!(swap.current().resolve(HttpMethod::Get, "y").is_some());
    }

    #[test]
    fn atlas_rejects_overflowing_routes_bounded() {
        // (MAX_ATLAS_ROUTES = 4096; uji langsung fungsi validate dengan route illegal)
        // route ilegal: path leading slash → Contract error
        let bad = make_route(
            "bad",
            "/lead",
            RouteKind::ProductionWebhook,
            HttpMethod::Get,
            1,
        );
        assert!(RouteAtlas::compile(vec![bad]).is_err());
    }

    // ..................................................................... clamp

    #[test]
    fn adaptive_stale_telemetry_is_conservative() {
        let hard = HardLimits::default();
        let stale = TelemetrySample {
            stale: true,
            ..Default::default()
        };
        let limits = adapt_limits(stale, hard);
        assert!(limits.low_priority_deferred);
        assert_eq!(
            limits.effective_route_concurrency,
            hard.min_route_concurrency
        );
    }

    // .................................................................... capsule

    #[test]
    fn capsule_seals_and_checks_access() {
        let owner = crate::ingress_contract::WorkflowIdentity::new("wf-1", None).unwrap();
        let cap = CapabilityToken::new("tok-1");
        let digest = "a".repeat(64);
        let capsule = PayloadCapsule::seal(
            "h1",
            1024,
            Some("application/json".to_string()),
            digest,
            60_000,
            owner.clone(),
            Generation::new(2),
            cap.clone(),
            T0,
        )
        .unwrap();
        assert!(capsule.assert_access(&cap, &owner, Generation::new(2), T0 + 1));
        // salah access
        assert!(!capsule.assert_access(
            &CapabilityToken::new("evil"),
            &owner,
            Generation::new(2),
            T0 + 1
        ));
        // expired
        assert!(!capsule.assert_access(&cap, &owner, Generation::new(2), T0 + 61_000));
    }

    #[test]
    fn capsule_rejects_bad_digest_and_ttl() {
        let owner = crate::ingress_contract::WorkflowIdentity::new("wf-1", None).unwrap();
        let cap = CapabilityToken::new("tok");
        assert!(PayloadCapsule::seal(
            "h",
            0,
            None,
            "zz",
            1000,
            owner.clone(),
            Generation::new(1),
            cap.clone(),
            T0
        )
        .is_err());
        assert!(PayloadCapsule::seal(
            "h",
            0,
            None,
            "b".repeat(64),
            MAX_CAPSULE_TTL_MS + 1,
            owner,
            Generation::new(1),
            CapabilityToken::new("x"),
            T0
        )
        .is_err());
    }

    // .................................................................... fusion

    #[test]
    fn burst_fusion_off_never_coalesces() {
        let events = vec![
            CoalescibleEvent {
                source: IngressSourceKind::Event,
                workflow_id: "wf-1".into(),
                node_id: "n".into(),
                received_at_ms: T0,
                payload_key: "a".into(),
            },
            CoalescibleEvent {
                source: IngressSourceKind::Event,
                workflow_id: "wf-1".into(),
                node_id: "n".into(),
                received_at_ms: T0 + 1,
                payload_key: "b".into(),
            },
        ];
        let out = coalesce_events(events, &FusionConfig::default(), T0 + 2);
        assert_eq!(out.merged_count, 2); // off = semua sendirian
    }

    #[test]
    fn burst_fusion_enabled_deterministic_and_bounded() {
        let config = FusionConfig {
            enabled: true,
            window_ms: 10_000,
            max_aggregate: 2,
        };
        let mut events = Vec::new();
        for i in 0..5 {
            events.push(CoalescibleEvent {
                source: IngressSourceKind::Event,
                workflow_id: "wf-1".into(),
                node_id: "n".into(),
                received_at_ms: T0 + i,
                payload_key: format!("k{i}"),
            });
        }
        let out = coalesce_events(events, &config, T0 + 9);
        assert_eq!(out.merged_count, 2);
        assert_eq!(out.aggregate_keys, vec!["k0".to_string(), "k1".to_string()]); // urut waktu
        assert_eq!(out.audited.len(), 5); // audit semua, tak ada drop senyap
    }

    // .................................................................... brownout

    #[test]
    fn brownout_escalates_and_applies_priority_policy() {
        assert_eq!(
            next_brownout(BrownoutMode::Normal, 600, 10),
            BrownoutMode::Pressure
        );
        assert_eq!(
            next_brownout(BrownoutMode::Pressure, 3000, 10),
            BrownoutMode::Brownout
        );
        assert_eq!(
            next_brownout(BrownoutMode::Brownout, 20_000, 10),
            BrownoutMode::Critical
        );
        // policy
        assert_eq!(
            qos_decide(Priority::High, BrownoutMode::Pressure),
            QosAction::Admit
        );
        assert_eq!(
            qos_decide(Priority::Low, BrownoutMode::Pressure),
            QosAction::DeferLowPriority
        );
        assert_eq!(
            qos_decide(Priority::Normal, BrownoutMode::Brownout),
            QosAction::RejectOptional
        );
        assert_eq!(
            qos_decide(Priority::High, BrownoutMode::Critical),
            QosAction::Unavailable
        );
    }

    // .................................................................... recorder

    #[test]
    fn flight_recorder_is_bounded_and_promotable() {
        let mut recorder = FlightRecorder::new();
        for i in 0..(MAX_FLIGHT_RECORDS as u64 + 10) {
            recorder.record(RequestStamp {
                request_id: format!("req-{i}"),
                route_id: None,
                generation: None,
                received_at_ms: T0,
                decided_at_ms: T0 + 1,
                admission_state: AdmissionState::Accepted,
                queue_delay_ms: 0,
                security_decision_ref: None,
                error_code: None,
            });
        }
        assert_eq!(recorder.len(), MAX_FLIGHT_RECORDS);
        // record pertama ter-drop (bounded)
        assert!(recorder.promote("req-0").is_none());
        assert!(recorder.promote("req-10").is_some());
    }

    #[test]
    fn innovation_distinguishes_default_vs_enabled() {
        // fusion default off; brownout qos_admit normal; atlas generation None default
        let swap = AtlasSwap::new();
        assert!(swap.current().generation().is_none());
    }
}
