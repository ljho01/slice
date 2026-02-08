import { Download, Music, Search, Waves, Github, Zap, Database, ArrowRight, Command } from "lucide-react";

export default function App() {
  const handleDownload = () => {
    window.open("https://github.com/yourusername/slice/releases/latest", "_blank");
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#ededed] selection:bg-white/20 selection:text-white font-sans antialiased">
      {/* 미세한 노이즈 텍스처 (필름 그레인 느낌) */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]"
           style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}>
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 md:px-8 py-12 flex flex-col">
        {/* 네비게이션 */}
        <nav className="w-full flex justify-between items-center mb-20 fade-in-up" style={{ animationDelay: '0ms' }}>
          <div className="flex items-center">
            <img src="/icon.png" alt="Slice" className="w-8 h-8" />
          </div>
          <a
            href="https://github.com/yourusername/slice"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-500 hover:text-zinc-200 transition-colors text-xs font-medium tracking-wide flex items-center gap-2"
          >
            GitHub
            <ArrowRight className="w-3 h-3" />
          </a>
        </nav>

        {/* 히어로 섹션 */}
        <div className="w-full space-y-8 mb-20 fade-in-up text-center flex flex-col items-center" style={{ animationDelay: '100ms' }}>
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-white/5 bg-white/[0.02] text-[10px] font-medium text-zinc-400 uppercase tracking-widest">
              <span className="w-1 h-1 rounded-full bg-emerald-500/80"></span>
              v0.1.0 Beta
            </div>
            
            <h1 className="text-3xl md:text-5xl font-medium tracking-[-0.03em] leading-[1.1] text-white">
              Your samples,<br />
              <span className="text-zinc-600">quietly organized.</span>
            </h1>
            
            <p className="text-base md:text-lg text-zinc-400 max-w-lg mx-auto leading-relaxed font-normal tracking-tight">
              A minimal local browser for your Splice library.<br />
              No distractions, just your sound.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
            <button
              onClick={handleDownload}
              className="group flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-zinc-100 text-black hover:bg-white transition-all shadow-[0_0_20px_-5px_rgba(255,255,255,0.1)]"
            >
              <Download className="w-4 h-4" />
              Download for macOS
            </button>
            <div className="flex items-center gap-3 px-2 text-[11px] text-zinc-600 font-mono">
              <span>macOS 11.0+</span>
              <span className="w-px h-2.5 bg-zinc-800"></span>
              <span>Apple Silicon Ready</span>
            </div>
          </div>
        </div>

        {/* 앱 스크린샷 (대형 강조) */}
        <div className="relative w-full mb-40 fade-in-up" style={{ animationDelay: '200ms' }}>
          <div className="relative rounded-xl overflow-hidden border border-white/10 bg-[#0a0a0a] shadow-[0_0_100px_-20px_rgba(0,0,0,0.7)]">
            {/* 윈도우 컨트롤 */}
            <div className="absolute top-0 left-0 right-0 h-10 bg-[#0a0a0a] border-b border-white/5 flex items-center px-4 gap-2 z-20">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
              </div>
            </div>
            <img 
              src="/app-screenshot.png" 
              alt="Slice App Screenshot" 
              className="w-full h-auto pt-10 opacity-100"
            />
            {/* 오버레이 그라데이션 (하단만 살짝) */}
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#050505] to-transparent opacity-30 pointer-events-none"></div>
          </div>
        </div>

        {/* 기능 소개 (리스트 형태) */}
        <div className="w-full mb-40 fade-in-up" style={{ animationDelay: '300ms' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-20 gap-y-16">
            <div className="space-y-8">
              <h2 className="text-2xl font-medium tracking-tight text-white">Essentials</h2>
              <p className="text-zinc-500 text-sm leading-relaxed max-w-sm">
                We focused on the absolute necessities for a sample browser. Speed, clarity, and accessibility.
              </p>
            </div>
            
            <div className="space-y-12">
              <FeatureItem 
                title="Lightning Fast"
                desc="Virtual scrolling technology handles thousands of samples without a single frame drop."
              />
              <FeatureItem 
                title="Instant Waveform"
                desc="Visual waveforms are generated instantly. See the sound before you hear it."
              />
              <FeatureItem 
                title="Local First"
                desc="Your data stays on your machine. SQLite database ensures offline access and privacy."
              />
              <FeatureItem 
                title="Smart Filtering"
                desc="Filter by BPM, Key, Tag, and Instrument with keyboard-centric navigation."
              />
            </div>
          </div>
        </div>

        {/* 단축키 섹션 (개발자 친화적) */}
        <div className="w-full mb-40 border-t border-white/5 pt-20 fade-in-up" style={{ animationDelay: '400ms' }}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
            <div>
              <h3 className="text-lg font-medium text-white mb-2">Keyboard First</h3>
              <p className="text-zinc-500 text-sm">Designed for workflow efficiency.</p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs font-mono text-zinc-400">
              <div className="flex items-center gap-3">
                <span className="px-2 py-1 rounded bg-zinc-900 border border-white/10 text-zinc-300">Space</span>
                <span>Play / Pause</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-2 py-1 rounded bg-zinc-900 border border-white/10 text-zinc-300">↓ / ↑</span>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-2 py-1 rounded bg-zinc-900 border border-white/10 text-zinc-300">Cmd + F</span>
                <span>Search</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-2 py-1 rounded bg-zinc-900 border border-white/10 text-zinc-300">Esc</span>
                <span>Clear Filter</span>
              </div>
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <footer className="w-full border-t border-white/5 pt-12 pb-24 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 fade-in-up" style={{ animationDelay: '500ms' }}>
          <div className="flex items-center gap-2 text-zinc-600 text-sm">
            Slice
          </div>
          <div className="flex gap-6 text-xs text-zinc-600 font-medium">
            <a href="#" className="hover:text-zinc-300 transition-colors">GitHub</a>
            <a href="#" className="hover:text-zinc-300 transition-colors">Twitter</a>
            <a href="mailto:contact@example.com" className="hover:text-zinc-300 transition-colors">Contact</a>
          </div>
        </footer>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-in-up {
          opacity: 0;
          animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}

function FeatureItem({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="group">
      <h3 className="text-sm font-medium text-zinc-200 mb-1.5 group-hover:text-white transition-colors">
        {title}
      </h3>
      <p className="text-sm text-zinc-500 leading-relaxed font-normal group-hover:text-zinc-400 transition-colors">
        {desc}
      </p>
    </div>
  );
}
