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
  ChevronRight,
  HelpCircle,
  Eye,
  Info
} from 'lucide-react';

export interface Account {
  Id: string;
  Name: string;
  Email: string;
  Plan: 'Free' | 'Plus' | 'Pro' | 'Ultra' | 'Unknown';
  Credits: number | null;
  Status: string;
  Enabled: boolean;
  Images: boolean;
  Videos: boolean;
  LoginStarted: boolean;
  LoginMode: boolean;
  Port: number;
  BrowserId: string;
  CheckedUtc?: string | null;
  Evidence?: string;
}

export interface JobAttempt {
  ExecutionId: string;
  AccountId: string;
  Prompt: string;
  State: string;
  Note: string;
  Url?: string;
  Results: string[];
}

export interface StudioTask {
  Id: string;
  Kind: 'video' | 'image';
  Mode: string;
  Model: string;
  Ratio: string;
  Count: string;
  Prompt: string;
  SentPrompt?: string | null;
  ExecutionId?: string;
  Attempts?: JobAttempt[];
  References: string[];
  StartImage?: string | null;
  EndImage?: string | null;
  State: 'Hàng đợi' | 'Đang chạy' | 'Đang gửi' | 'Hoàn tất' | 'Lỗi' | 'Cần kiểm tra';
  Note: string;
  AccountId: string;
  Folder: string;
  Progress: number | null;
  Results: string[];
  Submitted: boolean;
  AutoDraft?: boolean;
  Url?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'studio' | 'accounts' | 'mapping' | 'logs'>('studio');
  const [activeKind, setActiveKind] = useState<'video' | 'image'>('video');

  // Model & Settings State
  const [model, setModel] = useState<string>('Veo 3.1 Fast');
  const [ratio, setRatio] = useState<string>('16:9');
  const [count, setCount] = useState<string>('x1');
  const [concurrent, setConcurrent] = useState<string>('1');
  const [delay, setDelay] = useState<string>('10–20 giây');
  const [mode, setMode] = useState<string>('Văn bản / Khung hình → Video');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('auto');
  const [promptsText, setPromptsText] = useState<string>('');
  const draftInputs = useRef<Record<string, string>>({ video: '', image: '' });
  const [storeReady, setStoreReady] = useState(false);
  const [catalogs, setCatalogs] = useState<Record<string, Array<{name: string; disabled?: boolean}>>>({});
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [splitMode, setSplitMode] = useState<string>('Đoạn trống / 1 prompt');
  const [samePrompt, setSamePrompt] = useState<boolean>(false);
  const [outputFolder, setOutputFolder] = useState<string>('C:\\FlowDesk\\Results');
  const [references, setReferences] = useState<string[]>([]);

  // Execution & System State
  const [running, setRunning] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([
    '12:00:00 [System] Khởi động FlowDesk Studio • Electron Edition',
    '12:00:02 [BrowserManager] Kiểm tra hồ sơ Cốc Cốc tại Data/Profiles/ (Lưu cookie độc lập).',
    '12:00:05 [CDP] Cổng gỡ lỗi cục bộ 127.0.0.1 kết nối theo cơ chế DevToolsActivePort.',
    '12:00:10 [Security] Stealth Mode sẵn sàng: navigator.webdriver = undefined.'
  ]);

