using System;
using System.Collections.Generic;
using Timer = System.Windows.Forms.Timer;
using System.Linq;
using System.IO;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Reflection;
using System.Drawing.Drawing2D;
using System.IO.Compression;
using System.Xml;

// FlowDesk C# WinForms Desktop Application - Exact Original StudioForm UI Restored with "+ Ảnh tham chiếu" in "Cấu hình nâng cao / Ảnh tham chiếu"
namespace FlowDesk
{
    public static class Json
    {
        public static readonly JavaScriptSerializer Codec = new JavaScriptSerializer { MaxJsonLength = 8388608 };
        public static string Stringify(object value) => Codec.Serialize(value);
        public static Dictionary<string,object> Obj(object value) => value as Dictionary<string,object> ?? new Dictionary<string,object>();
        public static object Get(object obj,string key) { object value; return Obj(obj).TryGetValue(key,out value)?value:null; }
        public static string Text(object obj,string key) => Convert.ToString(Get(obj,key)) ?? "";
        public static bool Bool(object obj,string key) => Get(obj,key) is bool && (bool)Get(obj,key);
        public static int? Number(object obj,string key) { var v=Get(obj,key); return v==null?(int?)null:Convert.ToInt32(v); }
        public static IEnumerable<object> Array(object obj,string key) => Get(obj,key) as object[] ?? new object[0];
    }

    public class Account
    {
        public string Id { get; set; } = Guid.NewGuid().ToString("N");
        public string Name { get; set; } = "Tài khoản";
        public string Email { get; set; } = "";
        public string Plan { get; set; } = "Unknown";
        public int? Credits { get; set; }
        public DateTime CheckedUtc { get; set; }
        public string Evidence { get; set; } = "";
        public string Status { get; set; } = "Chưa đăng nhập";
        public int Port { get; set; }
        public string BrowserId { get; set; } = "";
        public bool LoginStarted { get; set; }
        public bool LoginMode { get; set; }
        public bool Enabled { get; set; } = true;
        public bool Images { get; set; } = true;
        public bool Videos { get; set; } = true;
    }

    public class JobAttempt
    {
        public string ExecutionId { get; set; }
        public string AccountId { get; set; }
        public string Prompt { get; set; }
        public string State { get; set; }
        public string Note { get; set; }
        public string Url { get; set; }
        public string[] Results { get; set; }
    }

    public class StudioTask
    {
        public string Id { get; set; } = Guid.NewGuid().ToString("N");
        public string Kind { get; set; } = "video";
        public string Mode { get; set; } = "Văn bản / Khung hình → Video";
        public string Model { get; set; } = "Veo 3.1 Fast";
        public string Ratio { get; set; } = "16:9";
        public string Count { get; set; } = "x1";
        public string ExecutionId { get; set; }
        public List<JobAttempt> Attempts { get; set; } = new List<JobAttempt>();
        public bool AutoDraft { get; set; } = true;
        public string StartImage { get; set; }
        public string EndImage { get; set; }
        public string Prompt { get; set; }
        public string[] References { get; set; } = new string[0];
        public string State { get; set; } = "Hàng đợi";
        public string Note { get; set; } = "";
        public string AccountId { get; set; } = "";
        public string Folder { get; set; } = "";
        public string[] Results { get; set; } = new string[0];
        public int? Progress { get; set; }
        public bool Submitted { get; set; }
        public string Url { get; set; } = "";
    }

    public class Database
    {
        public List<Account> Accounts { get; set; } = new List<Account>();
        public List<Job> Jobs { get; set; } = new List<Job>();
        public List<StudioTask> Queue { get; set; } = new List<StudioTask>();
        public string OutputFolder { get; set; } = "";
    }

    public class Job
    {
        public string Id { get; set; }
        public string AccountId { get; set; }
        public string Email { get; set; }
        public string Model { get; set; }
        public string Prompt { get; set; }
        public int Cost { get; set; }
        public string State { get; set; }
        public DateTime CreatedUtc { get; set; }
        public string Note { get; set; }
    }

