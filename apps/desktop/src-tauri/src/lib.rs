use regex::Regex;
use rusqlite::{params, Connection, OpenFlags};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::{Emitter, Manager, State};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

// ── Data types ──────────────────────────────────────────────────────

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Pack {
    pub uuid: String,
    pub name: String,
    pub genre: Option<String>,
    pub cover_url: Option<String>,
    pub sample_count: usize,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Sample {
    pub id: i64,
    pub local_path: String,
    pub filename: String,
    pub audio_key: Option<String>,
    pub bpm: Option<i32>,
    pub chord_type: Option<String>,
    pub duration: Option<i64>, // milliseconds
    pub genre: Option<String>,
    pub sample_type: Option<String>,
    pub tags: Option<String>,
    pub pack_uuid: Option<String>,
    pub pack_name: Option<String>,
    pub pack_genre: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub sample_count: usize,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryData {
    pub packs: Vec<Pack>,
    pub total_samples: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryStatus {
    pub has_data: bool,
    pub pack_count: usize,
    pub sample_count: usize,
    pub splice_available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
    pub current_pack: usize,
    pub total_packs: usize,
    pub current_pack_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportResult {
    pub files_copied: usize,
    pub files_skipped: usize,
    pub total_packs: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WaveformData {
    pub peaks: Vec<f32>,
    pub colors: Vec<[f32; 3]>,
    pub duration_secs: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExportProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackConflict {
    pub name: String,
    pub existing_uuid: String,
    pub existing_sample_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub audio_count: usize,       // 이 폴더 직속 오디오 파일 수
    pub total_audio_count: usize,  // 하위 폴더 포함 전체 오디오 파일 수
    pub children: Vec<FolderNode>,
}

// ── Path helpers ────────────────────────────────────────────────────

fn get_home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "홈 디렉토리를 찾을 수 없습니다".to_string())
}

fn get_slice_path() -> Result<PathBuf, String> {
    Ok(get_home_dir()?.join("Slice"))
}

/// Splice가 sounds.db를 저장하는 가능한 경로들을 탐색
fn find_splice_db() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // macOS: ~/Library/Application Support/com.splice.Splice/users/default/
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = get_home_dir() {
            candidates.push(
                home.join("Library")
                    .join("Application Support")
                    .join("com.splice.Splice")
                    .join("users")
                    .join("default"),
            );
        }
    }

    // Windows: %LOCALAPPDATA%\SpliceSettings\users\default\
    //          %APPDATA%\com.splice.Splice\users\default\
    #[cfg(target_os = "windows")]
    {
        if let Some(local_app) = dirs::data_local_dir() {
            candidates.push(
                local_app
                    .join("SpliceSettings")
                    .join("users")
                    .join("default"),
            );
            candidates.push(
                local_app
                    .join("Splice")
                    .join("users")
                    .join("default"),
            );
        }
        if let Some(app_data) = dirs::data_dir() {
            candidates.push(
                app_data
                    .join("com.splice.Splice")
                    .join("users")
                    .join("default"),
            );
        }
    }

    // Linux: ~/.config/com.splice.Splice/users/default/ (만약 지원된다면)
    #[cfg(target_os = "linux")]
    {
        if let Some(config) = dirs::config_dir() {
            candidates.push(
                config
                    .join("com.splice.Splice")
                    .join("users")
                    .join("default"),
            );
        }
    }

    for base in &candidates {
        if !base.exists() {
            continue;
        }
        // users/default/ 하위에 해시 디렉토리가 있고, 그 안에 sounds.db가 있음
        if let Ok(entries) = std::fs::read_dir(base) {
            for entry in entries.flatten() {
                if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                    let db_path = entry.path().join("sounds.db");
                    if db_path.exists() {
                        return Ok(db_path);
                    }
                }
            }
        }
    }

    Err("Splice sounds.db를 찾을 수 없습니다. Splice 앱이 설치되어 있는지 확인해주세요.".to_string())
}

/// Splice 다운로드 폴더 경로 (오디오 파일이 저장되는 곳)
fn get_splice_sounds_dir() -> Result<PathBuf, String> {
    // macOS: ~/Splice/
    #[cfg(target_os = "macos")]
    {
        return Ok(get_home_dir()?.join("Splice"));
    }

    // Windows: C:\Users\{user}\Documents\Splice\ 또는 ~/Splice/
    #[cfg(target_os = "windows")]
    {
        // Documents/Splice가 기본값
        if let Some(doc_dir) = dirs::document_dir() {
            let splice_dir = doc_dir.join("Splice");
            if splice_dir.exists() {
                return Ok(splice_dir);
            }
        }
        // 홈 디렉토리/Splice 폴백
        let home_splice = get_home_dir()?.join("Splice");
        if home_splice.exists() {
            return Ok(home_splice);
        }
        // Documents/Splice를 기본 반환
        if let Some(doc_dir) = dirs::document_dir() {
            return Ok(doc_dir.join("Splice"));
        }
        return Ok(get_home_dir()?.join("Splice"));
    }

    // Linux 폴백
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        return Ok(get_home_dir()?.join("Splice"));
    }
}

// ── DB helpers ──────────────────────────────────────────────────────

fn init_db(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS packs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            name TEXT,
            description TEXT,
            cover_url TEXT,
            genre TEXT,
            permalink TEXT
        );
        CREATE TABLE IF NOT EXISTS samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            local_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            audio_key TEXT,
            bpm INTEGER,
            chord_type TEXT,
            duration INTEGER,
            file_hash TEXT UNIQUE,
            genre TEXT,
            sample_type TEXT,
            tags TEXT,
            pack_uuid TEXT,
            waveform_peaks TEXT,
            FOREIGN KEY (pack_uuid) REFERENCES packs(uuid)
        );
        CREATE INDEX IF NOT EXISTS idx_samples_pack_uuid ON samples (pack_uuid);
        CREATE INDEX IF NOT EXISTS idx_samples_local_path ON samples (local_path);",
    )
    .map_err(|e| format!("DB 초기화 실패: {}", e))?;

    // Migration: created_at 컬럼 추가 (기존 DB 호환)
    let _ = db.execute("ALTER TABLE samples ADD COLUMN created_at TEXT", []);
    let _ = db.execute("ALTER TABLE packs ADD COLUMN created_at TEXT", []);

    // Backfill: created_at이 NULL인 행에 현재 시간 채우기
    let _ = db.execute("UPDATE samples SET created_at = datetime('now') WHERE created_at IS NULL", []);
    let _ = db.execute("UPDATE packs SET created_at = datetime('now') WHERE created_at IS NULL", []);

    // Playlist 테이블
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS playlist_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            sample_id INTEGER NOT NULL,
            added_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (sample_id) REFERENCES samples(id) ON DELETE CASCADE,
            UNIQUE(playlist_id, sample_id)
        );",
    )
    .map_err(|e| format!("Playlist 테이블 초기화 실패: {}", e))?;

    // Migration: playlists.color 컬럼 추가
    let _ = db.execute("ALTER TABLE playlists ADD COLUMN color TEXT", []);

    // Migration: waveform_colors 컬럼 추가 (기존 DB 호환)
    let _ = db.execute("ALTER TABLE samples ADD COLUMN waveform_colors TEXT", []);
    // v2: 주파수 분석 알고리즘 변경 — 기존 캐시 무효화 (에너지 밀도 기반)
    let _ = db.execute("UPDATE samples SET waveform_colors = NULL WHERE waveform_colors IS NOT NULL", []);

    Ok(())
}

// ── FFT frequency band analysis (Rekordbox-style RGB) ───────────────

const FFT_SIZE: usize = 2048;

