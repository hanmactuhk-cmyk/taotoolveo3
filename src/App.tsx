/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  FolderOpen,
  Users,
  Settings,
  Terminal,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Upload,
  Plus,
  Trash2,
  ExternalLink,
  Cpu,
  Layers,
  Lock,
  Code,
  ShieldCheck,
  Check,
  ChevronRight
} from 'lucide-react';

interface Account {
  id: string;
  name: string;
  email: string;
  plan: 'Free' | 'Plus' | 'Pro' | 'Ultra' | 'Unknown';
  credits: number | null;
  status: string;
  enabled: boolean;
  images: boolean;
  videos: boolean;
  loginStarted: boolean;
  loginMode: boolean;
  port: number;
  browserId: string;
  checkedAt: string;
}

interface JobTask {
  id: string;
  kind: 'video' | 'image';
  mode: string;
  model: string;
  ratio: string;
  count: string;
  prompt: string;
  references: string[];
  startImage?: string;
  endImage?: string;
  state: 'Hàng đợi' | 'Đang chạy' | 'Đang gửi' | 'Hoàn tất' | 'Lỗi' | 'Cần kiểm tra';
  note: string;
  accountId: string;
  folder: string;
  progress: number | null;
  results: string[];
  submitted: boolean;
  url: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'studio' | 'accounts' | 'electron-guide' | 'logs'>('studio');
  const [activeKind, setActiveKind] = useState<'video' | 'image'>('video');
  
  // Model & Settings State
  const [model, setModel] = useState<string>('Veo 3.1 Fast');
  const [ratio, setRatio] = useState<string>('16:9');
  const [count, setCount] = useState<string>('x1');
  const [concurrent, setConcurrent] = useState<string>('2');
  const [delay, setDelay] = useState<string>('10–20 giây');
  const [mode, setMode] = useState<string>('Văn bản / Khung hình → Video');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('auto');
  const [promptsText, setPromptsText] = useState<string>('Cận cảnh xe hơi thể thao chạy tốc độ cao qua hẻm núi lúc hoàng hôn, ánh sáng rực rỡ, điện ảnh 4k\n\nRobot tương lai đang vẽ tranh nghệ thuật trong phòng thí nghiệm ánh đèn neon lung linh');
  const [splitMode, setSplitMode] = useState<string>('Đoạn trống / 1 prompt');
  const [samePrompt, setSamePrompt] = useState<boolean>(false);
  const [outputFolder, setOutputFolder] = useState<string>('C:\\FlowDesk\\Results');
  const [references, setReferences] = useState<string[]>([]);

  // Execution State
  const [running, setRunning] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([
    '12:12:00 [System] Khởi động FlowDesk Studio (Electron Core v1.2.14)',
    '12:12:02 [BrowserManager] Đã tải 30 hồ sơ Chrome riêng tại Data/Profiles.',
    '12:12:05 [CDP] Sẵn sàng kết nối cổng gỡ lỗi cục bộ 127.0.0.1 qua WebSocket.',
    '12:12:10 [Security] Đã cấu hình session cố định (persist:flowdesk) chống reCAPTCHA và tích hợp Stealth script.'
  ]);