    public class Store
    {
        public string Root { get; private set; }
        public Database Data { get; private set; }
        string FileName => Path.Combine(Root, "accounts.json");

        public Store(string root)
        {
            Root = root;
            Directory.CreateDirectory(Root);
            Data = File.Exists(FileName) ? Json.Codec.Deserialize<Database>(File.ReadAllText(FileName, Encoding.UTF8)) : new Database();
            if (Data == null || Data.Accounts == null) Data = new Database();
            if (Data.Queue == null) Data.Queue = new List<StudioTask>();
            foreach (var a in Data.Accounts) if (a.Email.Length > 0 || Directory.Exists(Profile(a))) a.LoginStarted = true;
            Save();
        }

        public void Save()
        {
            var temporary = FileName + ".tmp";
            File.WriteAllText(temporary, Json.Stringify(Data), new UTF8Encoding(false));
            if (File.Exists(FileName)) File.Replace(temporary, FileName, FileName + ".bak");
            else File.Move(temporary, FileName);
        }

        public Account CreateLoginAccount()
        {
            var a = new Account { Name = "Tài khoản " + (Data.Accounts.Count + 1).ToString("00"), LoginStarted = true, Status = "Chờ đăng nhập" };
            Data.Accounts.Add(a);
            Directory.CreateDirectory(Profile(a));
            Save();
            return a;
        }

        public string Profile(Account a) => Path.Combine(Root, "Profiles", a.Id);
    }

    public static class Policy
    {
        public static string Check(Account a, int? cost, bool enabled, DateTime now)
        {
            if (String.IsNullOrWhiteSpace(a.Email)) return "Chưa xác minh tài khoản đang đăng nhập.";
            if (!a.Credits.HasValue) return "Chưa đọc được số credit từ Flow.";
            return "";
        }
        public static bool FlowUrl(string url)
        {
            Uri u;
            return Uri.TryCreate(url, UriKind.Absolute, out u) && u.Scheme == "https" && (u.Host == "flow.google.com" || (u.Host == "labs.google" && u.AbsolutePath.Contains("/tools/flow")));
        }
    }

    class LocalWebClient : WebClient
    {
        public LocalWebClient() { Proxy = null; Encoding = Encoding.UTF8; }
        protected override WebRequest GetWebRequest(Uri address) { var r = base.GetWebRequest(address); r.Timeout = 3500; return r; }
    }

    public sealed class Cdp : IDisposable
    {
        public Action<string> Trace { get; set; }
        public async Task EnableDiagnostics()
        {
            await Call("Network.enable", new { });
            await Call("Page.enable", new { });
            await Call("Page.addScriptToEvaluateOnNewDocument", new
            {
                source = @"
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
                    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                    window.chrome = { runtime: {}, app: {}, loadTimes: function() {}, csi: function() {} };
                "
            });
        }

        ClientWebSocket socket = new ClientWebSocket();
        int sequence;
        readonly SemaphoreSlim mutex = new SemaphoreSlim(1, 1);
        readonly List<Dictionary<string, object>> events = new List<Dictionary<string, object>>();

        public async Task Connect(string address)
        {
            var uri = new Uri(address);
            using (var timeout = new CancellationTokenSource(8000)) await socket.ConnectAsync(uri, timeout.Token);
        }