/// 각 파형 바에 대해 Low/Mid/High 주파수 대역 에너지를 분석하여 RGB 색상을 계산
fn compute_frequency_colors(
    all_samples: &[f32],
    num_peaks: usize,
    sample_rate: u32,
) -> Vec<[f32; 3]> {
    if all_samples.is_empty() || num_peaks == 0 {
        return vec![[0.4, 0.4, 0.6]; num_peaks];
    }

    let chunk_size = (all_samples.len() / num_peaks).max(1);
    let fft_size = FFT_SIZE.min(chunk_size.next_power_of_two().max(64));

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);

    // Hann 윈도우 (스펙트럼 누출 방지)
    let hann: Vec<f32> = (0..fft_size)
        .map(|i| {
            0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / fft_size as f32).cos())
        })
        .collect();

    // 5밴드 주파수 경계 (bin 인덱스)
    // Sub:     ~20–150Hz   (킥 바디, 서브베이스)
    // LowMid:  ~150–600Hz  (킥 어택, 베이스 하모닉스)
    // Mid:     ~600–2500Hz (보컬, 스네어, 클랩)
    // HighMid: ~2500–6000Hz (프레즌스, 어택 트랜지언트)
    // High:    6000Hz+     (하이햇, 심벌, 에어)
    let freq_to_bin =
        |freq: f32| -> usize { (freq * fft_size as f32 / sample_rate as f32).round() as usize };
    let sub_end = freq_to_bin(150.0).max(1).min(fft_size / 2);
    let lowmid_end = freq_to_bin(600.0).max(sub_end + 1).min(fft_size / 2);
    let mid_end = freq_to_bin(2500.0).max(lowmid_end + 1).min(fft_size / 2);
    let himid_end = freq_to_bin(6000.0).max(mid_end + 1).min(fft_size / 2);
    let nyquist = fft_size / 2;

    // 대역별 빈 수 (에너지 밀도 계산용)
    let sub_bins = (sub_end - 1).max(1) as f32;
    let lowmid_bins = (lowmid_end - sub_end).max(1) as f32;
    let mid_bins = (mid_end - lowmid_end).max(1) as f32;
    let himid_bins = (himid_end - mid_end).max(1) as f32;
    let high_bins = (nyquist - himid_end).max(1) as f32;

    let mut buffer = vec![Complex { re: 0.0f32, im: 0.0f32 }; fft_size];

    (0..num_peaks)
        .map(|i| {
            let start = i * chunk_size;
            let end = (start + chunk_size).min(all_samples.len());
            let len = end - start;

            // 버퍼 초기화
            for c in buffer.iter_mut() {
                c.re = 0.0;
                c.im = 0.0;
            }

            // 청크 중앙에서 FFT 윈도우 추출 + Hann 적용
            let copy_len = len.min(fft_size);
            let src_offset = if len > fft_size {
                (len - fft_size) / 2
            } else {
                0
            };
            let buf_offset = if copy_len < fft_size {
                (fft_size - copy_len) / 2
            } else {
                0
            };

            for j in 0..copy_len {
                let sample_idx = start + src_offset + j;
                if sample_idx < all_samples.len() {
                    let win_idx = buf_offset + j;
                    if win_idx < fft_size {
                        buffer[win_idx].re = all_samples[sample_idx] * hann[win_idx];
                    }
                }
            }

            // FFT 실행
            fft.process(&mut buffer);

            // 5밴드 에너지 합산
            let mut sub_e = 0.0f32;
            let mut lowmid_e = 0.0f32;
            let mut mid_e = 0.0f32;
            let mut himid_e = 0.0f32;
            let mut high_e = 0.0f32;

            for bin in 1..nyquist {
                let mag_sq = buffer[bin].re * buffer[bin].re + buffer[bin].im * buffer[bin].im;
                if bin < sub_end {
                    sub_e += mag_sq;
                } else if bin < lowmid_end {
                    lowmid_e += mag_sq;
                } else if bin < mid_end {
                    mid_e += mag_sq;
                } else if bin < himid_end {
                    himid_e += mag_sq;
                } else {
                    high_e += mag_sq;
                }
            }

            // ★ 에너지 밀도 (빈당 평균) — 대역 폭 차이 보정
            let sub_d = sub_e / sub_bins;
            let lowmid_d = lowmid_e / lowmid_bins;
            let mid_d = mid_e / mid_bins;
            let himid_d = himid_e / himid_bins;
            let high_d = high_e / high_bins;

            let total_d = sub_d + lowmid_d + mid_d + himid_d + high_d;
            if total_d <= 0.0 {
                return [0.4, 0.4, 0.6];
            }

            // 5밴드 밀도 비율
            let sw = sub_d / total_d;
            let lmw = lowmid_d / total_d;
            let mw = mid_d / total_d;
            let hmw = himid_d / total_d;
            let hw = high_d / total_d;

            // 5밴드 RGB 블렌딩
            // Sub=Red(0.95,0.10,0.10)       LowMid=Yellow(0.95,0.75,0.10)
            // Mid=Green(0.15,0.90,0.20)     HighMid=Cyan(0.10,0.70,0.90)
            // High=Blue(0.20,0.30,0.95)
            let r = sw * 0.95 + lmw * 0.95 + mw * 0.15 + hmw * 0.10 + hw * 0.20;
            let g = sw * 0.10 + lmw * 0.75 + mw * 0.90 + hmw * 0.70 + hw * 0.30;
            let b = sw * 0.10 + lmw * 0.10 + mw * 0.20 + hmw * 0.90 + hw * 0.95;

            // 밝기 정규화 (최대 컴포넌트 → 0.85)
            let max_c = r.max(g).max(b).max(0.001);
            let scale = 0.85 / max_c;

            [
                (r * scale).min(1.0),
                (g * scale).min(1.0),
                (b * scale).min(1.0),
            ]
        })
        .collect()
}

// ── Symphonia: full decode → waveform peaks + frequency colors ──────