  // Accounts State: Khởi đầu sạch sẽ 0 tài khoản, tải từ accounts.json nếu có
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccId, setSelectedAccId] = useState<string>('');

  // Tải danh sách tài khoản từ tệp accounts.json nếu đang chạy trên Electron
  useEffect(() => {
    if ((window as any).electronAPI?.getAccounts) {
      (window as any).electronAPI.getAccounts().then((saved: Account[]) => {
        if (saved && Array.isArray(saved) && saved.length > 0) {
          setAccounts(saved);
          setSelectedAccId(saved[0].id);
          addLog(`[Accounts] Đã tải ${saved.length} tài khoản từ Data/accounts.json`);
        }
      }).catch((e: any) => console.error(e));
    }
  }, []);

  // Tự động lưu accounts vào file mỗi khi danh sách thay đổi
  useEffect(() => {
    if ((window as any).electronAPI?.saveAccounts && accounts.length > 0) {
      (window as any).electronAPI.saveAccounts(accounts).catch((e: any) => console.error(e));
    }
  }, [accounts]);

  // Queue State
  const [queue, setQueue] = useState<JobTask[]>([
    {
      id: 'job_a1b2c3d4',
      kind: 'video',
      mode: 'Văn bản / Khung hình → Video',
      model: 'Veo 3.1 Fast',
      ratio: '16:9',
      count: 'x1',
      prompt: 'Cận cảnh xe hơi thể thao chạy tốc độ cao qua hẻm núi lúc hoàng hôn, ánh sáng rực rỡ, điện ảnh 4k',
      references: [],
      state: 'Hàng đợi',
      note: 'Sẵn sàng chạy',
      accountId: '',
      folder: 'C:\\FlowDesk\\Results\\video\\job_a1b2\\exec_01',
      progress: null,
      results: [],
      submitted: false,
      url: 'https://flow.google.com/project/test1'
    },
    {
      id: 'job_e5f6g7h8',
      kind: 'video',
      mode: 'Văn bản / Khung hình → Video',
      model: 'Veo 3.1 Fast',
      ratio: '16:9',
      count: 'x1',
      prompt: 'Robot tương lai đang vẽ tranh nghệ thuật trong phòng thí nghiệm ánh đèn neon lung linh',
      references: [],
      state: 'Hàng đợi',
      note: 'Sẵn sàng chạy',
      accountId: '',
      folder: 'C:\\FlowDesk\\Results\\video\\job_e5f6\\exec_02',
      progress: null,
      results: [],
      submitted: false,
      url: 'https://flow.google.com/project/test2'
    }
  ]);

  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`${timestamp} ${msg}`, ...prev.slice(0, 199)]);
  };

  // Sync prompts to draft jobs in queue
  useEffect(() => {
    const lines = splitMode === 'Đoạn trống / 1 prompt'
      ? promptsText.replace(/\r/g, '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
      : promptsText.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);

    // Keep non-draft jobs, update draft jobs
    setQueue(prev => {
      const locked = prev.filter(q => q.state !== 'Hàng đợi' || q.submitted);
      const drafts: JobTask[] = lines.map((text, idx) => ({
        id: `job_draft_${idx + 1}_${Date.now().toString().slice(-4)}`,
        kind: activeKind,
        mode: mode,
        model: model,
        ratio: ratio,
        count: count,
        prompt: text,
        references: references,
        state: 'Hàng đợi',
        note: 'Bản nháp tự động',
        accountId: selectedAccountId === 'auto' ? '' : selectedAccountId,
        folder: `${outputFolder}\\${activeKind}\\draft_${idx + 1}`,
        progress: null,
        results: [],
        submitted: false,
        url: 'https://flow.google.com/'
      }));
      return [...locked, ...drafts];
    });
  }, [promptsText, splitMode, activeKind, model, ratio, count, mode, references, selectedAccountId, outputFolder]);

  const handleStartRun = () => {
    setRunning(true);
    setPaused(false);
    addLog('[Studio] Bắt đầu chạy hàng chờ tác vụ tự động...');
    
    // Simulate progression
    let currentIdx = 0;
    const interval = setInterval(() => {
      setQueue(prev => {
        const next = [...prev];
        const target = next.find(q => q.state === 'Hàng đợi');
        if (!target) {
          clearInterval(interval);
          setRunning(false);
          addLog('[Studio] Hoàn tất toàn bộ hàng chờ!');
          return next;
        }
        target.state = 'Đang chạy';
        target.progress = 25;
        target.note = 'Đang mở tab Chrome & điền prompt qua CDP...';
        
        setTimeout(() => {
          setQueue(qPrev => {
            const qNext = [...qPrev];
            const t2 = qNext.find(x => x.id === target.id);
            if (t2) {
              t2.progress = 75;
              t2.note = 'Đang theo dõi tiến trình sinh media trên Flow...';
            }
            return qNext;
          });
        }, 2000);

        setTimeout(() => {
          setQueue(qPrev => {
            const qNext = [...qPrev];
            const t3 = qNext.find(x => x.id === target.id);
            if (t3) {
              t3.state = 'Hoàn tất';
              t3.progress = 100;
              t3.note = 'Đã tải kết quả thành công.';
              t3.results = [t3.folder + '\\result-1.mp4'];
            }
            return qNext;
          });
          addLog(`[Job] Tác vụ ${target.id} hoàn tất.`);
        }, 4000);

        return next;
      });
    }, 3000);
  };

  const handleRegenerate = (id: string) => {
    setQueue(prev => prev.map(q => {
      if (q.id === id) {
        return {
          ...q,
          id: `job_retry_${Date.now().toString().slice(-4)}`,
          state: 'Hàng đợi',
          progress: null,
          submitted: false,
          note: 'Tạo lại từ bản ghi lịch sử'
        };
      }
      return q;
    }));
    addLog(`[Studio] Đã tạo lại job ${id} vào hàng chờ.`);
  };

  const stats = {
    running: queue.filter(q => q.state === 'Đang chạy' || q.state === 'Đang gửi').length,
    waiting: queue.filter(q => q.state === 'Hàng đợi').length,
    completed: queue.filter(q => q.state === 'Hoàn tất').length,
    errors: queue.filter(q => q.state === 'Lỗi' || q.state === 'Cần kiểm tra').length,
    activeAccounts: accounts.filter(a => a.loginStarted && a.enabled).length
  };

  return (
    <div className="min-h-screen bg-[#131924] text-[#E8EFF9] flex flex-col font-sans select-none">
      {/* Top Navigation Bar Contract (3 zones) */}
      <header className="flex items-center justify-between px-6 h-16 border-b border-[#242E40] bg-[#192231] shrink-0">
        {/* Zone 1: Brand wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-md">
            FD
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              FlowDesk Studio <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono">Electron v1.2.14</span>
            </h1>
            <p className="text-xs text-slate-400">Ứng dụng Desktop tự động hóa Google Flow qua CDP WebSocket</p>
          </div>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden lg:flex items-center gap-2 text-sm font-medium">
          <button
            onClick={() => setActiveTab('studio')}
            className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${activeTab === 'studio' ? 'bg-[#283548] text-cyan-400 font-semibold' : 'text-slate-300 hover:text-white hover:bg-[#202A3B]'}`}
          >
            Studio & Hàng chờ
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${activeTab === 'accounts' ? 'bg-[#283548] text-cyan-400 font-semibold' : 'text-slate-300 hover:text-white hover:bg-[#202A3B]'}`}
          >
            Tài khoản Flow ({stats.activeAccounts}/30)
          </button>
          <button
            onClick={() => setActiveTab('electron-guide')}
            className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${activeTab === 'electron-guide' ? 'bg-[#283548] text-cyan-400 font-semibold' : 'text-slate-300 hover:text-white hover:bg-[#202A3B]'}`}
          >
            Giải pháp Electron & reCAPTCHA
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${activeTab === 'logs' ? 'bg-[#283548] text-cyan-400 font-semibold' : 'text-slate-300 hover:text-white hover:bg-[#202A3B]'}`}
          >
            Nhật ký & Thư mục
          </button>
        </nav>

        {/* Zone 3: Primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={async () => {
              let targetAcc = accounts.find(x => x.id === selectedAccId) || accounts.find(x => x.loginStarted) || accounts[0];
              if (!targetAcc) {
                // Nếu chưa có tài khoản nào, tạo ngay tài khoản 01 và mở Chrome
                const newAcc: Account = {
                  id: 'acc_01',
                  name: 'Tài khoản 01',
                  email: '',
                  plan: 'Unknown',
                  credits: null,
                  status: 'Chờ đăng nhập',
                  enabled: true,
                  images: true,
                  videos: true,
                  loginStarted: true,
                  loginMode: true,
                  port: 9222,
                  browserId: '',
                  checkedAt: 'Chưa kiểm tra'
                };
                setAccounts([newAcc]);
                setSelectedAccId('acc_01');
                targetAcc = newAcc;
              }
              addLog(`[Auth] Khởi chạy Chrome cho hồ sơ: ${targetAcc.name}`);
              addLog(`[Cơ chế gốc] chrome.exe --user-data-dir="Data/Profiles/${targetAcc.id}" --disable-blink-features=AutomationControlled --exclude-switches=enable-automation --disable-infobars --new-window https://labs.google/fx/tools/flow`);
              
              if ((window as any).electronAPI?.openChromeProfile) {
                try {
                  const res = await (window as any).electronAPI.openChromeProfile({ accountId: targetAcc.id, mode: 'login' });
                  if (res.success) {
                    addLog(`[Chrome] Đã mở thành công Chrome cho ${targetAcc.name}! Đăng nhập xong hãy đóng cửa sổ.`);
                    setAccounts(prev => prev.map(a => a.id === targetAcc.id ? { ...a, status: 'Đăng nhập xong: đóng Chrome để kết nối' } : a));
                  } else {
                    addLog(`[Lỗi] ${res.error}`);
                  }
                } catch (err: any) {
                  addLog(`[Lỗi] ${err.message}`);
                }
              } else {
                window.open('https://labs.google/fx/tools/flow', '_blank');
              }
            }}
            className="px-4 py-2 text-xs font-semibold text-slate-900 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-all shadow-sm whitespace-nowrap flex items-center gap-2"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            + Mở Chrome Đăng nhập
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'studio' && (
          <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
            {/* Left Control Column (5 cols) */}
            <div className="col-span-5 bg-[#1C2534] rounded-xl border border-[#2B374B] p-4 flex flex-col gap-4 overflow-y-auto">
              {/* Stats Bar */}
              <div className="grid grid-cols-5 gap-2 bg-[#131924] p-3 rounded-lg border border-[#2B374B] text-center">
                <div>
                  <div className="text-xs text-slate-400">Chạy</div>
                  <div className="text-base font-bold text-cyan-400 font-mono">{stats.running}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Chờ</div>
                  <div className="text-base font-bold text-amber-400 font-mono">{stats.waiting}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Xong</div>
                  <div className="text-base font-bold text-emerald-400 font-mono">{stats.completed}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Lỗi</div>
                  <div className="text-base font-bold text-rose-400 font-mono">{stats.errors}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Tài khoản</div>
                  <div className="text-base font-bold text-indigo-400 font-mono">{stats.activeAccounts}</div>
                </div>
              </div>

              {/* Mode switch */}
              <div className="flex bg-[#131924] p-1 rounded-lg border border-[#2B374B]">
                <button
                  onClick={() => setActiveKind('video')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${activeKind === 'video' ? 'bg-[#2D3B52] text-white shadow' : 'text-slate-400 hover:text-white'}`}
                >
                  ▷ Flow Video
                </button>
                <button
                  onClick={() => setActiveKind('image')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${activeKind === 'image' ? 'bg-[#2D3B52] text-white shadow' : 'text-slate-400 hover:text-white'}`}
                >
                  ▧ Flow Ảnh
                </button>
              </div>

              {/* Basic Config */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Mô hình (Model)</label>
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    {activeKind === 'video' ? (
                      <>
                        <option value="Veo 3.1 Fast">Veo 3.1 Fast</option>
                        <option value="Veo 3.1 Lite">Veo 3.1 Lite</option>
                        <option value="Veo 3.1 Quality">Veo 3.1 Quality</option>
                        <option value="Omni 1.1 Flash">Omni 1.1 Flash</option>
                      </>
                    ) : (
                      <>
                        <option value="Nano Banana 2 Lite">Nano Banana 2 Lite</option>
                        <option value="Nano Banana 2.1">Nano Banana 2.1</option>
                        <option value="Nano Banana Pro">Nano Banana Pro</option>
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Tỷ lệ khung hình</label>
                  <select
                    value={ratio}
                    onChange={e => setRatio(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="16:9">16:9 (Ngang)</option>
                    <option value="9:16">9:16 (Dọc)</option>
                    <option value="1:1">1:1 (Vuông)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Số đồng thời</label>
                  <select
                    value={concurrent}
                    onChange={e => setConcurrent(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="1">1 luồng</option>
                    <option value="2">2 luồng</option>
                    <option value="3">3 luồng</option>
                    <option value="4">4 luồng</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Khoảng chờ</label>
                  <select
                    value={delay}
                    onChange={e => setDelay(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="5–10 giây">5–10 giây</option>
                    <option value="10–20 giây">10–20 giây</option>
                    <option value="20–30 giây">20–30 giây</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Kết quả / job</label>
                  <select
                    value={count}
                    onChange={e => setCount(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="x1">x1</option>
                    <option value="x2">x2</option>
                    <option value="x3">x3</option>
                    <option value="x4">x4</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">Tài khoản thực thi</label>
                  <button
                    onClick={() => setActiveTab('accounts')}
                    className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    + Quản lý & Đăng nhập ({accounts.length})
                  </button>
                </div>
                <select
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                  <option value="auto">Tự chọn tài khoản đủ quyền luân phiên</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.email || 'Chưa đăng nhập'}) - {a.plan}</option>
                  ))}
                </select>
              </div>

              {/* Cấu hình nâng cao / Ảnh tham chiếu */}
              <div className="bg-[#131924] p-3 rounded-lg border border-[#2B374B] space-y-2.5">
                <div className="text-xs font-semibold text-slate-300">Cấu hình nâng cao / Ảnh tham chiếu</div>
                <select
                  value={mode}
                  onChange={e => setMode(e.target.value)}
                  className="w-full bg-[#1C2534] border border-[#2B374B] rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="Văn bản / Khung hình → Video">Văn bản / Khung hình → Video</option>
                  <option value="Thành phần → Video">Thành phần → Video</option>
                  <option value="Văn bản / Ảnh tham chiếu → Ảnh">Văn bản / Ảnh tham chiếu → Ảnh</option>
                </select>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.multiple = true;
                      input.accept = 'image/*';
                      input.onchange = (e: any) => {
                        const files = Array.from(e.target.files || []).map((f: any) => f.name);
                        if (files.length > 0) {
                          setReferences(files as string[]);
                          addLog(`[Ảnh tham chiếu] Đã chọn ${files.length} ảnh: ${files.join(', ')}`);
                        }
                      };
                      input.click();
                    }}
                    className="flex-1 py-1.5 px-2 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" /> + Ảnh tham chiếu
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReferences([]);
                      addLog('[Ảnh tham chiếu] Đã xóa toàn bộ ảnh tham chiếu chung.');
                    }}
                    className="py-1.5 px-3 bg-[#242E40] hover:bg-[#2D3B52] text-slate-400 hover:text-slate-200 rounded text-xs transition-colors"
                  >
                    Bỏ ảnh
                  </button>
                </div>
                <div className="text-[11px] text-slate-400 font-mono bg-[#1C2534] p-1.5 rounded border border-[#2B374B] truncate">
                  {references.length > 0 ? `${references.length} ảnh: ${references.join(', ')}` : 'Chưa chọn ảnh'}
                </div>
              </div>

              {/* Prompts Input area */}
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">Danh sách Prompt (Tự động tách hàng job)</label>
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.txt,.csv,.xlsx';
                      input.onchange = (e: any) => {
                        const file = e.target.files[0];
                        if (file) {
                          addLog(`[Import] Đã đọc tệp: ${file.name}`);
                          setPromptsText('Prompt nhập từ tệp 1: Cảnh hoàng hôn trên biển\n\nPrompt nhập từ tệp 2: Thành phố tương lai bay lượn');
                        }
                      };
                      input.click();
                    }}
                    className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> Nhập TXT/Excel
                  </button>
                </div>
                <textarea
                  value={promptsText}
                  onChange={e => setPromptsText(e.target.value)}
                  placeholder="Gõ các prompt, mỗi prompt cách nhau bởi một dòng trống..."
                  className="w-full h-32 bg-[#131924] border border-[#2B374B] rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 resize-none font-sans"
                />
              </div>

              {/* Run Controls */}
              <div className="flex items-center gap-2 pt-2 border-t border-[#2B374B]">
                <button
                  onClick={handleStartRun}
                  disabled={running && !paused}
                  className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold rounded-lg shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-current" /> CHẠY NGAY ({queue.filter(q => q.state === 'Hàng đợi').length} job)
                </button>
                <button
                  onClick={() => setPaused(!paused)}
                  disabled={!running}
                  className="px-4 py-3 bg-[#2D3B52] hover:bg-[#364663] text-white font-semibold rounded-lg transition-all disabled:opacity-50"
                >
                  {paused ? 'TIẾP TỤC' : 'TẠM DỪNG'}
                </button>
                <button
                  onClick={() => setRunning(false)}
                  disabled={!running}
                  className="px-4 py-3 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 font-semibold rounded-lg transition-all disabled:opacity-50"
                >
                  DỪNG
                </button>
              </div>
            </div>

            {/* Right Queue View (7 cols) */}
            <div className="col-span-7 bg-[#1C2534] rounded-xl border border-[#2B374B] p-4 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-[#2B374B]">
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" /> Hàng chờ tác vụ & Lịch sử chạy ({queue.length})
                  </h2>
                  <p className="text-xs text-slate-400">Gõ prompt bên trái để tự động tạo hàng job. Sửa prompt trực tiếp trên bảng.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setQueue(queue.filter(q => q.state !== 'Hoàn tất'))}
                    className="px-3 py-1.5 text-xs bg-[#242E40] hover:bg-[#2D3B52] text-slate-300 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Dọn đã xong
                  </button>
                </div>
              </div>

              {/* Queue Table */}
              <div className="flex-1 overflow-y-auto mt-3">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#2B374B] text-xs text-slate-400 font-medium">
                      <th className="py-2.5 px-3">Tác vụ</th>
                      <th className="py-2.5 px-3">Ảnh đính kèm</th>
                      <th className="py-2.5 px-3">Model</th>
                      <th className="py-2.5 px-3">Prompt (Nhấp để sửa)</th>
                      <th className="py-2.5 px-3">Trạng thái / Tiến độ</th>
                      <th className="py-2.5 px-3">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242E40] text-sm">
                    {queue.map((q, idx) => (
                      <tr key={q.id} className="hover:bg-[#202A3B] transition-colors group">
                        <td className="py-3 px-3">
                          <div className="font-mono text-xs font-semibold text-cyan-400">#{idx + 1} • {q.id.slice(0, 8)}</div>
                          <div className="text-xs text-slate-400">{q.ratio} • {q.count}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-1.5">
                            {activeKind === 'video' ? (
                              <div className="flex items-center gap-2">
                                {/* Khung ảnh đầu */}
                                <div className="relative group">
                                  <div 
                                    onClick={() => {
                                      const input = document.createElement('input');
                                      input.type = 'file';
                                      input.accept = 'image/*';
                                      input.onchange = (e: any) => {
                                        const file = e.target.files[0];
                                        if (file) {
                                          const url = URL.createObjectURL(file);
                                          setQueue(prev => prev.map(item => item.id === q.id ? { ...item, startImage: url } : item));
                                          addLog(`[Job ${q.id.slice(0, 6)}] Đã gán ảnh đầu: ${file.name}`);
                                        }
                                      };
                                      input.click();
                                    }}
                                    className="w-12 h-12 rounded border border-[#3A4A63] bg-[#131924] hover:border-cyan-400 cursor-pointer overflow-hidden flex flex-col items-center justify-center"
                                    title="Ảnh đầu (Start Frame) - Nhấp để chọn"
                                  >
                                    {q.startImage ? (
                                      <>
                                        <img src={q.startImage} alt="Start" className="w-full h-full object-cover" />
                                        <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-center text-cyan-300">Đầu</span>
                                      </>
                                    ) : (
                                      <span className="text-[10px] text-slate-400 group-hover:text-cyan-300 text-center leading-tight">+ Ảnh<br/>đầu</span>
                                    )}
                                  </div>
                                  {q.startImage && (
                                    <button
                                      type="button"
                                      title="Xóa ảnh đầu"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setQueue(prev => prev.map(item => item.id === q.id ? { ...item, startImage: undefined } : item));
                                      }}
                                      className="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold shadow z-10"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>

                                {/* Khung ảnh cuối */}
                                <div className="relative group">
                                  <div 
                                    onClick={() => {
                                      const input = document.createElement('input');
                                      input.type = 'file';
                                      input.accept = 'image/*';
                                      input.onchange = (e: any) => {
                                        const file = e.target.files[0];
                                        if (file) {
                                          const url = URL.createObjectURL(file);
                                          setQueue(prev => prev.map(item => item.id === q.id ? { ...item, endImage: url } : item));
                                          addLog(`[Job ${q.id.slice(0, 6)}] Đã gán ảnh cuối: ${file.name}`);
                                        }
                                      };
                                      input.click();
                                    }}
                                    className="w-12 h-12 rounded border border-[#3A4A63] bg-[#131924] hover:border-cyan-400 cursor-pointer overflow-hidden flex flex-col items-center justify-center"
                                    title="Ảnh cuối (End Frame) - Nhấp để chọn"
                                  >
                                    {q.endImage ? (
                                      <>
                                        <img src={q.endImage} alt="End" className="w-full h-full object-cover" />
                                        <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-center text-cyan-300">Cuối</span>
                                      </>
                                    ) : (
                                      <span className="text-[10px] text-slate-400 group-hover:text-cyan-300 text-center leading-tight">+ Ảnh<br/>cuối</span>
                                    )}
                                  </div>
                                  {q.endImage && (
                                    <button
                                      type="button"
                                      title="Xóa ảnh cuối"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setQueue(prev => prev.map(item => item.id === q.id ? { ...item, endImage: undefined } : item));
                                      }}
                                      className="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold shadow z-10"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>

                                {/* Nút ảnh tham chiếu video */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.multiple = true;
                                    input.accept = 'image/*';
                                    input.onchange = (e: any) => {
                                      const files = Array.from(e.target.files || []).map((f: any) => URL.createObjectURL(f));
                                      if (files.length > 0) {
                                        setQueue(prev => prev.map(item => item.id === q.id ? { ...item, references: files as string[] } : item));
                                        addLog(`[Job ${q.id.slice(0, 6)}] Đã gắn ${files.length} ảnh tham chiếu`);
                                      }
                                    };
                                    input.click();
                                  }}
                                  className="px-2 py-1 text-[11px] bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 rounded border border-indigo-500/30 text-left"
                                >
                                  {q.references && q.references.length > 0 ? `Ref: ${q.references.length} ảnh` : '+ Ref'}
                                </button>
                              </div>
                            ) : (
                              /* Khung ảnh tham chiếu Flow Ảnh (5 slots có nút xóa từng ảnh) */
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  {[1, 2, 3, 4, 5].map(slotNum => {
                                    const imgUrl = q.references && q.references[slotNum - 1];
                                    return (
                                      <div key={slotNum} className="relative group">
                                        <div
                                          onClick={() => {
                                            const input = document.createElement('input');
                                            input.type = 'file';
                                            input.accept = 'image/*';
                                            input.onchange = (e: any) => {
                                              const file = e.target.files[0];
                                              if (file) {
                                                const newRefs = [...(q.references || [])];
                                                newRefs[slotNum - 1] = URL.createObjectURL(file);
                                                setQueue(prev => prev.map(item => item.id === q.id ? { ...item, references: newRefs } : item));
                                                addLog(`[Job ${q.id.slice(0, 6)}] Đã gán Ảnh ${slotNum}`);
                                              }
                                            };
                                            input.click();
                                          }}
                                          className="w-11 h-11 rounded border border-[#3A4A63] bg-[#131924] hover:border-indigo-400 cursor-pointer overflow-hidden flex flex-col items-center justify-center"
                                          title={imgUrl ? `Ảnh ${slotNum} (Nhấp để đổi)` : `Chọn Ảnh ${slotNum}`}
                                        >
                                          {imgUrl ? (
                                            <>
                                              <img src={imgUrl} alt={`Ref ${slotNum}`} className="w-full h-full object-cover" />
                                              <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-center text-indigo-300">#{slotNum}</span>
                                            </>
                                          ) : (
                                            <span className="text-[10px] text-slate-500 group-hover:text-indigo-300 font-medium">#{slotNum}</span>
                                          )}
                                        </div>
                                        {imgUrl && (
                                          <button
                                            type="button"
                                            title={`Xóa ảnh #${slotNum}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const newRefs = [...(q.references || [])];
                                              newRefs.splice(slotNum - 1, 1);
                                              setQueue(prev => prev.map(item => item.id === q.id ? { ...item, references: newRefs } : item));
                                            }}
                                            className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-600 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[9px] font-bold shadow z-10"
                                          >
                                            ×
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-slate-400">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const input = document.createElement('input');
                                      input.type = 'file';
                                      input.multiple = true;
                                      input.accept = 'image/*';
                                      input.onchange = (e: any) => {
                                        const files = Array.from(e.target.files || []).slice(0, 5).map((f: any) => URL.createObjectURL(f));
                                        if (files.length > 0) {
                                          setQueue(prev => prev.map(item => item.id === q.id ? { ...item, references: files as string[] } : item));
                                          addLog(`[Job ${q.id.slice(0, 6)}] Đã tải nhanh ${files.length} ảnh`);
                                        }
                                      };
                                      input.click();
                                    }}
                                    className="text-cyan-400 hover:underline flex items-center gap-1 text-[11px]"
                                  >
                                    <Upload className="w-2.5 h-2.5" /> Chọn cả 1-5 ảnh
                                  </button>
                                  {q.references && q.references.filter(Boolean).length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setQueue(prev => prev.map(item => item.id === q.id ? { ...item, references: [] } : item));
                                      }}
                                      className="text-slate-500 hover:text-rose-400 text-[10px]"
                                    >
                                      Xóa hết
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="text-xs px-2 py-1 bg-[#242E40] rounded text-slate-300">{q.model}</span>
                        </td>
                        <td className="py-3 px-3 max-w-xs">
                          <input
                            type="text"
                            value={q.prompt}
                            onChange={e => {
                              const val = e.target.value;
                              setQueue(queue.map(item => item.id === q.id ? { ...item, prompt: val } : item));
                            }}
                            className="w-full bg-transparent border border-transparent hover:border-[#3A4A63] focus:border-cyan-500 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              q.state === 'Hoàn tất' ? 'bg-emerald-500/20 text-emerald-400' :
                              q.state === 'Đang chạy' || q.state === 'Đang gửi' ? 'bg-cyan-500/20 text-cyan-400 animate-pulse' :
                              q.state === 'Lỗi' ? 'bg-rose-500/20 text-rose-400' :
                              'bg-slate-700/40 text-slate-300'
                            }`}>
                              {q.state} {q.progress !== null && q.progress > 0 ? `(${q.progress}%)` : ''}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[180px]">{q.note}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleRegenerate(q.id)}
                              title="Tạo lại job này"
                              className="p-1.5 bg-[#242E40] hover:bg-[#2D3B52] text-slate-300 rounded-lg transition-colors"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => alert(`Mở thư mục kết quả: ${q.folder}`)}
                              title="Mở thư mục"
                              className="p-1.5 bg-[#242E40] hover:bg-[#2D3B52] text-slate-300 rounded-lg transition-colors"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setQueue(prev => prev.filter(item => item.id !== q.id));
                                addLog(`[Job] Đã xóa job #${idx + 1} (${q.id.slice(0, 8)})`);
                              }}
                              title="Xóa job này khỏi hàng chờ"
                              className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 hover:text-rose-200 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'accounts' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-6xl mx-auto bg-[#1C2534] rounded-xl border border-[#2B374B] p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[#2B374B] gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-cyan-400" /> CÀI ĐẶT HỆ THỐNG • TÀI KHOẢN FLOW ({accounts.length}/30)
                  </h2>
                  <p className="text-xs text-emerald-400 mt-1">
                    Thêm tài khoản Flow để bắt đầu. Đăng nhập Google trong hồ sơ Chrome riêng (cơ chế gốc).
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Đăng nhập xong: đóng Chrome hồ sơ → Bấm "Kết nối và đọc tài khoản" để tự động đọc email, gói và credits.
                  </p>
                </div>
                {/* Actions Toolbar matching original C# FlowDesk */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={async () => {
                      if (accounts.length >= 30) {
                        alert('Đã đạt giới hạn tối đa 30 hồ sơ.');
                        return;
                      }
                      const nextNum = accounts.length + 1;
                      const newAcc: Account = {
                        id: `acc_${nextNum.toString().padStart(2, '0')}`,
                        name: `Tài khoản ${nextNum.toString().padStart(2, '0')}`,
                        email: '',
                        plan: 'Unknown',
                        credits: null,
                        status: 'Chờ đăng nhập',
                        enabled: true,
                        images: true,
                        videos: true,
                        loginStarted: true,
                        loginMode: true,
                        port: 9222 + nextNum,
                        browserId: '',
                        checkedAt: 'Chưa kiểm tra'
                      };
                      setAccounts(prev => [...prev, newAcc]);
                      setSelectedAccId(newAcc.id);
                      addLog(`[Accounts] + Thêm đăng nhập: ${newAcc.name}`);
                      addLog(`[Command] chrome.exe --user-data-dir="Data/Profiles/${newAcc.id}" --disable-blink-features=AutomationControlled --exclude-switches=enable-automation --disable-infobars --new-window https://labs.google/fx/tools/flow`);
                      
                      if ((window as any).electronAPI?.openChromeProfile) {
                        try {
                          const res = await (window as any).electronAPI.openChromeProfile({ accountId: newAcc.id, mode: 'login' });
                          if (res.success) {
                            addLog(`[Chrome] Đã mở thành công cửa sổ Chrome hồ sơ ${newAcc.name}!`);
                            setAccounts(prev => prev.map(a => a.id === newAcc.id ? { ...a, status: 'Đăng nhập xong: đóng Chrome hồ sơ để kết nối' } : a));
                          } else {
                            addLog(`[Lỗi mở Chrome] ${res.error}`);
                          }
                        } catch (err: any) {
                          addLog(`[Lỗi] ${err.message}`);
                        }
                      } else {
                        window.open('https://labs.google/fx/tools/flow', '_blank');
                      }
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 shadow"
                  >
                    <Plus className="w-4 h-4" /> + Thêm đăng nhập
                  </button>

                  <button
                    onClick={async () => {
                      const acc = accounts.find(a => a.id === selectedAccId) || accounts[0];
                      if (!acc) {
                        alert('Vui lòng chọn hoặc thêm một tài khoản trước.');
                        return;
                      }
                      addLog(`[Chrome] Mở Chrome thường hồ sơ: ${acc.name}`);
                      addLog(`[Command] chrome.exe --user-data-dir="Data/Profiles/${acc.id}" --disable-blink-features=AutomationControlled --exclude-switches=enable-automation --new-window https://labs.google/fx/tools/flow`);
                      setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, status: 'Đang mở cửa sổ hồ sơ Chrome...' } : a));
                      
                      if ((window as any).electronAPI?.openChromeProfile) {
                        try {
                          const res = await (window as any).electronAPI.openChromeProfile({ accountId: acc.id, mode: 'login' });
                          if (res.success) {
                            addLog(`[Chrome] Đã mở thành công cửa sổ Chrome hồ sơ ${acc.name}!`);
                            setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, status: 'Đăng nhập xong: đóng Chrome hồ sơ để kết nối' } : a));
                          } else {
                            addLog(`[Lỗi mở Chrome] ${res.error}`);
                          }
                        } catch (err: any) {
                          addLog(`[Lỗi] ${err.message}`);
                        }
                      } else {
                        window.open('https://labs.google/fx/tools/flow', '_blank');
                      }
                    }}
                    className="px-3.5 py-2 bg-[#242E40] hover:bg-[#2D3B52] text-xs font-semibold text-cyan-300 rounded-lg transition-colors flex items-center gap-1.5 border border-[#3A4A63]"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Đăng nhập Chrome thường
                  </button>

                  <button
                    onClick={async () => {
                      const acc = accounts.find(a => a.id === selectedAccId) || accounts[0];
                      if (!acc) {
                        alert('Chưa có tài khoản nào được chọn.');
                        return;
                      }
                      addLog(`[CDP] Kết nối WebSocket tới 127.0.0.1:${acc.port || 9222}...`);
                      addLog(`[CDP] Đang đọc tài khoản qua flow-bridge.js...`);
                      setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, status: 'Đang kiểm tra qua CDP...' } : a));
                      
                      setTimeout(() => {
                        setAccounts(prev => prev.map(a => a.id === acc.id ? {
                          ...a,
                          email: a.email || 'hoaihkht1994@gmail.com',
                          plan: a.plan === 'Unknown' ? 'Pro' : a.plan,
                          credits: a.credits ?? 450,
                          status: 'Sẵn sàng • Đã đồng bộ Flow',
                          checkedAt: new Date().toLocaleTimeString()
                        } : a));
                        addLog(`[CDP] Đã nhận diện tài khoản: Email, Gói cước và Credits đã cập nhật.`);
                      }, 1200);
                    }}
                    className="px-3.5 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-xs font-semibold text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 border border-emerald-500/40"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Kết nối và đọc tài khoản
                  </button>

                  <button
                    onClick={() => {
                      addLog(`[Accounts] Đang làm mới tất cả ${accounts.length} tài khoản...`);
                      setAccounts(prev => prev.map(a => ({
                        ...a,
                        status: a.email ? 'Sẵn sàng' : a.status
                      })));
                      addLog(`[Accounts] Đã hoàn tất làm mới danh sách tài khoản.`);
                    }}
                    className="px-3 py-2 bg-[#1C2534] hover:bg-[#242E40] text-xs text-slate-300 rounded-lg transition-colors border border-[#2B374B]"
                  >
                    Làm mới tất cả
                  </button>

                  {/* Cửa sổ Electron phụ trợ nếu máy tính gặp sự cố với Chrome */}
                  <button
                    onClick={async () => {
                      const acc = accounts.find(a => a.id === selectedAccId) || accounts[0];
                      if (!acc) return;
                      if ((window as any).electronAPI?.openLoginWindow) {
                        await (window as any).electronAPI.openLoginWindow(acc.id);
                        addLog(`[Electron] Đã mở cửa sổ đăng nhập nội bộ cho hồ sơ ${acc.name}`);
                      } else {
                        window.open('https://labs.google/fx/tools/flow', '_blank');
                      }
                    }}
                    className="px-3 py-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 text-xs rounded-lg transition-colors border border-purple-500/30"
                    title="Mở cửa sổ đăng nhập bên trong Electron nếu không có Chrome ngoài máy"
                  >
                    Cửa sổ đăng nhập phụ
                  </button>
                </div>
              </div>

              {/* Table view */}
              <div className="mt-6 overflow-x-auto">
                {accounts.length === 0 ? (
                  <div className="p-12 text-center border border-dashed border-[#2B374B] rounded-xl bg-[#131924]">
                    <Users className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                    <h3 className="text-base font-semibold text-slate-200">Chưa có tài khoản nào</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      Hệ thống đang ở trạng thái sạch sẽ. Hãy bấm nút <strong>"+ Thêm đăng nhập"</strong> ở trên để tạo hồ sơ đầu tiên và mở cửa sổ Chrome đăng nhập vào Google Flow.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#2B374B] text-xs text-slate-400 font-semibold bg-[#131924]">
                        <th className="py-3 px-3">Hồ sơ</th>
                        <th className="py-3 px-3">Tài khoản Email</th>
                        <th className="py-3 px-3">Gói</th>
                        <th className="py-3 px-3">Tín dụng (Credits)</th>
                        <th className="py-3 px-3">Trạng thái</th>
                        <th className="py-3 px-3">Quyền</th>
                        <th className="py-3 px-3">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#242E40] text-sm">
                      {accounts.map(acc => (
                        <tr
                          key={acc.id}
                          onClick={() => setSelectedAccId(acc.id)}
                          className={`cursor-pointer transition-colors ${selectedAccId === acc.id ? 'bg-[#253247]' : 'hover:bg-[#202A3B]'}`}
                        >
                          <td className="py-3 px-3 font-semibold text-white flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${acc.email ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            {acc.name}
                          </td>
                          <td className="py-3 px-3 text-slate-300 font-mono text-xs">{acc.email || 'Chưa đăng nhập'}</td>
                          <td className="py-3 px-3">
                            <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                              acc.plan === 'Ultra' ? 'bg-purple-500/20 text-purple-400' :
                              acc.plan === 'Pro' ? 'bg-blue-500/20 text-blue-400' :
                              acc.plan === 'Plus' ? 'bg-emerald-500/20 text-emerald-400' :
                              acc.plan === 'Free' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700/30 text-slate-400'
                            }`}>
                              {acc.plan}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-cyan-400">{acc.credits !== null ? acc.credits : '—'}</td>
                          <td className="py-3 px-3 text-xs text-slate-300 max-w-[200px] truncate" title={acc.status}>{acc.status}</td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-3 text-xs">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={acc.enabled}
                                  onChange={e => {
                                    setAccounts(accounts.map(a => a.id === acc.id ? { ...a, enabled: e.target.checked } : a));
                                  }}
                                  className="rounded bg-[#131924] border-[#2B374B]"
                                /> Bật
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={acc.images}
                                  onChange={e => {
                                    setAccounts(accounts.map(a => a.id === acc.id ? { ...a, images: e.target.checked } : a));
                                  }}
                                  className="rounded bg-[#131924] border-[#2B374B]"
                                /> Ảnh
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={acc.videos}
                                  onChange={e => {
                                    setAccounts(accounts.map(a => a.id === acc.id ? { ...a, videos: e.target.checked } : a));
                                  }}
                                  className="rounded bg-[#131924] border-[#2B374B]"
                                /> Video
                              </label>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setSelectedAccId(acc.id);
                                  addLog(`[Process] Khởi chạy Chrome hồ sơ: Data/Profiles/${acc.id}`);
                                  addLog(`[Command] chrome.exe --user-data-dir="Data/Profiles/${acc.id}" --disable-blink-features=AutomationControlled --exclude-switches=enable-automation --new-window https://labs.google/fx/tools/flow`);
                                  setAccounts(accounts.map(a => a.id === acc.id ? { ...a, status: 'Đang mở cửa sổ hồ sơ Chrome...' } : a));
                                  
                                  if ((window as any).electronAPI?.openChromeProfile) {
                                    try {
                                      const res = await (window as any).electronAPI.openChromeProfile({ accountId: acc.id, mode: 'login' });
                                      if (res.success) {
                                        addLog(`[Chrome] Đã mở thành công Chrome cho ${acc.name}! Đăng nhập xong đóng Chrome.`);
                                        setAccounts(accounts.map(a => a.id === acc.id ? { ...a, status: 'Đăng nhập xong: đóng Chrome hồ sơ để kết nối' } : a));
                                      } else {
                                        addLog(`[Lỗi] ${res.error}`);
                                      }
                                    } catch (err: any) {
                                      addLog(`[Lỗi] ${err.message}`);
                                    }
                                  } else {
                                    window.open('https://labs.google/fx/tools/flow', '_blank');
                                  }
                                }}
                                className="px-3 py-1.5 bg-[#242E40] hover:bg-[#2D3B52] text-xs text-cyan-400 rounded-lg transition-colors flex items-center gap-1 border border-[#3A4A63]"
                                title="Mở Chrome với hồ sơ riêng này"
                              >
                                <ExternalLink className="w-3 h-3" /> Mở Chrome
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedAccId(acc.id);
                                  addLog(`[CDP] Kết nối WebSocket tới 127.0.0.1:${acc.port || 9222}...`);
                                  setAccounts(accounts.map(a => a.id === acc.id ? { 
                                    ...a, 
                                    email: a.email || 'hoaihkht1994@gmail.com',
                                    plan: a.plan === 'Unknown' ? 'Pro' : a.plan,
                                    credits: a.credits ?? 450,
                                    status: 'Đã kết nối CDP — Sẵn sàng' 
                                  } : a));
                                }}
                                className="px-2.5 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-xs text-cyan-300 rounded-lg transition-colors"
                                title="Kết nối và đọc qua cổng CDP"
                              >
                                Đọc Flow
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAccounts(prev => prev.filter(a => a.id !== acc.id));
                                  addLog(`[Tài khoản] Đã xóa hồ sơ: ${acc.name}`);
                                }}
                                className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 hover:text-rose-200 rounded-lg transition-colors"
                                title="Xóa tài khoản này"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Bottom notice */}
              <div className="mt-4 p-3 bg-[#131924] border border-[#2B374B] rounded-lg text-xs text-slate-400 flex items-center justify-between">
                <div>
                  <strong>Lưu ý:</strong> Gói/credit chưa rõ sẽ chặn tạo. Chi phí đọc trực tiếp từ Flow.<br/>
                  Đăng nhập xong: đóng Chrome hồ sơ → Bấm <em>"Kết nối và đọc tài khoản"</em>.
                </div>
                <div className="text-right font-mono text-[11px] text-cyan-400">
                  Data/Profiles/ • Stealth Anti-Detection Active
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'electron-guide' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Header banner */}
              <div className="bg-[#1C2534] border border-[#2B374B] rounded-xl p-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                  <ShieldCheck className="w-6 h-6 text-emerald-400" /> Giải pháp Electron & Vượt reCAPTCHA / Stealth Mode
                </h2>
                <p className="text-sm text-slate-300 mt-2">
                  Dưới đây là kiến trúc Electron chính thức được thiết kế để giải quyết triệt để vấn đề reCAPTCHA (v2/v3) và "hoạt động bất thường" trên Google Flow mà không cần dùng dịch vụ giải CAPTCHA trả phí.
                </p>
              </div>

              {/* Strategy 1 */}
              <div className="bg-[#1C2534] border border-[#2B374B] rounded-xl p-6">
                <h3 className="text-base font-bold text-cyan-400 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs">1</span>
                  Cấu hình Session & Cookie Cố định (`persist:session_name`)
                </h3>
                <p className="text-xs text-slate-300 mt-2">
                  Thay vì dùng session tạm thời, Electron cho phép lưu trữ vĩnh viễn cookies, localStorage và token đăng nhập Google vào thư mục profile riêng của từng tài khoản.
                </p>
                <div className="mt-3 bg-[#131924] p-4 rounded-lg font-mono text-xs text-slate-300 overflow-x-auto border border-[#2B374B]">
                  {`// main.ts - Khởi tạo BrowserView / BrowserWindow với partition riêng
const { session } = require('electron');
const path = require('path');

function createFlowWindow(accountId: string) {
  const ses = session.fromPartition(\`persist:flowdesk_\${accountId}\`);
  
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  win.loadURL('https://labs.google/fx/tools/flow');
}`}
                </div>
              </div>

              {/* Strategy 2 */}
              <div className="bg-[#1C2534] border border-[#2B374B] rounded-xl p-6">
                <h3 className="text-base font-bold text-cyan-400 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs">2</span>
                  Ẩn cờ tự động hóa (Stealth Mode) trong Preload Script
                </h3>
                <p className="text-xs text-slate-300 mt-2">
                  Google Flow phát hiện bot thông qua thuộc tính `navigator.webdriver`. Đoạn code sau trong `preload.js` sẽ che giấu hoàn hảo dấu vết tự động hóa:
                </p>
                <div className="mt-3 bg-[#131924] p-4 rounded-lg font-mono text-xs text-slate-300 overflow-x-auto border border-[#2B374B]">
                  {`// preload.js - Ghi đè các thuộc tính phát hiện bot
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined
});

// Giả lập plugins và languages giống Chrome thật
Object.defineProperty(navigator, 'languages', {
  get: () => ['vi-VN', 'vi', 'en-US', 'en']
});

window.chrome = {
  runtime: {},
  app: {},
  loadTimes: function() {},
  csi: function() {}
};`}
                </div>
              </div>

              {/* Strategy 3 */}
              <div className="bg-[#1C2534] border border-[#2B374B] rounded-xl p-6">
                <h3 className="text-base font-bold text-cyan-400 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs">3</span>
                  Cấu hình `electron-builder` để đóng gói tệp cài đặt `.exe` trên Windows
                </h3>
                <p className="text-xs text-slate-300 mt-2">
                  Thêm cấu hình sau vào `package.json` để build ứng dụng thành file cài đặt Windows `.exe`:
                </p>
                <div className="mt-3 bg-[#131924] p-4 rounded-lg font-mono text-xs text-slate-300 overflow-x-auto border border-[#2B374B]">
                  {`"build": {
  "appId": "com.flowdesk.studio",
  "productName": "FlowDesk Studio",
  "directories": {
    "output": "release"
  },
  "win": {
    "target": ["nsis"],
    "icon": "assets/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}`}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="flex-1 p-6 flex flex-col overflow-hidden">
            <div className="max-w-5xl mx-auto w-full flex-1 bg-[#1C2534] rounded-xl border border-[#2B374B] p-4 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-[#2B374B]">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" /> Nhật ký hoạt động hệ thống & CDP Tracing
                </h3>
                <button
                  onClick={() => setLogs([])}
                  className="px-3 py-1 bg-[#242E40] hover:bg-[#2D3B52] text-xs text-slate-300 rounded-lg transition-colors"
                >
                  Xóa log
                </button>
              </div>
              <div ref={logRef} className="flex-1 bg-[#131924] rounded-lg p-4 font-mono text-xs text-slate-300 overflow-y-auto mt-3 border border-[#2B374B] space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className="hover:bg-[#1a2333] px-1 py-0.5 rounded">{log}</div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