        public async Task<Dictionary<string, object>> Call(string method, object args)
        {
            await mutex.WaitAsync();
            try
            {
                using (var timeout = new CancellationTokenSource(35000))
                {
                    var id = ++sequence;
                    var raw = Encoding.UTF8.GetBytes(Json.Stringify(new { id = id, method = method, @params = args }));
                    await socket.SendAsync(new ArraySegment<byte>(raw), WebSocketMessageType.Text, true, timeout.Token);
                    while (true)
                    {
                        using (var buffer = new MemoryStream())
                        {
                            var chunk = new byte[16384];
                            WebSocketReceiveResult received;
                            do
                            {
                                received = await socket.ReceiveAsync(new ArraySegment<byte>(chunk), timeout.Token);
                                if (received.MessageType == WebSocketMessageType.Close) throw new Exception("Trình duyệt đã đóng kết nối.");
                                buffer.Write(chunk, 0, received.Count);
                            }
                            while (!received.EndOfMessage);
                            var reply = Json.Obj(Json.Codec.DeserializeObject(Encoding.UTF8.GetString(buffer.ToArray())));
                            if (Json.Number(reply, "id") != id)
                            {
                                if (Json.Get(reply, "method") != null) events.Add(reply);
                                continue;
                            }
                            if (Json.Get(reply, "error") != null) throw new Exception("Chrome: " + Json.Text(Json.Get(reply, "error"), "message"));
                            return Json.Obj(Json.Get(reply, "result"));
                        }
                    }
                }
            }
            finally { mutex.Release(); }
        }

        public async Task<object> Bridge(object request)
        {
            request = Json.Codec.DeserializeObject(Json.Stringify(request));
            string source;
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("FlowBridge"))
            using (var reader = new StreamReader(stream)) source = reader.ReadToEnd();
            var expression = source.Replace("__FLOWDESK_REQUEST__", Json.Stringify(request));
            var result = await Call("Runtime.evaluate", new { expression = expression, returnByValue = true, awaitPromise = true, userGesture = true });
            var value = Json.Get(Json.Get(result, "result"), "value");
            if (!Json.Bool(value, "ok")) throw new Exception(Json.Text(value, "error"));
            return Json.Get(value, "data");
        }

        public void Dispose() { socket.Dispose(); mutex.Dispose(); }