fn compute_waveform_internal(file_path: &str, num_peaks: usize) -> Result<WaveformData, String> {
    let file = std::fs::File::open(file_path).map_err(|e| format!("파일 열기 실패: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(file_path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("포맷 프로브 실패: {}", e))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "기본 트랙을 찾을 수 없습니다".to_string())?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);

    let duration_secs = track
        .codec_params
        .time_base
        .zip(track.codec_params.n_frames)
        .map(|(tb, nf)| {
            let time = tb.calc_time(nf);
            time.seconds as f64 + time.frac
        })
        .unwrap_or(0.0);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("디코더 생성 실패: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        match format.next_packet() {
            Ok(packet) => {
                if packet.track_id() != track_id {
                    continue;
                }
                match decoder.decode(&packet) {
                    Ok(decoded) => {
                        let spec = *decoded.spec();
                        let num_channels = spec.channels.count().max(1);
                        let mut sample_buf =
                            SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                        sample_buf.copy_interleaved_ref(decoded);

                        let samples = sample_buf.samples();
                        for chunk in samples.chunks(num_channels) {
                            let mono: f32 =
                                chunk.iter().sum::<f32>() / chunk.len().max(1) as f32;
                            all_samples.push(mono);
                        }
                    }
                    Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
                    Err(_) => break,
                }
            }
            Err(_) => break,
        }
    }

    // Downsample to peaks
    let peaks = if all_samples.is_empty() {
        vec![0.0f32; num_peaks]
    } else if all_samples.len() < num_peaks {
        let mut p: Vec<f32> = all_samples.iter().map(|s| s.abs()).collect();
        p.resize(num_peaks, 0.0);
        p
    } else {
        let chunk_size = all_samples.len() / num_peaks;
        (0..num_peaks)
            .map(|i| {
                let start = i * chunk_size;
                let end = (start + chunk_size).min(all_samples.len());
                all_samples[start..end]
                    .iter()
                    .map(|s| s.abs())
                    .fold(0.0f32, f32::max)
            })
            .collect()
    };

    // Normalize to 0.0–1.0
    let max_peak = peaks.iter().cloned().fold(0.0f32, f32::max);
    let normalized: Vec<f32> = if max_peak > 0.0 {
        peaks.iter().map(|p| p / max_peak).collect()
    } else {
        peaks
    };

    // FFT 주파수 분석 → RGB 색상
    let colors = compute_frequency_colors(&all_samples, num_peaks, sample_rate);

    Ok(WaveformData {
        peaks: normalized,
        colors,
        duration_secs,
    })
}

// ── Audio helpers: decode to mono PCM ────────────────────────────────

fn decode_audio_mono(file_path: &str, max_seconds: Option<f64>) -> Result<(Vec<f32>, u32), String> {
    let file = std::fs::File::open(file_path).map_err(|e| format!("파일 열기 실패: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(file_path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("포맷 프로브 실패: {}", e))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "기본 트랙을 찾을 수 없습니다".to_string())?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let max_samples = max_seconds.map(|s| (s * sample_rate as f64) as usize);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("디코더 생성 실패: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        if let Some(max) = max_samples {
            if all_samples.len() >= max {
                break;
            }
        }
        match format.next_packet() {
            Ok(packet) => {
                if packet.track_id() != track_id {
                    continue;
                }
                match decoder.decode(&packet) {
                    Ok(decoded) => {
                        let spec = *decoded.spec();
                        let num_channels = spec.channels.count().max(1);
                        let mut sample_buf =
                            SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                        sample_buf.copy_interleaved_ref(decoded);

                        let samples = sample_buf.samples();
                        for chunk in samples.chunks(num_channels) {
                            let mono: f32 =
                                chunk.iter().sum::<f32>() / chunk.len().max(1) as f32;
                            all_samples.push(mono);
                        }
                    }
                    Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
                    Err(_) => break,
                }
            }
            Err(_) => break,
        }
    }

    Ok((all_samples, sample_rate))
}

// ── BPM detection from audio ────────────────────────────────────────

fn detect_bpm_from_audio(file_path: &str) -> Option<i32> {
    // 최대 30초까지 디코딩 (더 긴 분석 윈도우로 정확도 향상)
    let (samples, sample_rate) = decode_audio_mono(file_path, Some(30.0)).ok()?;
    if samples.len() < sample_rate as usize * 2 {
        return None; // 2초 미만이면 BPM 감지 불가
    }

    let sr = sample_rate as f64;

    // 1. 에너지 envelope 계산 (20ms 윈도우, 10ms hop — 더 안정적)
    let window_size = (sr * 0.02) as usize;
    let hop_size = (sr * 0.01) as usize;
    if window_size == 0 || hop_size == 0 {
        return None;
    }

    let mut energy: Vec<f64> = Vec::new();
    let mut i = 0;
    while i + window_size <= samples.len() {
        let e: f64 = samples[i..i + window_size]
            .iter()
            .map(|s| (*s as f64) * (*s as f64))
            .sum::<f64>()
            / window_size as f64;
        energy.push(e);
        i += hop_size;
    }

    if energy.len() < 20 {
        return None;
    }

    // 2. Log-compressed 에너지로 onset detection (다이나믹 레인지 개선)
    let log_energy: Vec<f64> = energy.iter().map(|e| (e + 1e-10).ln()).collect();

    // 반파 정류된 1차 차분
    let mut onset: Vec<f64> = vec![0.0];
    for idx in 1..log_energy.len() {
        let diff = log_energy[idx] - log_energy[idx - 1];
        onset.push(if diff > 0.0 { diff } else { 0.0 });
    }

    // onset 정규화
    let onset_max = onset.iter().cloned().fold(0.0f64, f64::max);
    if onset_max <= 0.0 {
        return None;
    }
    for v in onset.iter_mut() {
        *v /= onset_max;
    }

    // 3. Autocorrelation (넓은 범위 50~190 BPM 탐색 — 옥타브 보정용)
    let frames_per_sec = sr / hop_size as f64;
    let min_lag = (frames_per_sec * 60.0 / 190.0) as usize; // 190 BPM
    let search_max_lag = (frames_per_sec * 60.0 / 50.0) as usize; // 50 BPM (서브하모닉 탐색)
    let search_max_lag = search_max_lag.min(onset.len() / 2);

    if min_lag >= search_max_lag || search_max_lag >= onset.len() {
        return None;
    }

    // 모든 lag에 대한 autocorrelation 계산
    let mut corr_values: Vec<f64> = vec![0.0; search_max_lag + 1];
    for lag in min_lag..=search_max_lag {
        let n = onset.len() - lag;
        let mut corr = 0.0f64;
        for j in 0..n {
            corr += onset[j] * onset[j + lag];
        }
        corr /= n as f64;
        corr_values[lag] = corr;
    }

    // 4. 피크 찾기 (autocorrelation의 로컬 최대값)
    let mut peaks: Vec<(usize, f64)> = Vec::new();
    for lag in (min_lag + 1)..search_max_lag {
        if corr_values[lag] > corr_values[lag - 1]
            && corr_values[lag] > corr_values[lag + 1]
            && corr_values[lag] > 0.0005
        {
            peaks.push((lag, corr_values[lag]));
        }
    }

    if peaks.is_empty() {
        // 피크가 없으면 전체 최대값 사용
        let mut best_lag = min_lag;
        let mut best_val = corr_values[min_lag];
        for lag in min_lag..=search_max_lag {
            if corr_values[lag] > best_val {
                best_val = corr_values[lag];
                best_lag = lag;
            }
        }
        if best_val > 0.0005 {
            peaks.push((best_lag, best_val));
        }
    }

    if peaks.is_empty() {
        return None;
    }

    // 상위 피크 정렬 (correlation 강도순)
    peaks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // 5. 옥타브 보정: 각 피크의 BPM과 x2, /2 변형 중 최적 후보 선택
    let mut best_score = 0.0f64;
    let mut best_bpm = 0i32;

    for &(lag, corr) in peaks.iter().take(5) {
        let secs_per_beat = (lag as f64 * hop_size as f64) / sr;
        let bpm_raw = 60.0 / secs_per_beat;

        // 원본 BPM과 옥타브 변형 (x2, /2) 모두 시도
        for &candidate_f in &[bpm_raw, bpm_raw * 2.0, bpm_raw / 2.0] {
            let candidate = candidate_f.round() as i32;
            if candidate < 60 || candidate > 190 {
                continue;
            }

            // 가중치: 80~160 BPM 범위 선호 (가장 흔한 음악 BPM 범위)
            let range_weight = if candidate >= 80 && candidate <= 160 {
                1.3
            } else {
                1.0
            };

            // 옥타브 변형에 약간의 페널티 (원본 우선)
            let octave_penalty = if (candidate_f - bpm_raw).abs() < 1.0 {
                1.0
            } else {
                0.8
            };

            let score = corr * range_weight * octave_penalty;
            if score > best_score {
                best_score = score;
                best_bpm = candidate;
            }
        }
    }

    // 6. 서브하모닉 확인: 너무 느린 BPM이면 더블 BPM 후보 검증
    if best_bpm > 0 && best_bpm <= 95 {
        let double_bpm = best_bpm * 2;
        if double_bpm <= 190 {
            let double_lag = (frames_per_sec * 60.0 / double_bpm as f64) as usize;
            if double_lag >= min_lag && double_lag <= search_max_lag {
                let double_corr = corr_values[double_lag];
                // 더블 BPM lag의 correlation이 70% 이상이면 더블 선택
                if double_corr > best_score * 0.7 {
                    best_bpm = double_bpm;
                }
            }
        }
    }

    if best_bpm >= 60 && best_bpm <= 190 && best_score > 0.0005 {
        Some(best_bpm)
    } else {
        None
    }
}

// ── Filename / path parsing helpers ─────────────────────────────────

fn parse_bpm_from_filename(filename: &str) -> Option<i32> {
    // "120BPM", "120 BPM", "120bpm", "120_bpm" 등
    let re = Regex::new(r"(?i)(\d{2,3})\s*[_\-]?\s*bpm").unwrap();
    if let Some(caps) = re.captures(filename) {
        if let Ok(bpm) = caps[1].parse::<i32>() {
            if (60..=190).contains(&bpm) {
                return Some(bpm);
            }
        }
    }
    // "bpm120", "BPM_120", "BPM-120"
    let re2 = Regex::new(r"(?i)bpm[\s_\-]*(\d{2,3})").unwrap();
    if let Some(caps) = re2.captures(filename) {
        if let Ok(bpm) = caps[1].parse::<i32>() {
            if (60..=190).contains(&bpm) {
                return Some(bpm);
            }
        }
    }
    // "tempo120", "Tempo 120", "Tempo_120", "Tempo-120"
    let re3 = Regex::new(r"(?i)tempo[\s_\-]*(\d{2,3})").unwrap();
    if let Some(caps) = re3.captures(filename) {
        if let Ok(bpm) = caps[1].parse::<i32>() {
            if (60..=190).contains(&bpm) {
                return Some(bpm);
            }
        }
    }
    // "120 Tempo", "120_Tempo"
    let re4 = Regex::new(r"(?i)(\d{2,3})\s*[_\-]?\s*tempo").unwrap();
    if let Some(caps) = re4.captures(filename) {
        if let Ok(bpm) = caps[1].parse::<i32>() {
            if (60..=190).contains(&bpm) {
                return Some(bpm);
            }
        }
    }
    // 독립 숫자 패턴 (폴백): 구분자 사이 2~3자리 숫자를 BPM으로 추정
    // bit, bar, k, hz, db, ch, st 등 비-BPM 접미사가 붙은 숫자는 제외
    let re5 = Regex::new(r"(?:^|[^0-9a-zA-Z])(\d{2,3})(?:[^0-9a-zA-Z]|$)").unwrap();
    for caps in re5.captures_iter(filename) {
        if let Ok(num) = caps[1].parse::<i32>() {
            if !(60..=190).contains(&num) {
                continue;
            }
            // 숫자 뒤 텍스트 확인: 비-BPM 접미사 제외
            let end_pos = caps.get(1).unwrap().end();
            if end_pos < filename.len() {
                let after = filename[end_pos..].to_lowercase();
                if after.starts_with("bit")
                    || after.starts_with("bar")
                    || after.starts_with("hz")
                    || after.starts_with("khz")
                    || after.starts_with("db")
                    || after.starts_with("ch")
                    || after.starts_with("st")
                    || after.starts_with("kbps")
                {
                    continue;
                }
            }
            return Some(num);
        }
    }
    None
}

fn parse_key_from_filename(filename: &str) -> Option<String> {
    // "Cmaj", "C#min", "Bbmajor", "A minor" 등
    let re = Regex::new(r"(?i)\b([A-G][#b]?)\s*(maj(?:or)?|min(?:or)?)\b").unwrap();
    if let Some(caps) = re.captures(filename) {
        let note = caps[1].chars().next()?.to_uppercase().to_string()
            + &caps[1][1..];
        let quality = caps[2].to_lowercase();
        let q = if quality.starts_with("min") {
            "min"
        } else {
            "maj"
        };
        return Some(format!("{}{}", note, q));
    }

    // "Am", "F#m", "Bbm" (단독 m = minor)
    let re2 = Regex::new(r"\b([A-G][#b]?)m\b").unwrap();
    if let Some(caps) = re2.captures(filename) {
        let note = caps[1].chars().next()?.to_uppercase().to_string()
            + &caps[1][1..];
        return Some(format!("{}min", note));
    }

    None
}

/// 오디오 파일의 뒤쪽 무음 여부를 검사 (one-shot 판별용)
/// 뒤쪽 30%가 대부분 무음이면 one-shot (긴 디케이/리버브 꼬리)
fn has_trailing_silence(file_path: &str) -> bool {
    let (samples, sample_rate) = match decode_audio_mono(file_path, Some(30.0)) {
        Ok(r) => r,
        Err(_) => return false,
    };

    let chunk_size = (sample_rate as usize) / 10; // 100ms 단위
    if chunk_size == 0 {
        return false;
    }
    let total_chunks = samples.len() / chunk_size;
    if total_chunks < 5 {
        return false;
    }

    // 각 청크의 RMS 에너지 계산
    let energies: Vec<f64> = (0..total_chunks)
        .map(|i| {
            let start = i * chunk_size;
            let end = (start + chunk_size).min(samples.len());
            let rms: f64 = samples[start..end]
                .iter()
                .map(|s| (*s as f64).powi(2))
                .sum::<f64>()
                / (end - start) as f64;
            rms.sqrt()
        })
        .collect();

    let peak_energy = energies.iter().cloned().fold(0.0f64, f64::max);
    if peak_energy <= 0.0 {
        return false;
    }

    // 앞쪽 50%에서 피크 에너지 위치 확인
    let half = total_chunks / 2;
    let front_peak = energies[..half].iter().cloned().fold(0.0f64, f64::max);
    let back_peak = energies[half..].iter().cloned().fold(0.0f64, f64::max);

    // 앞쪽 피크가 뒤쪽보다 확실히 크면 one-shot 가능성
    if front_peak <= 0.0 {
        return false;
    }

    // 뒤쪽 30% 무음 체크
    let tail_start = (total_chunks as f64 * 0.7) as usize;
    let silence_threshold = peak_energy * 0.03; // 피크의 3% 이하 = 무음

    let silent_tail_chunks = energies[tail_start..]
        .iter()
        .filter(|&&e| e < silence_threshold)
        .count();
    let tail_chunk_count = total_chunks - tail_start;

    // 뒤쪽 30%의 60% 이상이 무음이면 → one-shot
    let silence_ratio = silent_tail_chunks as f64 / tail_chunk_count as f64;
    if silence_ratio > 0.6 {
        return true;
    }

    // 또는: 뒤쪽 피크가 앞쪽 피크의 10% 미만이면 → one-shot (에너지 감쇠)
    if back_peak < front_peak * 0.1 {
        return true;
    }

    false
}

fn parse_sample_type(filename: &str, duration_ms: Option<i64>, file_path: Option<&str>) -> String {
    let lower = filename.to_lowercase();

    // 1. 파일명 키워드 우선
    if lower.contains("loop") || lower.contains("_lp") {
        return "loop".to_string();
    }
    if lower.contains("oneshot")
        || lower.contains("one-shot")
        || lower.contains("one shot")
        || lower.contains("_hit")
        || lower.contains(" hit")
        || lower.contains("stab")
        || lower.contains("impact")
        || lower.contains("riser")
        || lower.contains("downlifter")
        || lower.contains("fx")
        || lower.contains("sfx")
        || lower.contains("transition")
        || lower.contains("fill")
    {
        return "oneshot".to_string();
    }

    // 2. 짧은 샘플은 one-shot
    if let Some(d) = duration_ms {
        if d < 1500 {
            return "oneshot".to_string();
        }
    }

    // 3. 1.5초~20초 범위: 오디오 분석으로 뒤쪽 무음 체크
    if let (Some(d), Some(path)) = (duration_ms, file_path) {
        if d >= 1500 && d <= 20000 {
            if has_trailing_silence(path) {
                return "oneshot".to_string();
            }
        }
    }

    // 4. 20초 초과면 loop, 그 외 duration 기반
    match duration_ms {
        Some(d) if d > 20000 => "loop".to_string(),
        Some(_) => "loop".to_string(),
        None => "oneshot".to_string(),
    }
}

fn parse_tags_from_path(full_path: &str, filename: &str) -> Vec<String> {
    let combined = format!("{} {}", full_path, filename).to_lowercase();
    let mut tags: Vec<String> = Vec::new();

    let instrument_keywords: &[(&str, &str)] = &[
        ("kick", "kick"),
        ("snare", "snare"),
        ("hihat", "hihat"),
        ("hi-hat", "hihat"),
        ("hi hat", "hihat"),
        ("hh_", "hihat"),
        ("_hh", "hihat"),
        ("clap", "clap"),
        ("cymbal", "cymbal"),
        ("crash", "crash"),
        ("ride", "ride"),
        ("open hat", "open hat"),
        ("closed hat", "closed hat"),
        ("bass", "bass"),
        ("sub", "sub bass"),
        ("lead", "lead"),
        ("pad", "pad"),
        ("pluck", "pluck"),
        ("chord", "chord"),
        ("arp", "arp"),
        ("vocal", "vocal"),
        ("vox", "vocal"),
        ("voice", "vocal"),
        ("fx", "fx"),
        ("sfx", "fx"),
        ("riser", "riser"),
        ("impact", "impact"),
        ("transition", "transition"),
        ("sweep", "sweep"),
        ("piano", "piano"),
        ("keys", "keys"),
        ("guitar", "guitar"),
        ("strings", "strings"),
        ("brass", "brass"),
        ("synth", "synth"),
        ("organ", "organ"),
        ("flute", "flute"),
        ("bell", "bell"),
        ("perc", "percussion"),
        ("percussion", "percussion"),
        ("tom", "tom"),
        ("shaker", "shaker"),
        ("tambourine", "tambourine"),
        ("rim", "rimshot"),
        ("808", "808"),
        ("top", "top loop"),
        ("fill", "fill"),
        ("break", "break"),
        ("groove", "groove"),
        ("melody", "melody"),
        ("melodic", "melodic"),
        ("drum", "drums"),
        ("drums", "drums"),
    ];

    for (keyword, tag) in instrument_keywords {
        if combined.contains(keyword) && !tags.contains(&tag.to_string()) {
            tags.push(tag.to_string());
        }
    }

    // ── 상위 카테고리 태그 자동 부여 ──

    // drums: 타악기 계열
    const DRUM_TAGS: &[&str] = &[
        "kick", "snare", "hihat", "clap", "cymbal", "crash", "ride",
        "open hat", "closed hat", "percussion", "tom", "shaker",
        "tambourine", "rimshot", "808", "top loop", "fill",
    ];
    if !tags.contains(&"drums".to_string())
        && tags.iter().any(|t| DRUM_TAGS.contains(&t.as_str()))
    {
        tags.push("drums".to_string());
    }

    // melodic: 음정이 있는 악기 계열
    const MELODIC_TAGS: &[&str] = &[
        "piano", "keys", "guitar", "strings", "brass", "synth", "organ",
        "flute", "bell", "lead", "pad", "pluck", "chord", "arp", "melody",
    ];
    if !tags.contains(&"melodic".to_string())
        && tags.iter().any(|t| MELODIC_TAGS.contains(&t.as_str()))
    {
        tags.push("melodic".to_string());
    }

    // fx: 이펙트/트랜지션 계열
    const FX_TAGS: &[&str] = &[
        "fx", "riser", "impact", "transition", "sweep",
    ];
    if !tags.contains(&"fx".to_string())
        && tags.iter().any(|t| FX_TAGS.contains(&t.as_str()))
    {
        tags.push("fx".to_string());
    }

    // bass: 저음부 계열
    const BASS_TAGS: &[&str] = &[
        "bass", "sub bass", "808",
    ];
    if !tags.contains(&"bass".to_string())
        && tags.iter().any(|t| BASS_TAGS.contains(&t.as_str()))
    {
        tags.push("bass".to_string());
    }

    tags
}

fn parse_genre_from_path(full_path: &str) -> Option<String> {
    let lower = full_path.to_lowercase();

    let genre_keywords: &[(&[&str], &str)] = &[
        (&["hip hop", "hiphop", "hip-hop", "boom bap", "boom-bap"], "Hip Hop"),
        (&["trap"], "Trap"),
        (&["drill"], "Drill"),
        (&["house", "deep house", "tech house"], "House"),
        (&["techno"], "Techno"),
        (&["edm", "electro"], "Electronic"),
        (&["dubstep", "dub step"], "Dubstep"),
        (&["dnb", "drum and bass", "drum & bass", "drum n bass"], "DnB"),
        (&["pop"], "Pop"),
        (&["rnb", "r&b", "r'n'b"], "R&B"),
        (&["lo-fi", "lofi", "lo fi"], "Lo-Fi"),
        (&["ambient"], "Ambient"),
        (&["jazz"], "Jazz"),
        (&["soul"], "Soul"),
        (&["funk"], "Funk"),
        (&["reggae", "dancehall", "reggaeton"], "Reggae"),
        (&["rock", "indie"], "Rock"),
        (&["latin", "salsa", "bossa"], "Latin"),
        (&["afro", "afrobeat"], "Afrobeat"),
        (&["cinematic", "film", "orchestral"], "Cinematic"),
        (&["future bass", "future-bass"], "Future Bass"),
        (&["trance"], "Trance"),
        (&["garage", "uk garage"], "Garage"),
    ];

    for (keywords, genre) in genre_keywords {
        for kw in *keywords {
            if lower.contains(kw) {
                return Some(genre.to_string());
            }
        }
    }

    None
}

fn is_audio_file(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => matches!(
            ext.to_lowercase().as_str(),
            "wav" | "mp3" | "flac" | "ogg" | "aiff" | "aif"
        ),
        None => false,
    }
}

fn collect_audio_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(collect_audio_files(&path));
            } else if is_audio_file(&path) {
                files.push(path);
            }
        }
    }
    files
}