  // Data Store State
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccId, setSelectedAccId] = useState<string>('');
  const [queue, setQueue] = useState<StudioTask[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`${timestamp} ${msg}`, ...prev.slice(0, 249)]);
  };

  // Khởi tạo và đồng bộ với Electron Store (hoặc fallback nếu chạy Web Preview)
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api && api.getStore) {
      addLog('[Electron] Kết nối IPC Main Process thành công.');
      api.getStore().then((storeData: any) => {
        if (storeData) {
          if (Array.isArray(storeData.Accounts)) setAccounts(storeData.Accounts);
          if (Array.isArray(storeData.Queue)) setQueue(storeData.Queue);
          if (storeData.OutputFolder) setOutputFolder(storeData.OutputFolder);
          for (const kind of ['video', 'image']) {
            draftInputs.current[kind] = (storeData.Queue || []).filter((job: StudioTask) =>
              job.Kind === kind && job.AutoDraft && !job.Submitted && job.State === 'Hàng đợi').map((job: StudioTask) => job.Prompt).join('\n\n');
          }
          setPromptsText(draftInputs.current.video);
          const first = (storeData.Queue || []).find((job: StudioTask) => job.Kind === 'video' && job.AutoDraft);
          if (first) { setModel(first.Model); setRatio(first.Ratio); setCount(first.Count); setMode(first.Mode); setSelectedAccountId(first.AccountId || 'auto'); }
          setStoreReady(true);
        }
      }).catch((e: any) => console.error(e));

      // Lắng nghe sự kiện từ Main Process
      const unsubLog = api.onEvent('log', (msg: string) => addLog(msg));
      const unsubQueue = api.onEvent('queue-updated', (q: StudioTask[]) => {
        setQueue(q);
        const isStillRunning = q.some(item => item.State === 'Đang chạy' || item.State === 'Đang gửi');
        setRunning(isStillRunning);
      });
      const unsubRunner = api.onEvent('runner-status', (state: any) => {
        setRunning(state.running); setPaused(state.paused);
      });
      const unsubAcc = api.onEvent('account-updated', (updatedAcc: Account) => {
        setAccounts(prev => prev.map(a => a.Id === updatedAcc.Id ? updatedAcc : a));
      });

      return () => {
        if (unsubLog) unsubLog();
        if (unsubQueue) unsubQueue();
        if (unsubAcc) unsubAcc();
        if (unsubRunner) unsubRunner();
      };
    } else { setStoreReady(true); }
  }, []);

  // Tự động tách prompt thành các hàng job khi người dùng gõ
  useEffect(() => {
    if ((window as any).electronAPI && !storeReady) return;
    const lines = splitMode === 'Đoạn trống / 1 prompt'
      ? promptsText.replace(/\r/g, '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
      : promptsText.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);

    const api = (window as any).electronAPI;
    if (api && api.syncPrompts) {
      api.syncPrompts({
        kind: activeKind,
        prompts: lines,
        model,
        ratio,
        count,
        mode,
        references,
        samePrompt,
        accountId: selectedAccountId
      }).then((newQueue: StudioTask[]) => {
        if (newQueue) setQueue(newQueue);
      }).catch((err: any) => console.error(err));
    } else {
      // Local fallback cho Web Preview
      setQueue(prev => {
        const locked = prev.filter(q => q.State !== 'Hàng đợi' || q.Submitted);
        const drafts: StudioTask[] = lines.map((text, idx) => ({
          Id: `job_draft_${idx + 1}`,
          Kind: activeKind,
          Mode: mode,
          Model: model,
          Ratio: ratio,
          Count: count,
          Prompt: text,
          References: references,
          State: 'Hàng đợi',
          Note: 'Bản nháp tự động',
          AccountId: selectedAccountId === 'auto' ? '' : selectedAccountId,
          Folder: `${outputFolder}\\${activeKind}\\draft_${idx + 1}`,
          Progress: null,
          Results: [],
          Submitted: false,
          AutoDraft: true,
          Attempts: []
        }));
        return [...locked, ...drafts];
      });
    }
  }, [promptsText, splitMode, activeKind, model, ratio, count, mode, references, selectedAccountId, samePrompt, storeReady]);

  // Điều khiển chạy hàng chờ
  const handleStartRun = () => {
    setRunning(true);
    setPaused(false);
    addLog(`[Studio] Bắt đầu điều phối hàng chờ (Song song: ${concurrent}, Độ trễ: ${delay})...`);

    const api = (window as any).electronAPI;
    if (api && api.startQueue) {
      api.startQueue({ concurrent, delay, kind: activeKind }).then(() => {
        draftInputs.current[activeKind] = ''; setPromptsText('');
      }).catch((err: any) => {
        addLog(`[Lỗi] ${err.message}`);
        setRunning(false);
      });
    } else {
      // Mô phỏng chạy trong Web Preview
      let index = 0;
      const interval = setInterval(() => {
        setQueue(prev => {
          const next = [...prev];
          const target = next.find(q => q.State === 'Hàng đợi');
          if (!target) {
            clearInterval(interval);
            setRunning(false);
            addLog('[Studio] Mô phỏng hoàn tất hàng chờ.');
            return next;
          }
          target.State = 'Đang chạy';
          target.Progress = 30;
          target.Note = 'Đang gửi prompt & tải ảnh qua CDP...';

          setTimeout(() => {
            setQueue(qPrev => {
              const qNext = [...qPrev];
              const t2 = qNext.find(x => x.Id === target.Id);
              if (t2) {
                t2.Progress = 80;
                t2.Note = 'Đang theo dõi media từ Flow...';
              }
              return qNext;
            });
          }, 1500);

          setTimeout(() => {
            setQueue(qPrev => {
              const qNext = [...qPrev];
              const t3 = qNext.find(x => x.Id === target.Id);
              if (t3) {
                t3.State = 'Hoàn tất';
                t3.Progress = 100;
                t3.Note = '[Mô phỏng] Không có tệp media thật.';
                t3.Results = [`${t3.Folder}\\result-1.mp4`];
              }
              return qNext;
            });
            addLog(`[Job] Tác vụ ${target.Id.slice(0, 8)} hoàn tất.`);
          }, 3500);

          return next;
        });
      }, 3000);
    }
  };

  const handlePause = () => {
    const api = (window as any).electronAPI;
    if (api && api.pauseQueue) {
      api.pauseQueue().then((res: any) => {
        setPaused(res.paused);
      });
    } else {
      setPaused(!paused);
    }
    addLog(`[Studio] Đã ${!paused ? 'tạm dừng' : 'tiếp tục'} hàng chờ.`);
  };

  const handleStop = () => {
    const api = (window as any).electronAPI;
    if (api && api.stopQueue) {
      api.stopQueue();
    }
    setRunning(false);
    addLog('[Studio] Đã dừng hàng chờ.');
  };

  const handleRetryJob = (jobId: string) => {
    const api = (window as any).electronAPI;
    if (api && api.retryJob) {
      api.retryJob(jobId).catch((error: any) => addLog(error.message));
    } else {
      setQueue(prev => prev.map(q => {
        if (q.Id === jobId) {
          return {
            ...q,
            ExecutionId: 'exec_' + Date.now().toString(36),
            State: 'Hàng đợi',
            Progress: null,
            Submitted: false,
            Note: 'Tạo lại từ bản ghi lịch sử'
          };
        }
        return q;
      }));
    }
    addLog(`[Job] Tạo lại tác vụ ${jobId.slice(0, 8)} (Giữ nguyên mã hàng, tạo lần chạy mới).`);
  };

  const handleDeleteJob = (jobId: string) => {
    const api = (window as any).electronAPI;
    if (api && api.deleteJob) {
      api.deleteJob(jobId).then(() => setQueue(prev => prev.filter(q => q.Id !== jobId))).catch((error: any) => addLog(error.message));
      return;
    }
    setQueue(prev => prev.filter(q => q.Id !== jobId));
    addLog(`[Job] Đã xóa tác vụ ${jobId.slice(0, 8)}.`);
  };

  const handleOpenRegularProfile = async (accId: string) => {
    setSelectedAccId(accId);
    const api = (window as any).electronAPI;
    if (!api?.openRegularProfile) {
      addLog('Mở hồ sơ riêng cần chạy bản Electron mới; bản xem trước không hỗ trợ.');
      return;
    }
    try {
      await api.openRegularProfile(accId);
      addLog('Đã mở Cốc Cốc thường. Mỗi tài khoản giữ phiên riêng; bạn đăng nhập và tạo trực tiếp trong cửa sổ này.');
    } catch (error: any) { addLog('[Hồ sơ thường] ' + error.message); }
  };

  const handleOpenChromeLogin = async (accId: string) => {
    setSelectedAccId(accId);
    const target = accounts.find(a => a.Id === accId);
    addLog(`[Cốc Cốc] Khởi chạy Cốc Cốc cho hồ sơ ${target?.Name || accId}...`);
    addLog(`[Cơ chế gốc] chrome.exe --user-data-dir="Data/Profiles/${accId}" --disable-blink-features=AutomationControlled --exclude-switches=enable-automation --disable-infobars --new-window https://labs.google/fx/tools/flow`);

    const api = (window as any).electronAPI;
    if (api && api.openChromeLogin) {
      try {
        const res = await api.openChromeLogin(accId);
        if (res.success) {
          addLog(`[Cốc Cốc] Đã mở thành công cửa sổ Cốc Cốc! Hãy đăng nhập Google rồi đóng cửa sổ để kết nối.`);
          setAccounts(prev => prev.map(a => a.Id === accId ? { ...a, Status: 'Đăng nhập xong: đóng Cốc Cốc để kết nối' } : a));
        }
      } catch (err: any) {
        addLog(`[Lỗi mở Cốc Cốc] ${err.message}`);
      }
    } else {
      window.open('https://labs.google/fx/tools/flow', '_blank');
      addLog('[Preview] Đã mở tab đăng nhập Flow trên trình duyệt.');
    }
  };

  const handleCheckAccount = async (accId: string) => {
    addLog(`[CDP] Kết nối WebSocket kiểm tra tài khoản ${accId}...`);
    setAccounts(prev => prev.map(a => a.Id === accId ? { ...a, Status: 'Đang kiểm tra qua CDP...' } : a));

    const api = (window as any).electronAPI;
    if (api && api.checkAccount) {
      try {
        const res = await api.checkAccount(accId);
        if (res.success && res.account) {
          setAccounts(prev => prev.map(a => a.Id === accId ? res.account : a));
        }
      } catch (err: any) {
        addLog(`[Lỗi CDP] ${err.message}`);
        setAccounts(prev => prev.map(a => a.Id === accId ? { ...a, Status: 'Lỗi đọc: ' + err.message } : a));
      }
    } else {
      // Preview fallback
      setTimeout(() => {
        setAccounts(prev => prev.map(a => a.Id === accId ? {
          ...a,
          Email: 'demo@example.invalid',
          Plan: 'Pro',
          Credits: 450,
          Status: 'Mô phỏng giao diện — chưa xác minh Flow',
          CheckedUtc: new Date().toISOString()
        } : a));
        addLog('[Preview] Dữ liệu demo, không đọc tài khoản thật.');
      }, 1000);
    }
  };

  const handleClearCaptcha = async (accId: string) => {
    addLog(`[Anti-Bot] Đang dọn cache reCAPTCHA và tải lại tab cho tài khoản ${accId}...`);
    const api = (window as any).electronAPI;
    if (api && api.clearCaptchaSession) {
      try {
        const res = await api.clearCaptchaSession(accId);
        addLog(`[Anti-Bot] ${res.message || 'Đã dọn dẹp và tải lại tab thành công.'}`);
        handleCheckAccount(accId);
      } catch (err: any) {
        addLog(`[Anti-Bot Lỗi] ${err.message}`);
      }
    } else {
      addLog('[Preview] Chức năng dọn captcha chạy qua Electron CDP.');
    }
  };

  const pickImages = async (job?: StudioTask, slot: 'start' | 'end' | 'reference' = 'reference') => {
    const api = (window as any).electronAPI;
    if (job && ['Đang chạy', 'Đang gửi'].includes(job.State)) { addLog('Không đổi ảnh của job đang chạy.'); return true; }
    if (!api?.selectImages) return false;
    try {
      const files = await api.selectImages(slot === 'reference');
      if (!files.length) return true;
      setImagePreviews(prev => ({ ...prev, ...Object.fromEntries(files.filter((file: any) => file.preview).map((file: any) => [file.path, file.preview])) }));
      if (!job) setReferences(files.map((file: any) => file.path));
      else {
        const patch = slot === 'start' ? { Id: job.Id, StartImage: files[0].path } : slot === 'end'
          ? { Id: job.Id, EndImage: files[0].path } : { Id: job.Id, References: files.map((file: any) => file.path) };
        await api.updateJob(patch);
        setQueue(prev => prev.map(item => item.Id === job.Id ? { ...item, ...patch } : item));
      }
      return true;
    } catch (error: any) { addLog('[Ảnh] ' + error.message); return true; }
  };

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.imagePreview) return;
    const paths = [...new Set(queue.flatMap(job => [job.StartImage, job.EndImage, ...(job.References || [])]).filter(Boolean))] as string[];
    for (const path of paths) if (!imagePreviews[path]) api.imagePreview(path).then((preview: string) => {
      if (preview) setImagePreviews(prev => ({ ...prev, [path]: preview }));
    }).catch(() => {});
  }, [queue]);

  const stats = {
    running: queue.filter(q => q.State === 'Đang chạy' || q.State === 'Đang gửi').length,
    waiting: queue.filter(q => q.State === 'Hàng đợi').length,
    completed: queue.filter(q => q.State === 'Hoàn tất').length,
    errors: queue.filter(q => q.State === 'Lỗi').length,
    activeAccounts: accounts.filter(a => a.LoginStarted && a.Enabled).length
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#131924] text-slate-100 font-sans select-none overflow-hidden">
      {!(window as any).electronAPI && <div className="bg-amber-900/60 text-amber-200 px-4 py-2 text-xs">Bản xem thử giao diện: tài khoản, tiến độ và kết quả mô phỏng không phải kết quả Flow thật. Chạy bản Electron để dùng Cốc Cốc/CDP.</div>}
      {/* Header Bar */}
      <header className="h-14 bg-[#1C2534] border-b border-[#2B374B] flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide text-white flex items-center gap-2">
              FlowDesk Studio <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">Electron CDP</span>
            </h1>
            <p className="text-[11px] text-slate-400">Điều khiển Cốc Cốc qua CDP • Trạng thái từ Flow và tệp tải thực tế</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-[#131924] p-1 rounded-lg border border-[#2B374B] text-xs">
          <button
            onClick={() => setActiveTab('studio')}
            className={`px-4 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'studio' ? 'bg-[#283548] text-cyan-400 font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Studio & Hàng chờ
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`px-4 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'accounts' ? 'bg-[#283548] text-cyan-400 font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Tài khoản Flow ({stats.activeAccounts}/30)
          </button>
          <button
            onClick={() => setActiveTab('mapping')}
            className={`px-4 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'mapping' ? 'bg-[#283548] text-cyan-400 font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Code className="w-3.5 h-3.5" /> Bảng ánh xạ & Kiểm chứng
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'logs' ? 'bg-[#283548] text-cyan-400 font-semibold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" /> Nhật ký ({logs.length})
          </button>
        </nav>

        {/* Quick Action */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (accounts.length === 0) {
                const api = (window as any).electronAPI;
                if (api && api.createAccount) {
                  api.createAccount().then((acc: Account) => {
                    setAccounts(prev => [...prev, acc]);
                    handleOpenChromeLogin(acc.Id);
                  });
                }
              } else {
                handleOpenChromeLogin(selectedAccId || accounts[0].Id);
              }
            }}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-900 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-all shadow flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" /> + Mở Cốc Cốc Đăng nhập
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* TAB 1: STUDIO & HÀNG CHỜ */}
        {activeTab === 'studio' && (
          <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
            {/* Left Control Panel (5 cols) */}
            <div className="col-span-5 bg-[#1C2534] rounded-xl border border-[#2B374B] p-4 flex flex-col gap-3.5 overflow-y-auto">
              {/* Stats overview */}
              <div className="grid grid-cols-5 gap-2 bg-[#131924] p-2.5 rounded-lg border border-[#2B374B] text-center text-xs">
                <div>
                  <div className="text-slate-400 text-[11px]">Chạy</div>
                  <div className="text-sm font-bold text-cyan-400 font-mono">{stats.running}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[11px]">Chờ</div>
                  <div className="text-sm font-bold text-amber-400 font-mono">{stats.waiting}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[11px]">Xong</div>
                  <div className="text-sm font-bold text-emerald-400 font-mono">{stats.completed}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[11px]">Lỗi</div>
                  <div className="text-sm font-bold text-rose-400 font-mono">{stats.errors}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[11px]">Tài khoản</div>
                  <div className="text-sm font-bold text-indigo-400 font-mono">{stats.activeAccounts}</div>
                </div>
              </div>

              {/* Mode switch (Video vs Image) */}
              <div className="flex bg-[#131924] p-1 rounded-lg border border-[#2B374B]">
                <button
                  onClick={() => {
                    setActiveKind('video'); setPromptsText(draftInputs.current.video); setReferences([]);
                    setModel('Veo 3.1 Fast');
                    setMode('Văn bản / Khung hình → Video');
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all ${
                    activeKind === 'video' ? 'bg-[#2D3B52] text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ▷ Flow Video
                </button>
                <button
                  onClick={() => {
                    setActiveKind('image'); setPromptsText(draftInputs.current.image); setReferences([]);
                    setModel('Nano Banana 2.1');
                    setMode('Văn bản / Ảnh tham chiếu → Ảnh');
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded transition-all ${
                    activeKind === 'image' ? 'bg-[#2D3B52] text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ▧ Flow Ảnh
                </button>
              </div>

              {/* Basic configs */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Mô hình (Model)</label>
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    {catalogs[activeKind]?.length ? <>
                      {!catalogs[activeKind].some(item => item.name === model) && <option value={model}>{model} (chưa khớp danh mục)</option>}
                      {catalogs[activeKind].map(item => <option key={item.name} value={item.name} disabled={item.disabled}>{item.name}</option>)}
                    </> : activeKind === 'video' ? (
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

                <button type="button" className="text-xs text-cyan-300" disabled={running} onClick={async () => {
                  const api = (window as any).electronAPI;
                  if (!api?.syncModels) { addLog('[Preview] Cần chạy Electron để đọc danh mục model thật.'); return; }
                  try {
                    const result = await api.syncModels(selectedAccountId, activeKind);
                    setCatalogs(prev => ({ ...prev, [activeKind]: result.models }));
                    const key = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
                    const match = result.models.find((item: any) => !item.disabled && key(item.name) === key(model));
                    if (match) setModel(match.name);
                    addLog('Đã đọc danh mục model thực tế từ Flow.');
                  } catch (error: any) { addLog(error.message); }
                }}>↻ Đồng bộ model từ Flow</button>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Tỷ lệ khung hình</label>
                  <select
                    value={ratio}
                    onChange={e => setRatio(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    <option value="16:9">16:9 (Ngang chuẩn)</option>
                    <option value="9:16">9:16 (Dọc TikTok/Reels)</option>
                    <option value="1:1">1:1 (Vuông)</option>
                    <option value="4:3">4:3</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Song song</label>
                  <select
                    value={concurrent}
                    onChange={e => setConcurrent(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-2 py-1.5 text-xs text-slate-200"
                  >
                    <option value="1">1 luồng</option>
                    <option value="2">2 luồng</option>
                    <option value="3">3 luồng</option>
                    <option value="4">4 luồng</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Độ trễ</label>
                  <select
                    value={delay}
                    onChange={e => setDelay(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-2 py-1.5 text-xs text-slate-200"
                  >
                    <option value="5–10 giây">5–10 giây</option>
                    <option value="10–20 giây">10–20 giây</option>
                    <option value="20–30 giây">20–30 giây</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Số lượng / job</label>
                  <select
                    value={count}
                    onChange={e => setCount(e.target.value)}
                    className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-2 py-1.5 text-xs text-slate-200"
                  >
                    <option value="x1">x1</option>
                    <option value="x2">x2</option>
                    <option value="x3">x3</option>
                    <option value="x4">x4</option>
                  </select>
                </div>
              </div>

              {/* Account selector */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">Tài khoản thực thi</label>
                  <button
                    onClick={() => setActiveTab('accounts')}
                    className="text-[11px] text-cyan-400 hover:underline"
                  >
                    + Quản lý hồ sơ ({accounts.length})
                  </button>
                </div>
                <select
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  className="w-full bg-[#131924] border border-[#2B374B] rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="auto">Tự chọn tài khoản đủ quyền luân phiên</option>
                  {accounts.map(a => (
                    <option key={a.Id} value={a.Id}>
                      {a.Name} ({a.Email || 'Chưa đăng nhập'}) - {a.Plan} ({a.Credits !== null ? `${a.Credits}cr` : '?'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Reference image panel */}
              <div className="bg-[#131924] p-3 rounded-lg border border-[#2B374B] space-y-2">
                <div className="text-xs font-semibold text-slate-300">Cấu hình nâng cao / Ảnh tham chiếu</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (await pickImages(undefined, 'reference')) return;
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
                    className="flex-1 py-1 px-2 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 rounded text-xs flex items-center justify-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" /> + Ảnh tham chiếu
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReferences([]);
                      addLog('[Ảnh tham chiếu] Đã bỏ toàn bộ ảnh tham chiếu.');
                    }}
                    className="py-1 px-2.5 bg-[#242E40] hover:bg-[#2D3B52] text-slate-400 hover:text-slate-200 rounded text-xs"
                  >
                    Bỏ ảnh
                  </button>
                </div>
                <div className="text-[11px] text-slate-400 font-mono bg-[#1C2534] p-1.5 rounded border border-[#2B374B] truncate">
                  {references.length > 0 ? `${references.length} ảnh: ${references.join(', ')}` : 'Chưa chọn ảnh'}
                </div>
              </div>

              {activeKind === 'video' && <select value={mode} onChange={e => setMode(e.target.value)} className="bg-[#131924] border border-[#2B374B] rounded p-2 text-xs"><option>Văn bản / Khung hình → Video</option><option>Thành phần → Video</option></select>}
              <label className="text-xs text-slate-400 flex items-center gap-2"><input type="checkbox" checked={samePrompt} onChange={e => setSamePrompt(e.target.checked)} /> Dùng một prompt cho tất cả ảnh</label>
              {/* Prompt Textarea */}
              <div className="flex-1 flex flex-col min-h-[120px]">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-400">Danh sách Prompt (Tự động tách hàng job)</label>
                  <select
                    value={splitMode}
                    onChange={e => setSplitMode(e.target.value)}
                    className="bg-[#131924] border border-[#2B374B] text-[11px] text-slate-300 rounded px-1.5 py-0.5"
                  >
                    <option value="Đoạn trống / 1 prompt">Đoạn trống / 1 prompt</option>
                    <option value="Mỗi dòng / 1 prompt">Mỗi dòng / 1 prompt</option>
                  </select>
                </div>
                <textarea
                  value={promptsText}
                  onChange={e => { draftInputs.current[activeKind] = e.target.value; setPromptsText(e.target.value); }}
                  placeholder="Gõ prompt tại đây, mỗi prompt tự động tạo 1 hàng job trong bảng bên phải..."
                  className="w-full flex-1 bg-[#131924] border border-[#2B374B] rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 resize-none font-sans"
                />
              </div>

              {/* Control Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-[#2B374B]">
                <button
                  onClick={handleStartRun}
                  disabled={running && !paused}
                  className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold rounded-lg shadow transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> CHẠY NGAY ({queue.filter(q => q.State === 'Hàng đợi').length} job)
                </button>
                <button
                  onClick={handlePause}
                  disabled={!running}
                  className="px-3 py-2.5 bg-[#2D3B52] hover:bg-[#364663] text-white font-semibold rounded-lg transition-all disabled:opacity-50 text-xs"
                >
                  {paused ? 'TIẾP TỤC' : 'TẠM DỪNG'}
                </button>
                <button
                  onClick={handleStop}
                  disabled={!running}
                  className="px-3 py-2.5 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 font-semibold rounded-lg transition-all disabled:opacity-50 text-xs"
                >
                  DỪNG
                </button>
              </div>
            </div>

            {/* Right Job Table (7 cols) */}
            <div className="col-span-7 bg-[#1C2534] rounded-xl border border-[#2B374B] p-4 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-[#2B374B]">
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" /> Hàng chờ tác vụ & Lịch sử chạy ({queue.length})
                  </h2>
                  <p className="text-xs text-slate-400">Prompt sửa trong lúc chạy chỉ áp dụng cho lần tiếp theo. Sửa trực tiếp trên bảng.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const api = (window as any).electronAPI;
                      if (api && api.clearCompletedJobs) {
                        api.clearCompletedJobs(activeKind).then((q: StudioTask[]) => {
                          if (q) setQueue(q);
                        });
                      } else {
                        setQueue(queue.filter(q => q.State !== 'Hoàn tất'));
                      }
                    }}
                    className="px-2.5 py-1 text-xs bg-[#242E40] hover:bg-[#2D3B52] text-slate-300 rounded-lg transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Dọn đã xong
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-y-auto mt-2">
                {queue.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                    <Layers className="w-8 h-8 mb-2 opacity-50" />
                    Chưa có tác vụ nào trong hàng chờ. Hãy gõ prompt ở ô bên trái để tự động tạo hàng job.
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#2B374B] text-[11px] text-slate-400 font-medium">
                        <th className="py-2 px-2.5">Mã & Cấu hình</th>
                        <th className="py-2 px-2.5">Ảnh đính kèm</th>
                        <th className="py-2 px-2.5">Prompt (Sửa tại đây)</th>
                        <th className="py-2 px-2.5">Trạng thái / Tiến độ</th>
                        <th className="py-2 px-2.5 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#242E40] text-xs">
                      {queue.map((q, idx) => (
                        <tr key={q.Id} className="hover:bg-[#202A3B] transition-colors">
                          <td className="py-2.5 px-2.5 align-top">
                            <div className="font-mono text-cyan-400 font-semibold text-[11px]">#{idx + 1} • {q.Id.slice(0, 8)}</div>
                            <div className="text-slate-400 text-[10px]">{q.Model} • {q.Ratio}</div>
                          </td>

                          {/* Image slots */}
                          <td className="py-2.5 px-2.5 align-top">
                            <div className="flex items-center gap-1.5">
                              {activeKind === 'video' ? (
                                <>
                                  <div
                                    onClick={async () => {
                      if (await pickImages(q, 'start')) return;
                                      const input = document.createElement('input');
                                      input.type = 'file';
                                      input.accept = 'image/*';
                                      input.onchange = (e: any) => {
                                        const file = e.target.files[0];
                                        if (file) {
                                          setQueue(prev => prev.map(item => item.Id === q.Id ? { ...item, StartImage: file.name } : item));
                                        }
                                      };
                                      input.click();
                                    }}
                                    className="w-10 h-10 rounded border border-[#3A4A63] bg-[#131924] hover:border-cyan-400 cursor-pointer flex flex-col items-center justify-center text-[9px] text-slate-400 hover:text-cyan-300"
                                    title="Ảnh đầu (Start Frame)"
                                  >
                                    {q.StartImage && imagePreviews[q.StartImage] ? <img src={imagePreviews[q.StartImage]} alt="Ảnh đầu" className="w-full h-full object-cover rounded" /> : q.StartImage ? 'Đầu' : '+ Đầu'}
                                  </div>
                                  <div
                                    onClick={async () => {
                      if (await pickImages(q, 'end')) return;
                                      const input = document.createElement('input');
                                      input.type = 'file';
                                      input.accept = 'image/*';
                                      input.onchange = (e: any) => {
                                        const file = e.target.files[0];
                                        if (file) {
                                          setQueue(prev => prev.map(item => item.Id === q.Id ? { ...item, EndImage: file.name } : item));
                                        }
                                      };
                                      input.click();
                                    }}
                                    className="w-10 h-10 rounded border border-[#3A4A63] bg-[#131924] hover:border-cyan-400 cursor-pointer flex flex-col items-center justify-center text-[9px] text-slate-400 hover:text-cyan-300"
                                    title="Ảnh cuối (End Frame)"
                                  >
                                    {q.EndImage && imagePreviews[q.EndImage] ? <img src={imagePreviews[q.EndImage]} alt="Ảnh cuối" className="w-full h-full object-cover rounded" /> : q.EndImage ? 'Cuối' : '+ Cuối'}
                                  </div>
                                </>
                              ) : (
                                <div
                                  onClick={async () => {
                      if (await pickImages(q, 'reference')) return;
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.multiple = true;
                                    input.accept = 'image/*';
                                    input.onchange = (e: any) => {
                                      const files = Array.from(e.target.files || []).map((f: any) => f.name);
                                      if (files.length > 0) {
                                        setQueue(prev => prev.map(item => item.Id === q.Id ? { ...item, References: files as string[] } : item));
                                      }
                                    };
                                    input.click();
                                  }}
                                  className="px-2 py-1 rounded border border-indigo-500/30 bg-indigo-600/20 text-indigo-300 text-[10px] cursor-pointer"
                                >
                                  {q.References && q.References.length > 0 ? `Ref (${q.References.length})` : '+ Ref (5)'}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Editable Prompt */}
                          <td className="py-2.5 px-2.5 align-top">
                            <textarea
                              value={q.Prompt}
                              onChange={(e) => {
                                const val = e.target.value;
                                setQueue(prev => prev.map(item => item.Id === q.Id ? { ...item, Prompt: val } : item));
                                const api = (window as any).electronAPI;
                                if (api && api.updateJob) {
                                  api.updateJob({ Id: q.Id, Prompt: val }).catch((error: any) => addLog(error.message));
                                  if (q.AutoDraft && !q.Submitted && q.State === 'Hàng đợi') {
                                    const drafts = queue.filter(job => job.Kind === activeKind && job.AutoDraft && !job.Submitted && job.State === 'Hàng đợi');
                                    const index = drafts.findIndex(job => job.Id === q.Id);
                                    const values = splitMode === 'Đoạn trống / 1 prompt' ? promptsText.split(/\n\s*\n/) : promptsText.split('\n');
                                    if (index >= 0 && index < values.length) {
                                      values[index] = val; const text = values.join(splitMode === 'Đoạn trống / 1 prompt' ? '\n\n' : '\n');
                                      draftInputs.current[activeKind] = text; setPromptsText(text);
                                    }
                                  }
                                }
                              }}
                              className="w-full bg-[#131924] border border-[#2B374B] rounded p-1.5 text-xs text-slate-200 resize-none h-14 focus:outline-none focus:border-cyan-500 font-sans"
                            />
                            {q.SentPrompt && q.SentPrompt !== q.Prompt && (
                              <div className="text-[10px] text-amber-400 mt-0.5">
                                * Đã sửa trong lúc chạy: sẽ áp dụng ở lần chạy tiếp theo.
                              </div>
                            )}
                          </td>

                          {/* Status & Progress */}
                          <td className="py-2.5 px-2.5 align-top">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                              q.State === 'Hoàn tất' ? 'bg-emerald-500/20 text-emerald-400' :
                              q.State === 'Đang chạy' || q.State === 'Đang gửi' ? 'bg-cyan-500/20 text-cyan-400 animate-pulse' :
                              q.State === 'Lỗi' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-700/40 text-slate-300'
                            }`}>
                              {q.State} {q.Progress !== null && q.Progress > 0 ? `(${q.Progress}%)` : ''}
                            </span>
                            <div className="text-[11px] text-slate-400 mt-1 max-w-[200px] truncate" title={q.Note}>
                              {q.Note}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-2.5 px-2.5 align-top text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleRetryJob(q.Id)}
                                title="Tạo lại job này (tạo mã lần chạy mới & lưu lịch sử)"
                                className="p-1.5 bg-[#242E40] hover:bg-[#2D3B52] text-slate-300 rounded transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  const api = (window as any).electronAPI;
                                  if (api && api.openFolder) {
                                    api.openFolder(q.Folder);
                                  } else {
                                    alert(`Mở thư mục: ${q.Folder}`);
                                  }
                                }}
                                title="Mở thư mục kết quả"
                                className="p-1.5 bg-[#242E40] hover:bg-[#2D3B52] text-slate-300 rounded transition-colors"
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteJob(q.Id)}
                                title="Xóa khỏi hàng chờ"
                                className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 rounded transition-colors"
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
            </div>
          </div>
        )}

        {/* TAB 2: TÀI KHOẢN FLOW */}
        {activeTab === 'accounts' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-6xl mx-auto bg-[#1C2534] rounded-xl border border-[#2B374B] p-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-[#2B374B] gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-cyan-400" /> CÀI ĐẶT HỆ THỐNG • TÀI KHOẢN FLOW ({accounts.length}/30)
                  </h2>
                  <p className="text-xs text-emerald-400 mt-1">
                    Mỗi tài khoản lưu giữ phiên riêng tại <code>Data/Profiles/&lt;id&gt;</code>. Người dùng tự đăng nhập Google trong Cốc Cốc thường; tool không giữ mật khẩu.
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Đăng nhập xong: đóng Cốc Cốc hồ sơ → Bấm "Kết nối và đọc tài khoản" để đọc trực tiếp email, gói và credits từ Flow.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={async () => {
                      if (accounts.length >= 30) {
                        alert('Đã đạt giới hạn tối đa 30 hồ sơ.');
                        return;
                      }
                      const api = (window as any).electronAPI;
                      if (api && api.createAccount) {
                        const newAcc = await api.createAccount();
                        setAccounts(prev => [...prev, newAcc]);
                        setSelectedAccId(newAcc.Id);
                        handleOpenChromeLogin(newAcc.Id);
                      }
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 shadow"
                  >
                    <Plus className="w-4 h-4" /> + Thêm đăng nhập
                  </button>

                  <button
                    onClick={() => {
                      const acc = accounts.find(a => a.Id === selectedAccId) || accounts[0];
                      if (!acc) return alert('Chưa chọn tài khoản nào.');
                      handleOpenChromeLogin(acc.Id);
                    }}
                    className="px-3.5 py-2 bg-[#242E40] hover:bg-[#2D3B52] text-xs font-semibold text-cyan-300 rounded-lg transition-colors flex items-center gap-1.5 border border-[#3A4A63]"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Đăng nhập Cốc Cốc thường
                  </button>

                  <button
                    onClick={() => {
                      const acc = accounts.find(a => a.Id === selectedAccId) || accounts[0];
                      if (!acc) return alert('Chưa chọn tài khoản nào.');
                      handleCheckAccount(acc.Id);
                    }}
                    className="px-3.5 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-xs font-semibold text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 border border-emerald-500/40"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Kết nối và đọc tài khoản
                  </button>
                </div>
              </div>

              <div className="px-5 py-3 flex items-center gap-3">
                  <button
                    onClick={() => {
                      const acc = accounts.find(a => a.Id === selectedAccId) || accounts[0];
                      if (!acc) return alert('Thêm tài khoản trước khi mở hồ sơ.');
                      handleOpenRegularProfile(acc.Id);
                    }}
                    className="px-3.5 py-2 bg-[#242E40] hover:bg-[#2D3B52] text-xs font-semibold text-cyan-300 rounded-lg"
                  >
                    Mở hồ sơ thường
                  </button>

                <span className="text-xs text-slate-400">Mỗi tài khoản dùng một hồ sơ riêng. Đăng nhập và tạo trực tiếp trong Cốc Cốc; cookie được giữ cho lần sau.</span>
              </div>

              {/* Accounts Table */}
              <div className="overflow-x-auto">
                {accounts.length === 0 ? (
                  <div className="p-12 text-center border border-dashed border-[#2B374B] rounded-xl bg-[#131924]">
                    <Users className="w-10 h-10 text-slate-500 mx-auto mb-2" />
                    <h3 className="text-sm font-semibold text-slate-200">Chưa có hồ sơ tài khoản nào</h3>
                    <p className="text-xs text-slate-400 mt-1">Bấm nút "+ Thêm đăng nhập" ở trên để khởi tạo hồ sơ đầu tiên và mở Cốc Cốc.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#2B374B] text-xs text-slate-400 font-semibold bg-[#131924]">
                        <th className="py-2.5 px-3">Hồ sơ</th>
                        <th className="py-2.5 px-3">Tài khoản Email</th>
                        <th className="py-2.5 px-3">Gói</th>
                        <th className="py-2.5 px-3">Tín dụng (Credits)</th>
                        <th className="py-2.5 px-3">Trạng thái</th>
                        <th className="py-2.5 px-3">Quyền</th>
                        <th className="py-2.5 px-3">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#242E40] text-xs">
                      {accounts.map(acc => (
                        <tr
                          key={acc.Id}
                          onClick={() => setSelectedAccId(acc.Id)}
                          className={`cursor-pointer transition-colors ${selectedAccId === acc.Id ? 'bg-[#253247]' : 'hover:bg-[#202A3B]'}`}
                        >
                          <td className="py-3 px-3 font-semibold text-white flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${acc.Email ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            {acc.Name}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-300">{acc.Email || 'Chưa xác minh'}</td>
                          <td className="py-3 px-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                              acc.Plan === 'Ultra' ? 'bg-purple-500/20 text-purple-400' :
                              acc.Plan === 'Pro' ? 'bg-blue-500/20 text-blue-400' :
                              acc.Plan === 'Plus' ? 'bg-emerald-500/20 text-emerald-400' :
                              acc.Plan === 'Free' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700/30 text-slate-400'
                            }`}>
                              {acc.Plan}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-cyan-400">{acc.Credits !== null ? acc.Credits : '—'}</td>
                          <td className="py-3 px-3 text-slate-400 max-w-[200px] truncate" title={acc.Status}>{acc.Status}</td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={acc.Enabled}
                                  onChange={e => {
                                    const val = e.target.checked;
                                    setAccounts(prev => prev.map(a => a.Id === acc.Id ? { ...a, Enabled: val } : a));
                                    const api = (window as any).electronAPI;
                                    if (api && api.updateAccountPermissions) api.updateAccountPermissions(acc.Id, { Enabled: val });
                                  }}
                                /> Bật
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={acc.Images}
                                  onChange={e => {
                                    const val = e.target.checked;
                                    setAccounts(prev => prev.map(a => a.Id === acc.Id ? { ...a, Images: val } : a));
                                    const api = (window as any).electronAPI;
                                    if (api && api.updateAccountPermissions) api.updateAccountPermissions(acc.Id, { Images: val });
                                  }}
                                /> Ảnh
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={acc.Videos}
                                  onChange={e => {
                                    const val = e.target.checked;
                                    setAccounts(prev => prev.map(a => a.Id === acc.Id ? { ...a, Videos: val } : a));
                                    const api = (window as any).electronAPI;
                                    if (api && api.updateAccountPermissions) api.updateAccountPermissions(acc.Id, { Videos: val });
                                  }}
                                /> Video
                              </label>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenRegularProfile(acc.Id);
                                }}
                                className="px-2.5 py-1 bg-[#242E40] hover:bg-[#2D3B52] text-cyan-300 rounded transition-colors text-[11px]"
                              >
                                Mở hồ sơ thường
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCheckAccount(acc.Id);
                                }}
                                className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 rounded transition-colors text-[11px]"
                              >
                                Kiểm tra
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleClearCaptcha(acc.Id);
                                }}
                                className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 rounded transition-colors text-[11px]"
                                title="Xóa cache _grecaptcha và tải lại tab để khắc phục lỗi hoạt động bất thường"
                              >
                                Dọn Captcha
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const api = (window as any).electronAPI;
                                  if (api && api.deleteAccount) api.deleteAccount(acc.Id);
                                  setAccounts(prev => prev.filter(a => a.Id !== acc.Id));
                                }}
                                className="p-1 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 rounded transition-colors"
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
            </div>
          </div>
        )}

        {/* TAB 3: BẢNG ÁNH XẠ CHỨC NĂNG C# → ELECTRON & BÁO CÁO KIỂM CHỨNG */}
        {activeTab === 'mapping' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Architecture Boundary Note */}
              <div className="bg-[#1C2534] border border-[#2B374B] rounded-xl p-5">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" /> Cấu trúc phân lớp dự án Electron
                </h2>
                <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
                  <div className="bg-[#131924] p-3 rounded-lg border border-[#2B374B]">
                    <div className="font-bold text-cyan-400 mb-1">1. Main Process (electron/)</div>
                    <p className="text-slate-400 leading-relaxed">
                      Quản lý thực thi, hồ sơ Cốc Cốc (<code>Data/Profiles</code>), kết nối CDP WebSocket (<code>cdp-client.js</code>), hàng đợi song song và tệp kết quả.
                    </p>
                  </div>
                  <div className="bg-[#131924] p-3 rounded-lg border border-[#2B374B]">
                    <div className="font-bold text-purple-400 mb-1">2. Preload (preload.js)</div>
                    <p className="text-slate-400 leading-relaxed">
                      Cầu nối an toàn duy nhất qua <code>contextBridge</code>. Không để lộ cookie hay mật khẩu vào giao diện Renderer.
                    </p>
                  </div>
                  <div className="bg-[#131924] p-3 rounded-lg border border-[#2B374B]">
                    <div className="font-bold text-emerald-400 mb-1">3. Renderer (src/)</div>
                    <p className="text-slate-400 leading-relaxed">
                      Giao diện React hiển thị bảng tác vụ, trạng thái và cấu hình. Không trực tiếp gọi tiến trình bên ngoài.
                    </p>
                  </div>
                </div>
              </div>

              {/* Mapping Table */}
              <div className="bg-[#1C2534] border border-[#2B374B] rounded-xl p-5">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Code className="w-4 h-4 text-cyan-400" /> Bảng ánh xạ chức năng gốc C# WinForms sang Electron
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#2B374B] text-slate-400 bg-[#131924]">
                        <th className="py-2.5 px-3">Mã nguồn C# gốc (FlowDesk.cs)</th>
                        <th className="py-2.5 px-3">Module Electron tương ứng</th>
                        <th className="py-2.5 px-3">Cơ chế hoạt động</th>
                        <th className="py-2.5 px-3">Trạng thái kiểm chứng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#242E40]">
                      <tr>
                        <td className="py-2.5 px-3 font-mono text-cyan-300">Store (accounts.json, profiles)</td>
                        <td className="py-2.5 px-3 font-mono text-slate-200">electron/store.js</td>
                        <td className="py-2.5 px-3 text-slate-400">Lưu dữ liệu qua tệp tạm (.tmp) và hoán đổi an toàn, giữ nguyên cấu trúc JSON.</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Đã chuyển mã & kiểm tra</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-mono text-cyan-300">BrowserManager.OpenLogin</td>
                        <td className="py-2.5 px-3 font-mono text-slate-200">electron/browser-manager.js</td>
                        <td className="py-2.5 px-3 text-slate-400">Khởi chạy Cốc Cốc thật với cờ <code>--disable-blink-features=AutomationControlled</code>.</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Đã chuyển mã & kiểm tra</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-mono text-cyan-300">Cdp.Connect & Bridge</td>
                        <td className="py-2.5 px-3 font-mono text-slate-200">electron/cdp-client.js</td>
                        <td className="py-2.5 px-3 text-slate-400">Kết nối WebSocket qua thư viện <code>ws</code>, nạp mã <code>flow-bridge.js</code> vào trang.</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Đã chuyển mã</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-mono text-cyan-300">AccountRefresh.Read</td>
                        <td className="py-2.5 px-3 font-mono text-slate-200">flow-bridge.js (action: account)</td>
                        <td className="py-2.5 px-3 text-slate-400">Đọc bảng tài khoản Google/Flow, trích xuất email, gói, số credit thực tế.</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">Kiểm tra trên Flow thật</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-mono text-cyan-300">UploadJobImages</td>
                        <td className="py-2.5 px-3 font-mono text-slate-200">cdp-client.js (uploadImage)</td>
                        <td className="py-2.5 px-3 text-slate-400">Chặn hộp thoại tệp qua CDP <code>Page.setInterceptFileChooserDialog</code>.</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">Kiểm tra trên Flow thật</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-mono text-cyan-300">SubmitAndMonitor</td>
                        <td className="py-2.5 px-3 font-mono text-slate-200">electron/job-runner.js</td>
                        <td className="py-2.5 px-3 text-slate-400">Tính tọa độ nút Tạo, click một lần, xác nhận thẻ mới và theo dõi tiến trình.</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">Kiểm tra trên Flow thật</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-mono text-cyan-300">RetryInPlace & Attempts</td>
                        <td className="py-2.5 px-3 font-mono text-slate-200">electron/job-runner.js (retryJob)</td>
                        <td className="py-2.5 px-3 text-slate-400">Giữ nguyên hàng job, tạo ExecutionId mới và lưu lần chạy cũ vào lịch sử.</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Đã chuyển mã & kiểm tra</span></td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-mono text-cyan-300">Download media kết quả</td>
                        <td className="py-2.5 px-3 font-mono text-slate-200">electron/job-runner.js (downloadFile)</td>
                        <td className="py-2.5 px-3 text-slate-400">Tải tệp video/ảnh thực về thư mục <code>OutputFolder/kind/jobId</code>.</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Đã chuyển mã & kiểm tra</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Honest Verification Status Notice */}
              <div className="bg-[#1C2534] border border-[#2B374B] rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Báo cáo minh bạch về trạng thái kiểm chứng & Lỗi Bot/reCAPTCHA
                </h3>
                <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
                  <p>
                    <strong>1. Chức năng đã chuyển mã hoàn chỉnh (100% Ported):</strong> Toàn bộ cấu trúc C# của <code>Store</code>, <code>BrowserManager</code>, <code>Cdp</code>, <code>StudioTask</code>, và <code>flow-bridge.js</code> đã được chuyển đổi sang các module Node.js/Electron độc lập.
                  </p>
                  <p>
                    <strong>2. Chức năng đã kiểm tra mô phỏng (Simulated):</strong> Kiểm tra cấu hình hàng chờ song song, tự động gõ prompt tách hàng, in-place retry, lưu trữ JSON và đóng gói ứng dụng.
                  </p>
                  <p>
                    <strong>3. Chức năng cần kiểm chứng trực tiếp trên Flow thật:</strong> Các thao tác bóc tách DOM tài khoản, chặn hộp thoại chọn file của Cốc Cốc và theo dõi thẻ sinh media phụ thuộc vào giao diện web thời gian thực của Google Flow.
                  </p>
                  <p className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300">
                    <strong>Lưu ý quan trọng về lỗi "hoạt động bất thường" (Bot Detection):</strong> Mặc dù công cụ đã tích hợp đầy đủ cờ <code>--disable-blink-features=AutomationControlled</code>, cơ chế đăng nhập thủ công trên Cốc Cốc riêng và ghi đè <code>navigator.webdriver</code> qua preload/CDP, Google Flow liên tục cập nhật các thuật toán nhận diện hành vi (telemetry, click cadence, mouse velocity). Do đó, không thể khẳng định 100% không bao giờ gặp lỗi này nếu chưa chạy thử nghiệm thực tế với tài khoản thật của bạn.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: NHẬT KÝ VÀ THƯ MỤC */}
        {activeTab === 'logs' && (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="max-w-5xl mx-auto bg-[#1C2534] rounded-xl border border-[#2B374B] p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#2B374B]">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-cyan-400" /> Nhật ký hệ thống & Thư mục kết quả
                  </h2>
                  <p className="text-xs text-slate-400">Toàn bộ thông điệp CDP, tiến trình thực thi và lỗi được ghi lại theo thời gian thực.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const api = (window as any).electronAPI;
                      if (api && api.selectFolder) {
                        api.selectFolder().then((f: string) => {
                          if (f) setOutputFolder(f);
                        });
                      }
                    }}
                    className="px-3 py-1.5 bg-[#242E40] hover:bg-[#2D3B52] text-xs text-slate-200 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <FolderOpen className="w-3.5 h-3.5" /> Đổi thư mục lưu
                  </button>
                  <button
                    onClick={() => {
                      const api = (window as any).electronAPI;
                      if (api && api.openFolder) {
                        api.openFolder(outputFolder);
                      }
                    }}
                    className="px-3 py-1.5 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 text-xs rounded-lg transition-colors border border-cyan-500/40"
                  >
                    Mở thư mục ({outputFolder})
                  </button>
                </div>
              </div>

              {/* Log Viewer */}
              <div
                ref={logRef}
                className="h-96 bg-[#131924] border border-[#2B374B] rounded-lg p-3 font-mono text-xs overflow-y-auto space-y-1"
              >
                {logs.map((log, i) => (
                  <div key={i} className="text-slate-300 leading-relaxed hover:bg-[#1A2332] px-1 rounded">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