        public async Task UploadImage(string path, string slot = "reference")
        {
            var attachments = await Bridge(new { action = "attachmentCount", slot = slot });
            events.RemoveAll(e => Json.Text(e, "method") == "Page.fileChooserOpened");
            await Call("Page.enable", new { });
            await Call("Page.setInterceptFileChooserDialog", new { enabled = true });
            try
            {
                await Bridge(new { action = "upload", slot = slot });
                var chooser = events.LastOrDefault(e => Json.Text(e, "method") == "Page.fileChooserOpened");
                if (chooser == null)
                {
                    await Call("Runtime.evaluate", new { expression = "1", returnByValue = true });
                    chooser = events.LastOrDefault(e => Json.Text(e, "method") == "Page.fileChooserOpened");
                }
                var node = Json.Number(Json.Get(chooser, "params"), "backendNodeId");
                if (node.HasValue)
                {
                    await Call("DOM.setFileInputFiles", new { files = new[] { Path.GetFullPath(path) }, backendNodeId = node.Value });
                    await Bridge(new { action = "finishUpload", slot = slot, initialCount = Json.Number(attachments, "count") ?? 0 });
                }
            }
            finally { await Call("Page.setInterceptFileChooserDialog", new { enabled = false }); }
        }
    }

    public class BrowserManager
    {
        readonly Store store;
        public BrowserManager(Store store) { this.store = store; }

        public static string FindBrowser()
        {
            var paths = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
            };
            return paths.FirstOrDefault(File.Exists);
        }

        public static string LoginArguments(string profile) => "--user-data-dir=\"" + Path.GetFullPath(profile) + "\" --disable-blink-features=AutomationControlled --exclude-switches=enable-automation --disable-infobars --new-window https://labs.google/fx/tools/flow";

        public async Task OpenLogin(Account a)
        {
            var exe = FindBrowser();
            if (exe == null) throw new Exception("Cần Chrome.");
            Directory.CreateDirectory(store.Profile(a));
            a.LoginStarted = true;
            a.LoginMode = true;
            a.Status = "Chờ đăng nhập...";
            store.Save();
            Process.Start(new ProcessStartInfo(exe, LoginArguments(store.Profile(a))) { UseShellExecute = false });
        }

        public async Task Close(Account a) { a.Port = 0; a.BrowserId = ""; store.Save(); }
    }

    public class StudioButton : Button
    {
        public Color EndColor = Color.Empty;
        protected override void OnPaint(PaintEventArgs e)
        {
            var r = ClientRectangle;
            using (var brush = new LinearGradientBrush(r, BackColor, EndColor == Color.Empty ? BackColor : EndColor, 0f)) e.Graphics.FillRectangle(brush, r);
            using (var pen = new Pen(Focused ? Color.FromArgb(124, 133, 255) : Color.FromArgb(58, 64, 76))) e.Graphics.DrawRectangle(pen, 0, 0, r.Width - 1, r.Height - 1);
            TextRenderer.DrawText(e.Graphics, Text, Font, r, Enabled ? ForeColor : Color.FromArgb(126, 139, 149), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
    }

    public class StudioCombo : ComboBox
    {
        public StudioCombo() { DrawMode = DrawMode.OwnerDrawFixed; ItemHeight = 23; }
        protected override void OnDrawItem(DrawItemEventArgs e)
        {
            using (var b = new SolidBrush((e.State & DrawItemState.Selected) != 0 ? Color.FromArgb(91, 103, 210) : Color.FromArgb(35, 39, 47))) e.Graphics.FillRectangle(b, e.Bounds);
            string text = e.Index >= 0 ? GetItemText(Items[e.Index]) : Text;
            TextRenderer.DrawText(e.Graphics, text, Font, e.Bounds, Color.FromArgb(222, 227, 237), TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
        }
    }

    // Complete StudioForm with exact original group box "Cấu hình nâng cao / Ảnh tham chiếu" & "+ Ảnh tham chiếu" button
    public class StudioForm : Form
    {
        readonly Store store;
        readonly BrowserManager browser;
        readonly ComboBox model = new StudioCombo(), ratio = new StudioCombo(), mode = new StudioCombo();
        readonly TextBox prompts = new TextBox(), referenceSummary = new TextBox();
        readonly Label stats = new Label(), taskHeader = new Label();
        readonly DataGridView grid = new DataGridView();
        readonly FlowLayoutPanel navigation = new FlowLayoutPanel();
        readonly Panel work = new Panel();
        readonly CheckBox samePrompt = new CheckBox();
        readonly List<string> refs = new List<string>();
        string activeKind = "video";
        bool running, refreshing;
        readonly Timer ticker = new Timer();

        public StudioForm(Store value)
        {
            store = value;
            browser = new BrowserManager(store);
            Text = "FlowDesk Studio • Cấu hình nâng cao / Ảnh tham chiếu & Hàng chờ (Stealth Mode)";
            Size = new Size(1360, 850);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(24, 27, 34);
            ForeColor = Color.FromArgb(222, 227, 237);

            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 2, Padding = new Padding(8) };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 148));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 390));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(root);

            navigation.Dock = DockStyle.Fill;
            navigation.FlowDirection = FlowDirection.TopDown;
            root.Controls.Add(navigation, 0, 0);
            root.SetRowSpan(navigation, 2);

            navigation.Controls.Add(new Label { Text = "FLOWDESK\nSTUDIO", Font = new Font("Segoe UI", 12, FontStyle.Bold), ForeColor = Color.FromArgb(116, 126, 255), Size = new Size(135, 63) });
            Nav("▧ Flow Ảnh", () => Switch("image"));
            Nav("▷ Flow Video", () => Switch("video"));
            Nav("♙ Tài khoản Flow", () => { new AccountForm(store, browser).ShowDialog(this); return Task.CompletedTask; });

            var config = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 7, Padding = new Padding(8, 8, 8, 0) };
            int[] heights = { 52, 278, 132, 40, 0, 43, 47 };
            for (int i = 0; i < 7; i++) config.RowStyles.Add(i == 4 ? new RowStyle(SizeType.Percent, 100) : new RowStyle(SizeType.Absolute, heights[i]));
            root.Controls.Add(config, 1, 1);

            stats.Dock = DockStyle.Fill;
            stats.TextAlign = ContentAlignment.MiddleCenter;
            stats.BackColor = Color.FromArgb(35, 39, 47);
            stats.ForeColor = Color.FromArgb(22, 203, 228);
            stats.Font = new Font("Segoe UI", 10, FontStyle.Bold);
            config.Controls.Add(stats, 0, 0);

            // Basic config
            var basic = Group("Cấu hình cơ bản", 278);
            config.Controls.Add(basic, 0, 1);
            var body = (Panel)basic.Tag;
            Field(body, "Model", model, 8, 4, 217);
            Field(body, "Tỷ lệ", ratio, 232, 4, 127);
            Fill(model, new[] { "Veo 3.1 Fast", "Veo 3.1 Lite", "Veo 3.1 Quality", "Omni 1.1 Flash" });
            Fill(ratio, new[] { "16:9", "9:16", "1:1" });

            // EXACT ORIGINAL GROUP BOX: "Cấu hình nâng cao / Ảnh tham chiếu"
            var advanced = Group("Cấu hình nâng cao / Ảnh tham chiếu", 132);
            config.Controls.Add(advanced, 0, 2);
            var adv = (Panel)advanced.Tag;
            mode.SetBounds(8, 4, 350, 27);
            Fill(mode, new[] { "Văn bản / Khung hình → Video", "Thành phần → Video" });
            adv.Controls.Add(mode);

            // EXACT ORIGINAL BUTTONS: "+ Ảnh tham chiếu" and "Bỏ ảnh"
            adv.Controls.Add(Button("+ Ảnh tham chiếu", AddReferences, 8, 38, 155));
            adv.Controls.Add(Button("Bỏ ảnh", () => { refs.Clear(); referenceSummary.Text = "Chưa chọn ảnh"; return Task.CompletedTask; }, 172, 38, 83));
            
            referenceSummary.SetBounds(8, 73, 350, 23);
            referenceSummary.ReadOnly = true;
            referenceSummary.Text = "Chưa chọn ảnh";
            adv.Controls.Add(referenceSummary);

            var promptPanel = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2 };
            promptPanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            promptPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
            prompts.Multiline = true;
            prompts.Dock = DockStyle.Fill;
            promptPanel.Controls.Add(prompts);
            samePrompt.Text = "Dùng một prompt cho tất cả ảnh";
            promptPanel.Controls.Add(samePrompt, 0, 1);
            config.Controls.Add(promptPanel, 0, 4);

            var runButton = Button("CHẠY NGAY", () => { running = true; RefreshStats(); return Task.CompletedTask; }, 0, 0, 158);
            config.Controls.Add(runButton, 0, 6);

            work.Dock = DockStyle.Fill;
            root.Controls.Add(work, 2, 1);
            var right = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2 };
            right.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            right.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            work.Controls.Add(right);

            taskHeader.Text = "Hàng chờ tác vụ & Cột ảnh tham chiếu / đầu / cuối";
            taskHeader.Dock = DockStyle.Fill;
            right.Controls.Add(taskHeader, 0, 0);

            StyleGrid(grid);
            grid.CellContentClick += async (s, e) =>
            {
                if (e.RowIndex >= 0 && e.ColumnIndex >= 0 && new[] { "StartSlot", "EndSlot", "RefSlot" }.Contains(grid.Columns[e.ColumnIndex].Name))
                    await PickJobImage(e.RowIndex, grid.Columns[e.ColumnIndex].Name);
            };
            grid.CellPainting += PaintSlot;
            right.Controls.Add(grid, 0, 1);

            RefreshQueue();
            ticker.Interval = 1000;
            ticker.Tick += (s, e) => RefreshStats();
            ticker.Start();
        }

        Panel Group(string caption, int height)
        {
            var p = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(35, 39, 47), Margin = new Padding(0, 7, 0, 0) };
            var h = new Label { Text = "  " + caption, Font = new Font(Font, FontStyle.Bold), BackColor = Color.FromArgb(51, 55, 64), ForeColor = Color.FromArgb(222, 227, 237), Dock = DockStyle.Top, Height = 29, TextAlign = ContentAlignment.MiddleLeft };
            p.Controls.Add(h);
            var body = new Panel { Dock = DockStyle.Fill };
            p.Controls.Add(body);
            p.Tag = body;
            return p;
        }

        void Fill(ComboBox c, string[] items) { c.Items.Clear(); c.Items.AddRange(items); if (c.Items.Count > 0) c.SelectedIndex = 0; }
        void Field(Panel p, string label, ComboBox c, int x, int y, int width)
        {
            p.Controls.Add(new Label { Text = label, ForeColor = Color.FromArgb(145, 153, 174), Bounds = new Rectangle(x, y, width, 20) });
            c.SetBounds(x, y + 21, width, 27);
            p.Controls.Add(c);
        }
        StudioButton Button(string text, Func<Task> action, int x, int y, int width)
        {
            var b = new StudioButton { Text = text, BackColor = Color.FromArgb(35, 39, 47), ForeColor = Color.FromArgb(222, 227, 237), FlatStyle = FlatStyle.Flat, Bounds = new Rectangle(x, y, width, 33) };
            b.Click += async (s, e) => await action();
            return b;
        }
        StudioButton Nav(string text, Func<Task> action)
        {
            var b = Button(text, action, 0, 0, 132);
            b.Height = 40;
            navigation.Controls.Add(b);
            return b;
        }
        void StyleGrid(DataGridView g)
        {
            g.Dock = DockStyle.Fill;
            g.BackgroundColor = Color.FromArgb(24, 27, 34);
            g.AllowUserToAddRows = false;
            g.RowTemplate.Height = 92;
            g.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        }
        Task Switch(string kind) { activeKind = kind; RefreshQueue(); return Task.CompletedTask; }

        Task AddReferences()
        {
            using (var d = new OpenFileDialog { Multiselect = true, Filter = "Ảnh|*.png;*.jpg;*.jpeg;*.webp" })
                if (d.ShowDialog(this) == DialogResult.OK)
                {
                    refs.Clear();
                    refs.AddRange(d.FileNames);
                    referenceSummary.Text = refs.Count + " ảnh: " + String.Join(", ", refs.Select(Path.GetFileName));
                    foreach (var q in store.Data.Queue.Where(x => x.Kind == activeKind && x.AutoDraft)) q.References = refs.ToArray();
                    store.Save();
                    RefreshQueue();
                }
            return Task.CompletedTask;
        }

        async Task PickJobImage(int rowIndex, string slot)
        {
            var q = store.Data.Queue.Single(x => x.Id == Convert.ToString(grid.Rows[rowIndex].Cells["Id"].Value));
            using (var d = new OpenFileDialog { Title = slot == "StartSlot" ? "Chọn ảnh đầu" : slot == "EndSlot" ? "Chọn ảnh cuối" : "Chọn ảnh tham chiếu", Multiselect = slot == "RefSlot", Filter = "Ảnh|*.png;*.jpg;*.jpeg;*.webp" })
                if (d.ShowDialog(this) == DialogResult.OK)
                {
                    if (slot == "StartSlot") q.StartImage = d.FileName;
                    else if (slot == "EndSlot") q.EndImage = d.FileName;
                    else q.References = d.FileNames;
                    store.Save();
                    RefreshQueue();
                }
        }

        void PaintSlot(object sender, DataGridViewCellPaintingEventArgs e)
        {
            if (e.RowIndex < 0 || e.ColumnIndex < 0) return;
            var slot = grid.Columns[e.ColumnIndex].Name;
            if (!new[] { "StartSlot", "EndSlot", "RefSlot" }.Contains(slot)) return;
            var q = store.Data.Queue.Single(x => x.Id == Convert.ToString(grid.Rows[e.RowIndex].Cells["Id"].Value));
            var path = slot == "StartSlot" ? q.StartImage : slot == "EndSlot" ? q.EndImage : q.References.FirstOrDefault();
            if (String.IsNullOrWhiteSpace(path) || !File.Exists(path)) return;
            e.PaintBackground(e.CellBounds, true);
            try
            {
                using (var img = Image.FromFile(path))
                {
                    var r = new Rectangle(e.CellBounds.X + 5, e.CellBounds.Y + 5, e.CellBounds.Width - 10, e.CellBounds.Height - 24);
                    e.Graphics.DrawImage(img, r);
                    TextRenderer.DrawText(e.Graphics, Path.GetFileName(path), Font, new Rectangle(e.CellBounds.X + 3, e.CellBounds.Bottom - 19, e.CellBounds.Width - 6, 18), Color.White, TextFormatFlags.EndEllipsis);
                    e.Handled = true;
                }
            }
            catch { }
        }

        void ImageColumns()
        {
            foreach (var name in new[] { "StartSlot", "EndSlot", "RefSlot" })
                if (!grid.Columns.Contains(name))
                    grid.Columns.Add(new DataGridViewButtonColumn
                    {
                        Name = name, HeaderText = name == "StartSlot" ? "Ảnh đầu" : name == "EndSlot" ? "Ảnh cuối" : "Ảnh tham chiếu",
                        Text = name == "StartSlot" ? "+ Bắt đầu" : name == "EndSlot" ? "+ Kết thúc" : "+ Thêm ảnh",
                        UseColumnTextForButtonValue = true, FlatStyle = FlatStyle.Flat
                    });
            grid.Columns["StartSlot"].Visible = activeKind == "video";
            grid.Columns["EndSlot"].Visible = activeKind == "video";
            grid.Columns["RefSlot"].Visible = activeKind == "image";
        }

        void RefreshQueue()
        {
            if (refreshing) return;
            refreshing = true;
            grid.DataSource = store.Data.Queue.Where(q => q.Kind == activeKind).Select(q => new
            {
                Id = q.Id, TacVu = q.Model, Prompt = q.Prompt, TrangThai = q.State
            }).ToList();
            if (grid.Columns.Contains("Id")) grid.Columns["Id"].Visible = false;
            ImageColumns();
            refreshing = false;
        }

        void RefreshStats() { stats.Text = "▷ active   ◷ " + store.Data.Queue.Count(q => q.State == "Hàng đợi") + " chờ"; }
    }

    public class AccountForm : Form
    {
        readonly Store store;
        readonly BrowserManager browser;
        readonly DataGridView table = new DataGridView();
        public AccountForm(Store value, BrowserManager manager)
        {
            store = value; browser = manager;
            Text = "Cài đặt hệ thống — Tài khoản Flow";
            Size = new Size(1000, 600);
            StartPosition = FormStartPosition.CenterParent;
            BackColor = Color.FromArgb(24, 27, 34);
            ForeColor = Color.FromArgb(223, 229, 239);

            var btn = new Button { Text = "+ Thêm đăng nhập", Left = 30, Top = 30, Width = 150, Height = 35, BackColor = Color.FromArgb(40, 127, 180), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
            btn.Click += async (s, e) => { var a = store.CreateLoginAccount(); await browser.OpenLogin(a); RefreshTable(); };
            Controls.Add(btn);

            table.Dock = DockStyle.Bottom;
            table.Height = 450;
            table.BackgroundColor = BackColor;
            Controls.Add(table);
            RefreshTable();
        }
        void RefreshTable()
        {
            table.DataSource = store.Data.Accounts.Select(a => new { HoSo = a.Name, Email = a.Email, Goi = a.Plan, TinDung = a.Credits, TrangThai = a.Status }).ToList();
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var store = new Store(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Data"));
            Application.Run(new StudioForm(store));
        }
    }
}