fn generate_pack_uuid(folder_name: &str) -> String {
    let mut hasher = DefaultHasher::new();
    folder_name.hash(&mut hasher);
    format!("ext-{:016x}", hasher.finish())
}

fn compute_duration_ms(file_path: &str) -> Option<i64> {
    let file = std::fs::File::open(file_path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(file_path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;

    let track = probed.format.default_track()?;
    let tb = track.codec_params.time_base?;
    let nf = track.codec_params.n_frames?;
    let time = tb.calc_time(nf);
    let ms = (time.seconds as f64 + time.frac) * 1000.0;
    Some(ms as i64)
}

// ── Commands ────────────────────────────────────────────────────────

#[tauri::command]
fn check_library_status(state: State<AppState>) -> Result<LibraryStatus, String> {
    let db = state.db.lock().unwrap();
    let sample_count: i64 = db
        .query_row("SELECT COUNT(*) FROM samples", [], |row| row.get(0))
        .unwrap_or(0);
    let pack_count: i64 = db
        .query_row(
            "SELECT COUNT(DISTINCT pack_uuid) FROM samples WHERE pack_uuid IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let splice_available = find_splice_db().is_ok();

    Ok(LibraryStatus {
        has_data: sample_count > 0,
        pack_count: pack_count as usize,
        sample_count: sample_count as usize,
        splice_available,
    })
}

#[tauri::command]
fn import_from_splice(app: tauri::AppHandle, state: State<AppState>) -> Result<ImportResult, String> {
    // 1. Open Splice DB (read-only)
    let splice_db_path = find_splice_db()?;
    let splice_db =
        Connection::open_with_flags(&splice_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Splice DB 열기 실패: {}", e))?;

    // 2. Read all packs from Splice
    struct SplicePack {
        uuid: String,
        name: Option<String>,
        description: Option<String>,
        cover_url: Option<String>,
        genre: Option<String>,
        permalink: Option<String>,
    }

    let splice_packs: Vec<SplicePack> = {
        let mut stmt = splice_db
            .prepare("SELECT uuid, name, description, cover_url, genre, permalink FROM packs")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            out.push(SplicePack {
                uuid: row.get::<_, String>(0).unwrap_or_default(),
                name: row.get::<_, Option<String>>(1).unwrap_or(None),
                description: row.get::<_, Option<String>>(2).unwrap_or(None),
                cover_url: row.get::<_, Option<String>>(3).unwrap_or(None),
                genre: row.get::<_, Option<String>>(4).unwrap_or(None),
                permalink: row.get::<_, Option<String>>(5).unwrap_or(None),
            });
        }
        out
    };

    // 3. Read all samples from Splice
    struct SpliceRow {
        local_path: String,
        filename: String,
        audio_key: Option<String>,
        bpm: Option<i32>,
        chord_type: Option<String>,
        duration: Option<i64>,
        file_hash: String,
        genre: Option<String>,
        sample_type: Option<String>,
        tags: Option<String>,
        pack_uuid: Option<String>,
    }

    let splice_samples: Vec<SpliceRow> = {
        let mut stmt = splice_db
            .prepare(
                "SELECT local_path, filename, audio_key, bpm, chord_type, duration,
                        file_hash, genre, sample_type, tags, pack_uuid
                 FROM samples",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            out.push(SpliceRow {
                local_path: row.get::<_, String>(0).unwrap_or_default(),
                filename: row.get::<_, String>(1).unwrap_or_default(),
                audio_key: row.get::<_, Option<String>>(2).unwrap_or(None),
                bpm: row.get::<_, Option<i32>>(3).unwrap_or(None),
                chord_type: row.get::<_, Option<String>>(4).unwrap_or(None),
                duration: row.get::<_, Option<i64>>(5).unwrap_or(None),
                file_hash: row.get::<_, String>(6).unwrap_or_default(),
                genre: row.get::<_, Option<String>>(7).unwrap_or(None),
                sample_type: row.get::<_, Option<String>>(8).unwrap_or(None),
                tags: row.get::<_, Option<String>>(9).unwrap_or(None),
                pack_uuid: row.get::<_, Option<String>>(10).unwrap_or(None),
            });
        }
        out
    };

    // Done with Splice DB
    drop(splice_db);

    // 4. Write to Slice DB
    let mut db = state.db.lock().unwrap();
    db.execute_batch("DELETE FROM samples; DELETE FROM packs;")
        .map_err(|e| format!("기존 데이터 삭제 실패: {}", e))?;

    {
        let tx = db.transaction().map_err(|e| e.to_string())?;

        // Insert packs
        for p in &splice_packs {
            tx.execute(
                "INSERT OR IGNORE INTO packs (uuid, name, description, cover_url, genre, permalink, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
                params![p.uuid, p.name, p.description, p.cover_url, p.genre, p.permalink],
            )
            .map_err(|e| e.to_string())?;
        }

        // Insert samples + copy audio files
        let total = splice_samples.len();
        let splice_sounds_dir = get_splice_sounds_dir().unwrap_or_else(|_| {
            get_home_dir().unwrap_or_default().join("Splice")
        });
        let slice_dir = get_slice_path().unwrap_or_else(|_| {
            get_home_dir().unwrap_or_default().join("Slice")
        });
        let splice_prefix = splice_sounds_dir.to_string_lossy().to_string();
        let slice_prefix = slice_dir.to_string_lossy().to_string();

        let mut copied = 0usize;
        let mut skipped = 0usize;

        for (i, s) in splice_samples.iter().enumerate() {
            // Rewrite path: Splice dir → Slice dir (크로스 플랫폼)
            let old_path_buf = PathBuf::from(&s.local_path);
            let new_path = if let Ok(rel) = old_path_buf.strip_prefix(&splice_sounds_dir) {
                // PathBuf 기반 상대 경로 추출 → Slice 디렉토리에 합치기
                slice_dir.join(rel).to_string_lossy().to_string()
            } else {
                // strip_prefix 실패 시 문자열 치환 폴백
                // (Windows \ / macOS / 모두 처리)
                let normalized_local = s.local_path.replace('\\', "/");
                let normalized_splice = splice_prefix.replace('\\', "/");
                let normalized_slice = slice_prefix.replace('\\', "/");
                normalized_local.replace(&normalized_splice, &normalized_slice)
            };
            let new_path_buf = PathBuf::from(&new_path);

            // Copy audio file
            if !new_path_buf.exists() {
                if old_path_buf.exists() {
                    if let Some(parent) = new_path_buf.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if std::fs::copy(&old_path_buf, &new_path_buf).is_ok() {
                        copied += 1;
                    }
                }
            } else {
                skipped += 1;
            }

            // Use file_hash or generate fallback
            let hash = if s.file_hash.is_empty() {
                format!("path_{}", i)
            } else {
                s.file_hash.clone()
            };

            // BPM: Splice DB 값은 그대로 사용, 없으면 파일명에서 파싱 시도
            let bpm = s.bpm.or_else(|| parse_bpm_from_filename(&s.filename));

            tx.execute(
                "INSERT OR IGNORE INTO samples
                 (local_path, filename, audio_key, bpm, chord_type, duration,
                  file_hash, genre, sample_type, tags, pack_uuid, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'))",
                params![
                    new_path,
                    s.filename,
                    s.audio_key,
                    bpm,
                    s.chord_type,
                    s.duration,
                    hash,
                    s.genre,
                    s.sample_type,
                    s.tags,
                    s.pack_uuid
                ],
            )
            .map_err(|e| e.to_string())?;

            // Emit progress every 10 items
            if i % 10 == 0 || i + 1 == total {
                let _ = app.emit(
                    "import-progress",
                    ImportProgress {
                        current: i + 1,
                        total,
                        current_file: s.filename.clone(),
                        current_pack: 1,
                        total_packs: 1,
                        current_pack_name: String::new(),
                    },
                );
            }
        }

        tx.commit().map_err(|e| e.to_string())?;

        // Return result
        let total_packs: i64 = db
            .query_row(
                "SELECT COUNT(DISTINCT p.uuid) FROM packs p JOIN samples s ON s.pack_uuid = p.uuid",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok(ImportResult {
            files_copied: copied,
            files_skipped: skipped,
            total_packs: total_packs as usize,
        })
    }
}

#[tauri::command]
fn scan_library(state: State<AppState>) -> Result<LibraryData, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT p.uuid, p.name, p.genre, p.cover_url, COUNT(s.id) as sample_count, p.created_at
             FROM packs p
             JOIN samples s ON s.pack_uuid = p.uuid
             GROUP BY p.uuid
             ORDER BY p.name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let packs: Vec<Pack> = stmt
        .query_map([], |row| {
            Ok(Pack {
                uuid: row.get(0)?,
                name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                genre: row.get(2)?,
                cover_url: row.get(3)?,
                sample_count: row.get::<_, i64>(4)? as usize,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let total_samples = packs.iter().map(|p| p.sample_count).sum();

    Ok(LibraryData {
        packs,
        total_samples,
    })
}

#[tauri::command]
fn get_all_samples(state: State<AppState>) -> Result<Vec<Sample>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT s.id, s.local_path, s.filename, s.audio_key, s.bpm, s.chord_type,
                    s.duration, COALESCE(s.genre, p.genre) as genre,
                    s.sample_type, s.tags,
                    s.pack_uuid, p.name as pack_name, p.genre as pack_genre,
                    s.created_at
             FROM samples s
             LEFT JOIN packs p ON s.pack_uuid = p.uuid
             ORDER BY s.filename COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let samples: Vec<Sample> = stmt
        .query_map([], |row| {
            Ok(Sample {
                id: row.get(0)?,
                local_path: row.get(1)?,
                filename: row.get(2)?,
                audio_key: row.get(3)?,
                bpm: row.get(4)?,
                chord_type: row.get(5)?,
                duration: row.get(6)?,
                genre: row.get(7)?,
                sample_type: row.get(8)?,
                tags: row.get(9)?,
                pack_uuid: row.get(10)?,
                pack_name: row.get(11)?,
                pack_genre: row.get(12)?,
                created_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(samples)
}

#[tauri::command]
fn get_pack_samples(pack_uuid: String, state: State<AppState>) -> Result<Vec<Sample>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT s.id, s.local_path, s.filename, s.audio_key, s.bpm, s.chord_type,
                    s.duration, COALESCE(s.genre, p.genre) as genre,
                    s.sample_type, s.tags,
                    s.pack_uuid, p.name as pack_name, p.genre as pack_genre,
                    s.created_at
             FROM samples s
             LEFT JOIN packs p ON s.pack_uuid = p.uuid
             WHERE s.pack_uuid = ?1
             ORDER BY s.filename COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;

    let samples: Vec<Sample> = stmt
        .query_map(params![pack_uuid], |row| {
            Ok(Sample {
                id: row.get(0)?,
                local_path: row.get(1)?,
                filename: row.get(2)?,
                audio_key: row.get(3)?,
                bpm: row.get(4)?,
                chord_type: row.get(5)?,
                duration: row.get(6)?,
                genre: row.get(7)?,
                sample_type: row.get(8)?,
                tags: row.get(9)?,
                pack_uuid: row.get(10)?,
                pack_name: row.get(11)?,
                pack_genre: row.get(12)?,
                created_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(samples)
}

/// 폴더 트리 구조를 재귀적으로 스캔
fn build_folder_tree(dir: &Path) -> FolderNode {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let mut audio_count = 0usize;
    let mut children = Vec::new();

    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let path = entry.path();
            if path.is_dir() {
                // .으로 시작하는 숨김 폴더 제외
                let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !fname.starts_with('.') {
                    let child = build_folder_tree(&path);
                    if child.total_audio_count > 0 {
                        children.push(child);
                    }
                }
            } else if is_audio_file(&path) {
                audio_count += 1;
            }
        }
    }

    let total_audio_count = audio_count + children.iter().map(|c| c.total_audio_count).sum::<usize>();

    FolderNode {
        name,
        path: dir.to_string_lossy().to_string(),
        audio_count,
        total_audio_count,
        children,
    }
}

/// 외부 폴더의 트리 구조 스캔 (팩 선택 UI용)
#[tauri::command]
fn scan_external_folder(folder_path: String) -> Result<FolderNode, String> {
    let folder = PathBuf::from(&folder_path);
    if !folder.is_dir() {
        return Err("유효한 폴더가 아닙니다".to_string());
    }
    let tree = build_folder_tree(&folder);
    if tree.total_audio_count == 0 {
        return Err("오디오 파일을 찾을 수 없습니다".to_string());
    }
    Ok(tree)
}

/// 팩 이름 충돌 확인
#[tauri::command]
fn check_pack_name_conflicts(
    pack_names: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<PackConflict>, String> {
    let db = state.db.lock().unwrap();
    let mut conflicts = Vec::new();

    for name in &pack_names {
        let result: Result<(String, usize), _> = db.query_row(
            "SELECT p.uuid, COUNT(s.id) FROM packs p
             LEFT JOIN samples s ON s.pack_uuid = p.uuid
             WHERE p.name = ?1
             GROUP BY p.uuid",
            params![name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        if let Ok((uuid, count)) = result {
            conflicts.push(PackConflict {
                name: name.clone(),
                existing_uuid: uuid,
                existing_sample_count: count,
            });
        }
    }

    Ok(conflicts)
}

/// 단일 팩을 임포트하는 내부 헬퍼
/// replace_uuid: Some이면 기존 팩을 교체 (기존 샘플 삭제 후 해당 UUID 재사용)
fn import_single_pack(
    pack_name: &str,
    pack_folder: &Path,
    audio_files: &[PathBuf],
    dest_base: &Path,
    tx: &rusqlite::Transaction,
    app: &tauri::AppHandle,
    global_offset: usize,
    global_total: usize,
    replace_uuid: Option<&str>,
    pack_index: usize,
    total_packs: usize,
) -> Result<(usize, usize), String> {
    let pack_path_str = pack_folder.to_string_lossy().to_string();

    // 교체 모드: 기존 팩의 UUID 사용 + 기존 샘플 삭제
    // 새로 추가 모드: 폴더 경로 기반 UUID 생성
    let pack_uuid = if let Some(uuid) = replace_uuid {
        // 기존 샘플 삭제
        tx.execute(
            "DELETE FROM samples WHERE pack_uuid = ?1",
            params![uuid],
        )
        .map_err(|e| format!("기존 샘플 삭제 실패: {}", e))?;
        uuid.to_string()
    } else {
        generate_pack_uuid(&pack_path_str)
    };

    // 팩 등록
    let genre = parse_genre_from_path(&pack_path_str);
    tx.execute(
        "INSERT OR REPLACE INTO packs (uuid, name, description, cover_url, genre, permalink, created_at)
         VALUES (?1, ?2, ?3, NULL, ?4, NULL, datetime('now'))",
        params![pack_uuid, pack_name, format!("외부 임포트: {}", pack_name), genre],
    )
    .map_err(|e| format!("팩 등록 실패: {}", e))?;

    let mut copied = 0usize;
    let mut skipped = 0usize;

    for (i, src_path) in audio_files.iter().enumerate() {
        let src_str = src_path.to_string_lossy().to_string();
        let filename = src_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        // 상대 경로 유지
        let rel_path = src_path
            .strip_prefix(pack_folder)
            .unwrap_or(src_path)
            .to_string_lossy()
            .to_string();
        let dest_path = dest_base.join(&rel_path);
        let dest_str = dest_path.to_string_lossy().to_string();

        // 파일 복사
        if !dest_path.exists() {
            if let Some(parent) = dest_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::copy(src_path, &dest_path).is_ok() {
                copied += 1;
            }
        } else {
            skipped += 1;
        }

        // 메타데이터 파싱
        let full_path_for_parse = format!("{}/{}", pack_name, rel_path);
        let duration_ms = compute_duration_ms(&dest_str)
            .or_else(|| compute_duration_ms(&src_str));

        // BPM: 파일명 → 오디오 분석 순으로 시도
        // (2초 이상 샘플이면 루프 여부와 관계없이 오디오 분석 시도)
        let bpm = parse_bpm_from_filename(&full_path_for_parse).or_else(|| {
            let long_enough = duration_ms.map(|d| d >= 2000).unwrap_or(false);
            if long_enough {
                let target = if dest_path.exists() { &dest_str } else { &src_str };
                detect_bpm_from_audio(target)
            } else {
                None
            }
        });

        let audio_key = parse_key_from_filename(&full_path_for_parse);
        let audio_path = if dest_path.exists() { &dest_str } else { &src_str };
        let sample_type = parse_sample_type(&full_path_for_parse, duration_ms, Some(audio_path));
        let tags_vec = parse_tags_from_path(&full_path_for_parse, &filename);
        let tags = if tags_vec.is_empty() {
            None
        } else {
            Some(tags_vec.join(","))
        };
        let sample_genre = parse_genre_from_path(&full_path_for_parse).or_else(|| genre.clone());

        // file_hash: dest_path 기반으로 생성
        let mut hasher = DefaultHasher::new();
        dest_str.hash(&mut hasher);
        let file_hash = format!("ext-{:016x}", hasher.finish());

        tx.execute(
            "INSERT OR IGNORE INTO samples
             (local_path, filename, audio_key, bpm, chord_type, duration,
              file_hash, genre, sample_type, tags, pack_uuid, created_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))",
            params![
                dest_str,
                filename,
                audio_key,
                bpm,
                duration_ms,
                file_hash,
                sample_genre,
                sample_type,
                tags,
                pack_uuid
            ],
        )
        .map_err(|e| e.to_string())?;

        // 진행 상황 전송 (전역 인덱스 기준)
        let global_i = global_offset + i;
        if global_i % 5 == 0 || global_i + 1 == global_total {
            let _ = app.emit(
                "import-progress",
                ImportProgress {
                    current: global_i + 1,
                    total: global_total,
                    current_file: filename.clone(),
                    current_pack: pack_index + 1,
                    total_packs,
                    current_pack_name: pack_name.to_string(),
                },
            );
        }
    }

    Ok((copied, skipped))
}

/// 외부 폴더에서 샘플팩 임포트
/// selected_paths: 팩으로 임포트할 폴더 경로 목록
/// replace_map: 폴더명 → 기존 팩 UUID (교체할 팩 매핑, 없으면 새로 추가)
#[tauri::command]
fn import_external_folder(
    selected_paths: Vec<String>,
    replace_map: std::collections::HashMap<String, String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<ImportResult, String> {
    if selected_paths.is_empty() {
        return Err("임포트할 폴더를 선택해주세요".to_string());
    }

    // 각 선택된 폴더의 오디오 파일 수집
    let mut packs: Vec<(String, PathBuf, Vec<PathBuf>)> = Vec::new();
    for path_str in &selected_paths {
        let folder = PathBuf::from(path_str);
        if !folder.is_dir() {
            continue;
        }
        let name = folder
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown Pack")
            .to_string();
        let audio_files = collect_audio_files(&folder);
        if !audio_files.is_empty() {
            packs.push((name, folder, audio_files));
        }
    }

    if packs.is_empty() {
        return Err("선택된 폴더에서 오디오 파일을 찾을 수 없습니다".to_string());
    }

    let total_packs = packs.len();
    let global_total: usize = packs.iter().map(|(_, _, files)| files.len()).sum();
    let slice_dir = get_slice_path()?;

    let mut total_copied = 0usize;
    let mut total_skipped = 0usize;
    let mut global_offset = 0usize;

    let mut db = state.db.lock().unwrap();
    let tx = db.transaction().map_err(|e| e.to_string())?;

    for (pack_idx, (pack_name, pack_folder, audio_files)) in packs.iter().enumerate() {
        let dest_base = slice_dir.join("External").join(pack_name);
        let file_count = audio_files.len();
        let replace_uuid = replace_map.get(pack_name).map(|s| s.as_str());

        let (copied, skipped) = import_single_pack(
            pack_name,
            pack_folder,
            audio_files,
            &dest_base,
            &tx,
            &app,
            global_offset,
            global_total,
            replace_uuid,
            pack_idx,
            total_packs,
        )?;

        total_copied += copied;
        total_skipped += skipped;
        global_offset += file_count;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ImportResult {
        files_copied: total_copied,
        files_skipped: total_skipped,
        total_packs,
    })
}

/// Waveform 데이터 반환 (DB 캐시 사용, peaks + frequency colors)
#[tauri::command]
fn get_waveform(path: String, state: State<AppState>) -> Result<WaveformData, String> {
    // Check DB cache — peaks와 colors 모두 있어야 캐시 히트
    {
        let db = state.db.lock().unwrap();
        if let Ok((peaks_json, colors_json, dur_opt)) = db.query_row(
            "SELECT waveform_peaks, waveform_colors, duration FROM samples WHERE local_path = ?1",
            params![&path],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            },
        ) {
            if let (Some(peaks_str), Some(colors_str)) = (&peaks_json, &colors_json) {
                if let (Ok(peaks), Ok(colors)) = (
                    serde_json::from_str::<Vec<f32>>(peaks_str),
                    serde_json::from_str::<Vec<[f32; 3]>>(colors_str),
                ) {
                    let duration_secs = dur_opt.map(|d| d as f64 / 1000.0).unwrap_or(0.0);
                    return Ok(WaveformData {
                        peaks,
                        colors,
                        duration_secs,
                    });
                }
            }
        }
    } // release lock before expensive computation

    // Compute waveform (peaks + frequency colors)
    let waveform = compute_waveform_internal(&path, 128)?;

    // Store in DB cache
    {
        let db = state.db.lock().unwrap();
        if let (Ok(peaks_json), Ok(colors_json)) = (
            serde_json::to_string(&waveform.peaks),
            serde_json::to_string(&waveform.colors),
        ) {
            let _ = db.execute(
                "UPDATE samples SET waveform_peaks = ?1, waveform_colors = ?2 WHERE local_path = ?3",
                params![peaks_json, colors_json, &path],
            );
        }
    }

    Ok(waveform)
}

// ── Update commands ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SampleUpdate {
    pub id: i64,
    pub filename: String,
    pub tags: Option<String>,
    pub genre: Option<String>,
    pub audio_key: Option<String>,
    pub chord_type: Option<String>,
    pub bpm: Option<i32>,
    pub sample_type: Option<String>,
}

#[tauri::command]
fn update_sample(update: SampleUpdate, state: State<AppState>) -> Result<Sample, String> {
    let db = state.db.lock().unwrap();

    db.execute(
        "UPDATE samples SET filename = ?1, tags = ?2, genre = ?3, audio_key = ?4, chord_type = ?5, bpm = ?6, sample_type = ?7 WHERE id = ?8",
        params![
            update.filename,
            update.tags,
            update.genre,
            update.audio_key,
            update.chord_type,
            update.bpm,
            update.sample_type,
            update.id,
        ],
    )
    .map_err(|e| format!("샘플 업데이트 실패: {}", e))?;

    // 업데이트된 샘플을 다시 조회해서 반환
    let sample = db
        .query_row(
            "SELECT s.id, s.local_path, s.filename, s.audio_key, s.bpm, s.chord_type,
                    s.duration, COALESCE(s.genre, p.genre) as genre,
                    s.sample_type, s.tags,
                    s.pack_uuid, p.name as pack_name, p.genre as pack_genre,
                    s.created_at
             FROM samples s
             LEFT JOIN packs p ON s.pack_uuid = p.uuid
             WHERE s.id = ?1",
            params![update.id],
            |row| {
                Ok(Sample {
                    id: row.get(0)?,
                    local_path: row.get(1)?,
                    filename: row.get(2)?,
                    audio_key: row.get(3)?,
                    bpm: row.get(4)?,
                    chord_type: row.get(5)?,
                    duration: row.get(6)?,
                    genre: row.get(7)?,
                    sample_type: row.get(8)?,
                    tags: row.get(9)?,
                    pack_uuid: row.get(10)?,
                    pack_name: row.get(11)?,
                    pack_genre: row.get(12)?,
                    created_at: row.get(13)?,
                })
            },
        )
        .map_err(|e| format!("업데이트된 샘플 조회 실패: {}", e))?;

    Ok(sample)
}

// ── Pack update ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PackUpdate {
    pub uuid: String,
    pub name: String,
    pub genre: Option<String>,
}

#[tauri::command]
fn update_pack(update: PackUpdate, state: State<AppState>) -> Result<Pack, String> {
    let db = state.db.lock().unwrap();

    db.execute(
        "UPDATE packs SET name = ?1, genre = ?2 WHERE uuid = ?3",
        params![update.name, update.genre, update.uuid],
    )
    .map_err(|e| format!("팩 업데이트 실패: {}", e))?;

    // 업데이트된 팩을 다시 조회해서 반환
    let pack = db
        .query_row(
            "SELECT p.uuid, p.name, p.genre, p.cover_url, COUNT(s.id) as sample_count, p.created_at
             FROM packs p
             LEFT JOIN samples s ON s.pack_uuid = p.uuid
             WHERE p.uuid = ?1
             GROUP BY p.uuid",
            params![update.uuid],
            |row| {
                Ok(Pack {
                    uuid: row.get(0)?,
                    name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    genre: row.get(2)?,
                    cover_url: row.get(3)?,
                    sample_count: row.get::<_, i64>(4)? as usize,
                    created_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| format!("업데이트된 팩 조회 실패: {}", e))?;

    Ok(pack)
}

// ── Delete commands ──────────────────────────────────────────────────

/// 개별 샘플 삭제 (DB + 파일)
#[tauri::command]
fn delete_sample(sample_id: i64, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();

    // 1. 파일 경로 조회
    let local_path: Option<String> = db
        .query_row(
            "SELECT local_path FROM samples WHERE id = ?1",
            params![sample_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("샘플 조회 실패: {}", e))?;

    // 2. 실제 파일 삭제
    if let Some(ref path) = local_path {
        let p = Path::new(path);
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }
    }

    // 3. DB에서 삭제
    db.execute("DELETE FROM samples WHERE id = ?1", params![sample_id])
        .map_err(|e| format!("샘플 삭제 실패: {}", e))?;

    Ok(())
}

/// 팩 삭제 (소속 샘플 파일 + DB 레코드 일괄 삭제)
#[tauri::command]
fn delete_pack(pack_uuid: String, state: State<AppState>) -> Result<usize, String> {
    let db = state.db.lock().unwrap();

    // 1. 소속 샘플의 파일 경로 모두 조회
    let paths: Vec<String> = {
        let mut stmt = db
            .prepare("SELECT local_path FROM samples WHERE pack_uuid = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![&pack_uuid], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let count = paths.len();

    // 2. 실제 파일 삭제
    for path in &paths {
        let p = Path::new(path);
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }
    }

    // 3. DB에서 샘플 삭제
    db.execute(
        "DELETE FROM samples WHERE pack_uuid = ?1",
        params![&pack_uuid],
    )
    .map_err(|e| format!("샘플 삭제 실패: {}", e))?;

    // 4. DB에서 팩 삭제
    db.execute("DELETE FROM packs WHERE uuid = ?1", params![&pack_uuid])
        .map_err(|e| format!("팩 삭제 실패: {}", e))?;

    // 5. 빈 디렉토리 정리 시도
    for path in &paths {
        let p = Path::new(path);
        if let Some(parent) = p.parent() {
            // 디렉토리가 비어있으면 삭제 (실패해도 무시)
            let _ = std::fs::remove_dir(parent);
        }
    }

    Ok(count)
}

/// 모든 샘플 삭제 (DB 레코드 + 오디오 파일 일괄 삭제)
#[tauri::command]
fn delete_all_samples(state: State<AppState>) -> Result<usize, String> {
    let db = state.db.lock().unwrap();

    // 1. 모든 샘플의 파일 경로 조회
    let paths: Vec<String> = {
        let mut stmt = db
            .prepare("SELECT local_path FROM samples")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let count = paths.len();

    // 2. 실제 파일 삭제
    for path in &paths {
        let p = Path::new(path);
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }
    }

    // 3. DB 초기화
    db.execute_batch("DELETE FROM samples; DELETE FROM packs;")
        .map_err(|e| format!("데이터 삭제 실패: {}", e))?;

    // 4. 빈 디렉토리 정리
    if let Some(home) = dirs::home_dir() {
        let slice_dir = home.join("Slice");
        if slice_dir.exists() {
            // 하위 빈 디렉토리 재귀 삭제 (slice.db가 있는 루트는 유지)
            fn remove_empty_dirs(dir: &Path) {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            remove_empty_dirs(&path);
                            let _ = std::fs::remove_dir(&path); // 비어있을 때만 성공
                        }
                    }
                }
            }
            remove_empty_dirs(&slice_dir);
        }
    }

    Ok(count)
}

// ── ZIP export helper ────────────────────────────────────────────────

fn make_unique_name(base: &str, used: &mut HashSet<String>) -> String {
    if used.insert(base.to_string()) {
        return base.to_string();
    }
    let stem = Path::new(base)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(base);
    let ext = Path::new(base).extension().and_then(|s| s.to_str());
    for i in 2.. {
        let candidate = match ext {
            Some(e) => format!("{} ({}).{}", stem, i, e),
            None => format!("{} ({})", stem, i),
        };
        if used.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
}

/// 선택된 샘플을 ZIP 파일로 내보내기
#[tauri::command]
fn export_samples(
    sample_ids: Vec<i64>,
    dest_path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<usize, String> {
    // 1. DB에서 샘플 정보 조회
    let samples: Vec<Sample> = {
        let db = state.db.lock().unwrap();
        let placeholders: String = sample_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let query = format!(
            "SELECT s.id, s.local_path, s.filename, s.audio_key, s.bpm, s.chord_type,
                    s.duration, COALESCE(s.genre, p.genre) as genre,
                    s.sample_type, s.tags,
                    s.pack_uuid, p.name as pack_name, p.genre as pack_genre,
                    s.created_at
             FROM samples s
             LEFT JOIN packs p ON s.pack_uuid = p.uuid
             WHERE s.id IN ({})",
            placeholders
        );
        let mut stmt = db.prepare(&query).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(sample_ids.iter()), |row| {
                Ok(Sample {
                    id: row.get(0)?,
                    local_path: row.get(1)?,
                    filename: row.get(2)?,
                    audio_key: row.get(3)?,
                    bpm: row.get(4)?,
                    chord_type: row.get(5)?,
                    duration: row.get(6)?,
                    genre: row.get(7)?,
                    sample_type: row.get(8)?,
                    tags: row.get(9)?,
                    pack_uuid: row.get(10)?,
                    pack_name: row.get(11)?,
                    pack_genre: row.get(12)?,
                    created_at: row.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    }; // DB lock released

    if samples.is_empty() {
        return Err("내보낼 샘플이 없습니다".to_string());
    }

    // 2. ZIP 파일 생성
    let file = std::fs::File::create(&dest_path)
        .map_err(|e| format!("ZIP 파일 생성 실패: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let total = samples.len();
    let mut used_names: HashSet<String> = HashSet::new();
    let mut exported = 0usize;

    for (i, sample) in samples.iter().enumerate() {
        // 고유한 오디오 파일명 생성
        let audio_name = make_unique_name(&sample.filename, &mut used_names);

        // 메타데이터 파일명 생성 (오디오 파일 확장자 제거 + _metadata.json)
        let audio_stem = Path::new(&audio_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let meta_filename = format!("{}_metadata.json", audio_stem);
        let meta_name = make_unique_name(&meta_filename, &mut used_names);

        // 오디오 파일 추가
        let audio_path = Path::new(&sample.local_path);
        if audio_path.exists() {
            let audio_data = std::fs::read(audio_path)
                .map_err(|e| format!("오디오 파일 읽기 실패 ({}): {}", sample.filename, e))?;
            zip.start_file(&audio_name, options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&audio_data).map_err(|e| e.to_string())?;
        }

        // 메타데이터 JSON 생성
        let tags_array: Option<Vec<String>> = sample
            .tags
            .as_ref()
            .map(|t| t.split(',').map(|s| s.trim().to_string()).collect());

        let metadata = serde_json::json!({
            "filename": sample.filename,
            "audio_key": sample.audio_key,
            "bpm": sample.bpm,
            "chord_type": sample.chord_type,
            "duration_ms": sample.duration,
            "genre": sample.genre,
            "sample_type": sample.sample_type,
            "tags": tags_array,
            "pack_name": sample.pack_name,
            "pack_uuid": sample.pack_uuid,
            "pack_genre": sample.pack_genre,
        });

        let json_bytes = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
        zip.start_file(&meta_name, options)
            .map_err(|e| e.to_string())?;
        zip.write_all(json_bytes.as_bytes())
            .map_err(|e| e.to_string())?;

        exported += 1;

        // 진행 상황 이벤트 발행
        if i % 5 == 0 || i + 1 == total {
            let _ = app.emit(
                "export-progress",
                ExportProgress {
                    current: i + 1,
                    total,
                    current_file: sample.filename.clone(),
                },
            );
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(exported)
}

// ── Playlist commands ────────────────────────────────────────────────

#[tauri::command]
fn get_playlists(state: State<AppState>) -> Result<Vec<Playlist>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT p.id, p.name, p.color, p.created_at, COUNT(ps.sample_id) as sample_count
             FROM playlists p
             LEFT JOIN playlist_samples ps ON ps.playlist_id = p.id
             GROUP BY p.id
             ORDER BY p.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let playlists = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                created_at: row.get(3)?,
                sample_count: row.get::<_, i64>(4)? as usize,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(playlists)
}

#[tauri::command]
fn create_playlist(name: String, color: Option<String>, state: State<AppState>) -> Result<Playlist, String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO playlists (name, color) VALUES (?1, ?2)",
        params![name, color],
    )
    .map_err(|e| format!("플레이리스트 생성 실패: {}", e))?;

    let id = db.last_insert_rowid();
    let playlist = db
        .query_row(
            "SELECT id, name, color, created_at FROM playlists WHERE id = ?1",
            params![id],
            |row| {
                Ok(Playlist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                    sample_count: 0,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(playlist)
}

#[tauri::command]
fn rename_playlist(playlist_id: i64, name: String, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "UPDATE playlists SET name = ?1 WHERE id = ?2",
        params![name, playlist_id],
    )
    .map_err(|e| format!("플레이리스트 이름 변경 실패: {}", e))?;
    Ok(())
}

#[tauri::command]
fn update_playlist_color(playlist_id: i64, color: Option<String>, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "UPDATE playlists SET color = ?1 WHERE id = ?2",
        params![color, playlist_id],
    )
    .map_err(|e| format!("플레이리스트 색상 변경 실패: {}", e))?;
    Ok(())
}

#[tauri::command]
fn delete_playlist(playlist_id: i64, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM playlist_samples WHERE playlist_id = ?1", params![playlist_id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])
        .map_err(|e| format!("플레이리스트 삭제 실패: {}", e))?;
    Ok(())
}

#[tauri::command]
fn add_to_playlist(playlist_id: i64, sample_ids: Vec<i64>, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("INSERT OR IGNORE INTO playlist_samples (playlist_id, sample_id) VALUES (?1, ?2)")
        .map_err(|e| e.to_string())?;
    for sid in &sample_ids {
        stmt.execute(params![playlist_id, sid]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn remove_from_playlist(playlist_id: i64, sample_ids: Vec<i64>, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    for sid in &sample_ids {
        db.execute(
            "DELETE FROM playlist_samples WHERE playlist_id = ?1 AND sample_id = ?2",
            params![playlist_id, sid],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_playlist_samples(playlist_id: i64, state: State<AppState>) -> Result<Vec<Sample>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT s.id, s.local_path, s.filename, s.audio_key, s.bpm, s.chord_type,
                    s.duration, COALESCE(s.genre, p.genre) as genre,
                    s.sample_type, s.tags,
                    s.pack_uuid, p.name as pack_name, p.genre as pack_genre,
                    s.created_at
             FROM playlist_samples ps
             JOIN samples s ON s.id = ps.sample_id
             LEFT JOIN packs p ON s.pack_uuid = p.uuid
             WHERE ps.playlist_id = ?1
             ORDER BY ps.added_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let samples = stmt
        .query_map(params![playlist_id], |row| {
            Ok(Sample {
                id: row.get(0)?,
                local_path: row.get(1)?,
                filename: row.get(2)?,
                audio_key: row.get(3)?,
                bpm: row.get(4)?,
                chord_type: row.get(5)?,
                duration: row.get(6)?,
                genre: row.get(7)?,
                sample_type: row.get(8)?,
                tags: row.get(9)?,
                pack_uuid: row.get(10)?,
                pack_name: row.get(11)?,
                pack_genre: row.get(12)?,
                created_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(samples)
}

// ── Drag icon path ──────────────────────────────────────────────────

#[tauri::command]
fn get_drag_icon_path(app: tauri::AppHandle) -> Result<String, String> {
    // 1) 번들 리소스 경로 시도 (프로덕션 빌드)
    if let Ok(resource_path) = app
        .path()
        .resolve("icons/32x32.png", tauri::path::BaseDirectory::Resource)
    {
        if resource_path.exists() {
            return Ok(resource_path.to_string_lossy().to_string());
        }
    }

    // 2) 개발 모드 폴백: src-tauri/icons/32x32.png
    let dev_icon = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons").join("32x32.png");
    if dev_icon.exists() {
        return Ok(dev_icon.to_string_lossy().to_string());
    }

    Err("드래그 아이콘을 찾을 수 없습니다".to_string())
}

// ── Entry point ─────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let slice_path = get_slice_path().expect("Failed to get Slice path");
    std::fs::create_dir_all(&slice_path).expect("Failed to create Slice directory");

    let db_path = slice_path.join("slice.db");
    let db = Connection::open(&db_path).expect("Failed to open database");
    init_db(&db).expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            db: Mutex::new(db),
        })
        .invoke_handler(tauri::generate_handler![
            check_library_status,
            import_from_splice,
            scan_external_folder,
            check_pack_name_conflicts,
            import_external_folder,
            scan_library,
            get_all_samples,
            get_pack_samples,
            get_waveform,
            export_samples,
            update_sample,
            update_pack,
            delete_sample,
            delete_pack,
            delete_all_samples,
            get_drag_icon_path,
            get_playlists,
            create_playlist,
            rename_playlist,
            update_playlist_color,
            delete_playlist,
            add_to_playlist,
            remove_from_playlist,
            get_playlist_samples,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
