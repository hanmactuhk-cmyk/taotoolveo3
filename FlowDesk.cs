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

namespace FlowDesk
{
    public static class Json
    {
        public static readonly JavaScriptSerializer Codec = new JavaScriptSerializer
        {
            MaxJsonLength = 8388608
        };
        public static string Stringify(object value)
        {
            return Codec.Serialize(value);
        }
        public static Dictionary<string,object> Obj(object value)
        {
            return value as Dictionary<string,object> ?? new Dictionary<string,object>();
        }
        public static object Get(object obj,string key)
        {
            object value;
            return Obj(obj).TryGetValue(key,out value)?value:null;
        }
        public static string Text(object obj,string key)
        {
            return Convert.ToString(Get(obj,key)) ?? "";
        }
        public static bool Bool(object obj,string key)
        {
            return Get(obj,key) is bool && (bool)Get(obj,key);
        }
        public static int? Number(object obj,string key)
        {
            var v=Get(obj,key);
            return v==null?(int?)null:Convert.ToInt32(v);
        }
        public static IEnumerable<object> Array(object obj,string key)
        {
            return Get(obj,key) as object[] ?? new object[0];
        }
    }

    public class Account
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Email { get; set; }
        public string Plan { get; set; }
        public int? Credits { get; set; }
        public DateTime CheckedUtc { get; set; }
        public string Evidence { get; set; }
        public string Status { get; set; }
        public int Port { get; set; }
        public string BrowserId { get; set; }
        public bool LoginStarted { get; set; }
        public bool LoginMode { get; set; }
        public bool Enabled { get; set; }
        public bool Images { get; set; }
        public bool Videos { get; set; }

        public Account()
        {
            Id = Guid.NewGuid().ToString("N");
            Name = "Tài khoản";
            Email = "";
            Plan = "Unknown";
            Status = "Chưa đăng nhập";
            Evidence = "";
            BrowserId = "";
            Enabled = true;
            Images = true;
            Videos = true;
        }
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

    public class Database
    {
        public List<Account> Accounts { get; set; }
        public List<Job> Jobs { get; set; }
        public List<StudioTask> Queue { get; set; }
        public string OutputFolder { get; set; }

        public Database()
        {
            Accounts = new List<Account>();
            Jobs = new List<Job>();
            Queue = new List<StudioTask>();
            OutputFolder = "";
        }
    }

    public class Store
    {
        public string Root { get; private set; }
        public Database Data { get; private set; }
        string FileName
        {
            get
            {
                return Path.Combine(Root,"accounts.json");
            }
        }
        public Store(string root)
        {
            Root=root;
            Directory.CreateDirectory(Root);
            Data=File.Exists(FileName)?Json.Codec.Deserialize<Database>(File.ReadAllText(FileName,Encoding.UTF8)):new Database();
            if(Data==null||Data.Accounts==null||Data.Jobs==null)throw new Exception("Tệp dữ liệu không hợp lệ. Bản sao dự phòng: accounts.json.bak");
            foreach(var j in Data.Jobs.Where(j=>j.State=="Đang gửi"))
            {
                j.State="Chưa rõ kết quả";
                j.Note="Ứng dụng đã đóng giữa lúc gửi. Kiểm tra Flow trước khi chạy lại.";
            }
            if(Data.Queue==null)Data.Queue=new List<StudioTask>();
            foreach(var q in Data.Queue.Where(q=>q.State=="Đang chạy"||q.State=="Đang gửi"))
            {
                q.State="Cần kiểm tra";
                q.Note="Phiên trước gián đoạn. Kiểm tra Flow trước khi chạy lại.";
            }
            foreach(var a in Data.Accounts)if(a.Email.Length>0||Directory.Exists(Profile(a)))a.LoginStarted=true;
            Save();
        }
        public void Save()
        {
            var temporary=FileName+".tmp";
            File.WriteAllText(temporary,Json.Stringify(Data),new UTF8Encoding(false));
            if(File.Exists(FileName))File.Replace(temporary,FileName,FileName+".bak");
            else File.Move(temporary,FileName);
        }
        public Account CreateLoginAccount()
        {
            var a=Data.Accounts.FirstOrDefault(x=>!x.LoginStarted&&String.IsNullOrEmpty(x.Email)&&!Directory.Exists(Profile(x))&&!Data.Jobs.Any(j=>j.AccountId==x.Id)&&!Data.Queue.Any(q=>q.AccountId==x.Id));
            if(a==null)
            {
                if(Data.Accounts.Count>=30)throw new Exception("Đã có 30 hồ sơ.");
                a=new Account
                {
                    Name="Tài khoản "+(Data.Accounts.Count+1).ToString("00")
                };
                Data.Accounts.Add(a);
            }
            a.LoginStarted=true;
            a.Status="Chờ đăng nhập";
            Directory.CreateDirectory(Profile(a));
            Save();
            return a;
        }
        public string Profile(Account a)
        {
            if(a.Id==null||a.Id.Length!=32||a.Id.Any(c=>!Uri.IsHexDigit(c)))throw new Exception("Mã hồ sơ không hợp lệ.");
            return Path.Combine(Root,"Profiles",a.Id);
        }
    }

    public static class Policy
    {
        public static string Check(Account a,int? cost,bool enabled,DateTime now)
        {
            if(String.IsNullOrWhiteSpace(a.Email))return "Chưa xác minh tài khoản đang đăng nhập.";
            if(!new[]{"Free","Plus","Pro","Ultra"}.Contains(a.Plan))return "Chưa xác định được gói tài khoản. Không suy đoán từ số credit.";
            if(!a.Credits.HasValue)return "Chưa đọc được số credit từ Flow.";
            if(a.CheckedUtc>now.AddSeconds(10)||now-a.CheckedUtc>TimeSpan.FromMinutes(3))return "Dữ liệu tài khoản đã cũ; kiểm tra lại credit.";
            if(!cost.HasValue||cost.Value<0)return "Chưa đọc được tổng chi phí của cấu hình hiện tại.";
            if(!enabled)return "Flow đang khóa nút tạo. Kiểm tra ảnh, model, quyền và hạn mức.";
            if(a.Credits.Value<cost.Value)return "Không đủ credit: còn "+a.Credits+", cần "+cost+".";
            return "";
        }
        public static bool FlowUrl(string url)
        {
            Uri u;
            return Uri.TryCreate(url,UriKind.Absolute,out u)&&u.Scheme=="https"&&(u.Host=="flow.google.com"||(u.Host=="labs.google"&&u.AbsolutePath.Contains("/tools/flow")));
        }
    }

    class LocalWebClient:WebClient
    {
        public LocalWebClient()
        {
            Proxy=null;
            Encoding=Encoding.UTF8;
        }
        protected override WebRequest GetWebRequest(Uri address)
        {
            var r=base.GetWebRequest(address);
            r.Timeout=3500;
            return r;
        }
    }

    public sealed class Cdp:IDisposable
    {
        public Action<string> Trace { get; set; }
        public async Task EnableDiagnostics()
        {
            await Call("Network.enable",new {});
            await Call("Page.enable",new {});

            // STEALTH MODE & BYPASS RECAPTCHA
            await Call("Page.addScriptToEvaluateOnNewDocument", new
            {
                source = @"
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
                    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                    window.chrome = { runtime: {}, app: {}, loadTimes: function() {}, csi: function() {} };
                    const originalQuery = window.navigator.permissions.query;
                    window.navigator.permissions.query = (parameters) => (
                      parameters.name === 'notifications' ?
                        Promise.resolve({ state: 'denied' }) :
                        originalQuery(parameters)
                    );
                "
            });

            var version=await Call("Browser.getVersion",new {});
            if(Trace!=null)Trace("[Browser] "+Json.Text(version,"product")+" (Stealth Active)");
        }
        void TraceEvent(Dictionary<string,object> reply)
        {
            if(Trace==null)return;
            var method=Json.Text(reply,"method");
            var p=Json.Get(reply,"params");
            if(method=="Network.responseReceived")
            {
                var response=Json.Get(p,"response");
                var status=Json.Number(response,"status")??0;
                Uri url;
                if(status>=400&&Uri.TryCreate(Json.Text(response,"url"),UriKind.Absolute,out url))Trace("[HTTP] "+status+" | "+url.Host+" | "+Json.Text(p,"type"));
            }
            else if(method=="Network.loadingFailed"&&!Json.Bool(p,"canceled"))Trace("[Network] "+Json.Text(p,"errorText"));
        }
        ClientWebSocket socket=new ClientWebSocket();
        int sequence;
        readonly SemaphoreSlim mutex=new SemaphoreSlim(1,1);
        readonly List<Dictionary<string,object>> events=new List<Dictionary<string,object>>();
        public async Task Connect(string address)
        {
            var uri=new Uri(address);
            if(uri.Scheme!="ws"||!(uri.Host=="127.0.0.1"||uri.Host=="localhost"))throw new Exception("Chỉ cho phép kết nối trình duyệt trên máy này.");
            using(var timeout=new CancellationTokenSource(8000))await socket.ConnectAsync(uri,timeout.Token);
        }
        public async Task<Dictionary<string,object>> Call(string method,object args)
        {
            await mutex.WaitAsync();
            try
            {
                using(var timeout=new CancellationTokenSource(35000))
                {
                    var id=++sequence;
                    var raw=Encoding.UTF8.GetBytes(Json.Stringify(new
                    {
                        id=id,method=method,@params=args
                    }));
                    await socket.SendAsync(new ArraySegment<byte>(raw),WebSocketMessageType.Text,true,timeout.Token);
                    while(true)
                    {
                        using(var buffer=new MemoryStream())
                        {
                            var chunk=new byte[16384];
                            WebSocketReceiveResult received;
                            do
                            {
                                received=await socket.ReceiveAsync(new ArraySegment<byte>(chunk),timeout.Token);
                                if(received.MessageType==WebSocketMessageType.Close)throw new Exception("Trình duyệt đã đóng kết nối.");
                                buffer.Write(chunk,0,received.Count);
                                if(buffer.Length>8388608)throw new Exception("Phản hồi quá lớn.");
                            }
                            while(!received.EndOfMessage);
                            var reply=Json.Obj(Json.Codec.DeserializeObject(Encoding.UTF8.GetString(buffer.ToArray())));
                            if(Json.Number(reply,"id")!=id)
                            {
                                if(Json.Get(reply,"method")!=null)
                                {
                                    TraceEvent(reply);
                                    events.Add(reply);
                                    if(events.Count>100)events.RemoveAt(0);
                                }
                                continue;
                            }
                            if(Json.Get(reply,"error")!=null)throw new Exception("Chrome: "+Json.Text(Json.Get(reply,"error"),"message"));
                            return Json.Obj(Json.Get(reply,"result"));
                        }
                    }
                }
            }
            catch(OperationCanceledException)
            {
                socket.Abort();
                throw new Exception("Hết thời gian chờ Chrome. Nếu đã gửi lệnh, kiểm tra Flow trước khi thử lại.");
            }
            finally
            {
                mutex.Release();
            }
        }
        public async Task<object> Bridge(object request)
        {
            request=Json.Codec.DeserializeObject(Json.Stringify(request));
            var action=Json.Text(request,"action");
            var timer=System.Diagnostics.Stopwatch.StartNew();
            if(Trace!=null&&action!="jobStatus")Trace("[Flow] Bắt đầu "+action);
            if(action=="fill")return await FillPrompt(request);
            if(Json.Text(request,"action")=="submit")return await Submit(request);
            var navigation=await Call("Page.getNavigationHistory",new {});
            var entries=Json.Array(navigation,"entries").ToList();
            int index=Json.Number(navigation,"currentIndex")??-1;
            if(index<0||index>=entries.Count||!Policy.FlowUrl(Json.Text(entries[index],"url")))throw new Exception("Hoàn tất đăng nhập và mở Flow trong hồ sơ này.");
            string source;
            using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("FlowBridge"))using(var reader=new StreamReader(stream))source=reader.ReadToEnd();
            var expression=source.Replace("__FLOWDESK_REQUEST__",Json.Stringify(request));
            var result=await Call("Runtime.evaluate",new
            {
                expression=expression,returnByValue=true,awaitPromise=true,userGesture=true
            });
            if(Json.Get(result,"exceptionDetails")!=null)throw new Exception("Flow thay đổi trang trong lúc thao tác. Kiểm tra lại giao diện rồi thử bước chưa gửi.");
            var value=Json.Get(Json.Get(result,"result"),"value");
            if(!Json.Bool(value,"ok")&&Json.Text(value,"code")=="ACCOUNT_FRAME_REQUIRED")
            {
                var tree=await Call("Page.getFrameTree",new {});
                var frames=new List<object>();
                CollectFrames(Json.Get(tree,"frameTree"),frames);
                foreach(var frame in frames)
                {
                    Uri frameUri;
                    if(!Uri.TryCreate(Json.Text(frame,"url"),UriKind.Absolute,out frameUri))continue;
                    if(!((frameUri.Host=="ogs.google.com"&&frameUri.AbsolutePath.Contains("account"))||(frameUri.Host=="accounts.google.com"&&frameUri.AbsolutePath.Contains("SignOutOptions"))))continue;
                    var world=await Call("Page.createIsolatedWorld",new
                    {
                        frameId=Json.Text(frame,"id"),worldName="FlowDeskAccountReader"
                    });
                    var innerExpression=source.Replace("__FLOWDESK_REQUEST__",Json.Stringify(new
                    {
                        action="account",accountFrame=true
                    }));
                    var inner=await Call("Runtime.evaluate",new
                    {
                        expression=innerExpression,contextId=Json.Number(world,"executionContextId"),returnByValue=true,awaitPromise=true
                    });
                    var innerValue=Json.Get(Json.Get(inner,"result"),"value");
                    if(Json.Bool(innerValue,"ok"))
                    {
                        value=innerValue;
                        break;
                    }
                }
            }
            if(!Json.Bool(value,"ok"))
            {
                if(Trace!=null)Trace("[Flow] Lỗi "+action+": "+Json.Text(value,"error"));
                throw new Exception(Json.Text(value,"error"));
            }
            if(Trace!=null&&action!="jobStatus")Trace("[Flow] Xong "+action+" | "+timer.ElapsedMilliseconds+" ms");
            return Json.Get(value,"data");
        }
        async Task<object> Submit(object request)
        {
            var jobId=Json.Text(request,"jobId");
            var prompt=Json.Text(request,"prompt");
            var point=await Bridge(new
            {
                action="prepareSubmit",jobId=jobId,prompt=prompt
            });
            await Call("Page.bringToFront",new {});
            var x=Convert.ToDouble(Json.Get(point,"x"));
            var y=Convert.ToDouble(Json.Get(point,"y"));
            await Call("Input.dispatchMouseEvent",new
            {
                type="mouseMoved",x=x,y=y
            });
            await Call("Input.dispatchMouseEvent",new
            {
                type="mousePressed",x=x,y=y,button="left",buttons=1,clickCount=1
            });
            await Call("Input.dispatchMouseEvent",new
            {
                type="mouseReleased",x=x,y=y,button="left",buttons=0,clickCount=1
            });
            return await Bridge(new
            {
                action="confirmSubmit",jobId=jobId
            });
        }
        async Task<object> FillPrompt(object request)
        {
            var point=await Bridge(new
            {
                action="prepareFill"
            });
            var x=Convert.ToDouble(Json.Get(point,"x"));
            var y=Convert.ToDouble(Json.Get(point,"y"));
            await Call("Input.dispatchMouseEvent",new
            {
                type="mousePressed",x=x,y=y,button="left",buttons=1,clickCount=1
            });
            await Call("Input.dispatchMouseEvent",new
            {
                type="mouseReleased",x=x,y=y,button="left",buttons=0,clickCount=1
            });
            await Call("Input.dispatchKeyEvent",new
            {
                type="rawKeyDown",key="a",code="KeyA",windowsVirtualKeyCode=65,modifiers=2
            });
            await Call("Input.dispatchKeyEvent",new
            {
                type="keyUp",key="a",code="KeyA",windowsVirtualKeyCode=65,modifiers=2
            });
            await Call("Input.insertText",new
            {
                text=Json.Text(request,"prompt")
            });
            return await Bridge(new
            {
                action="confirmFill",prompt=Json.Text(request,"prompt")
            });
        }
        public void Dispose()
        {
            socket.Dispose();
            mutex.Dispose();
        }
        static void CollectFrames(object tree,List<object> output)
        {
            var frame=Json.Get(tree,"frame");
            if(frame!=null)output.Add(frame);
            foreach(var child in Json.Array(tree,"childFrames"))CollectFrames(child,output);
        }
        public async Task UploadImage(string path,string slot)
        {
            if (slot == null) slot = "reference";
            var attachments=await Bridge(new
            {
                action="attachmentCount",slot=slot
            });
            events.RemoveAll(e=>Json.Text(e,"method")=="Page.fileChooserOpened");
            await Call("Page.enable",new {});
            await Call("Page.setInterceptFileChooserDialog",new
            {
                enabled=true
            });
            Exception uploadFailure=null;
            try
            {
                await Bridge(new
                {
                    action="upload",slot=slot
                });
                var chooser=events.LastOrDefault(e=>Json.Text(e,"method")=="Page.fileChooserOpened");
                if(chooser==null)
                {
                    await Call("Runtime.evaluate",new
                    {
                        expression="1",returnByValue=true
                    });
                    chooser=events.LastOrDefault(e=>Json.Text(e,"method")=="Page.fileChooserOpened");
                }
                if(chooser==null)throw new Exception("Flow chưa mở bộ chọn tệp. Thêm ảnh trực tiếp trong Chrome.");
                var node=Json.Number(Json.Get(chooser,"params"),"backendNodeId");
                if(!node.HasValue)throw new Exception("Chrome chưa cung cấp ô tải tệp.");
                await Call("DOM.setFileInputFiles",new
                {
                    files=new[]
                    {
                        Path.GetFullPath(path)
                    },
                    backendNodeId=node.Value
                });
                await Bridge(new
                {
                    action="finishUpload",slot=slot,initialCount=Json.Number(attachments,"count")??0
                });
            }
            catch(Exception error)
            {
                uploadFailure=error;
            }
            await Call("Page.setInterceptFileChooserDialog",new
            {
                enabled=false
            });
            if(uploadFailure!=null)System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(uploadFailure).Throw();
        }
    }

    public class BrowserManager
    {
        readonly Store store;
        public BrowserManager(Store store)
        {
            this.store=store;
        }
        public static string FindBrowser()
        {
            var paths=new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Microsoft","Edge","Application","msedge.exe")
            };
            return paths.FirstOrDefault(File.Exists);
        }
        public static bool ProfileInUse(string profile)
        {
            foreach(var name in new[]
            {
                "Default/LOCK","Default/History","Default/Network/Cookies"
            })
            {
                var file=Path.Combine(profile,name.Replace('/',Path.DirectorySeparatorChar));
                if(!File.Exists(file))continue;
                try
                {
                    using(var f=File.Open(file,FileMode.Open,FileAccess.Read,FileShare.None))
                    {
                    }
                }
                catch(IOException)
                {
                    return true;
                }
            }
            return false;
        }
        public static string LoginArguments(string profile)
        {
            return "--user-data-dir=\""+Path.GetFullPath(profile)+"\" --disable-blink-features=AutomationControlled --exclude-switches=enable-automation --disable-infobars --new-window https://labs.google/fx/tools/flow";
        }
        public async Task OpenLogin(Account a)
        {
            if(await IsOpen(a))await Close(a);
            var exe=FindBrowser();
            if(exe==null)throw new Exception("Cần Chrome hoặc Edge.");
            Directory.CreateDirectory(store.Profile(a));
            a.LoginStarted=true;
            a.LoginMode=true;
            a.Port=0;
            a.BrowserId="";
            a.Status="Đăng nhập xong: đóng Chrome hồ sơ để kết nối";
            store.Save();
            Process.Start(new ProcessStartInfo(exe,LoginArguments(store.Profile(a)))
            {
                UseShellExecute=false,WindowStyle=ProcessWindowStyle.Normal
            });
        }
        public async Task EnableControl(Account a)
        {
            if(ProfileInUse(store.Profile(a)))throw new Exception("Đóng cửa sổ Chrome của hồ sơ đã đăng nhập, rồi bấm Kết nối và đọc tài khoản.");
            a.LoginMode=false;
            store.Save();
            await Open(a);
        }
        async Task<object> Read(int port,string route)
        {
            using(var c=new LocalWebClient())
            {
                var download=c.DownloadStringTaskAsync("http://127.0.0.1:"+port+route);
                if(await Task.WhenAny(download,Task.Delay(3500))!=download)
                {
                    c.CancelAsync();
                    throw new Exception("Chrome chưa phản hồi trong 3,5 giây.");
                }
                return Json.Codec.DeserializeObject(await download);
            }
        }
        public async Task<bool> IsOpen(Account a)
        {
            if(a.Port<1024||String.IsNullOrEmpty(a.BrowserId))return false;
            try
            {
                var v=await Read(a.Port,"/json/version");
                return Json.Text(v,"webSocketDebuggerUrl")==a.BrowserId;
            }
            catch
            {
                return false;
            }
        }
        public async Task Open(Account a)
        {
            if(a.LoginMode)throw new Exception("Đăng nhập xong hãy đóng cửa sổ hồ sơ rồi bấm Kết nối và đọc tài khoản.");
            if(await IsOpen(a))return;
            var activePortFile=Path.Combine(store.Profile(a),"DevToolsActivePort");
            if(File.Exists(activePortFile))
            {
                try
                {
                    var lines=File.ReadAllLines(activePortFile);
                    int existingPort;
                    if(lines.Length>=2&&Int32.TryParse(lines[0],out existingPort)&&existingPort>=1024&&existingPort<=65535)
                    {
                        var v=await Read(existingPort,"/json/version");
                        var id=Json.Text(v,"webSocketDebuggerUrl");
                        if(id=="ws://127.0.0.1:"+existingPort+lines[1])
                        {
                            a.Port=existingPort;
                            a.BrowserId=id;
                            store.Save();
                            return;
                        }
                    }
                }
                catch
                {
                }
            }
            var exe=FindBrowser();
            if(exe==null)throw new Exception("Cần Chrome hoặc Edge được cài trên máy.");
            var port=0;
            var profile=store.Profile(a);
            Directory.CreateDirectory(profile);
            var args="--user-data-dir=\""+profile+"\" --remote-debugging-address=127.0.0.1 --remote-debugging-port="+port+" --no-first-run --no-default-browser-check --disable-blink-features=AutomationControlled --exclude-switches=enable-automation --disable-infobars --new-window https://labs.google/fx/tools/flow";
            Process.Start(new ProcessStartInfo(exe,args)
            {
                UseShellExecute=false,WindowStyle=ProcessWindowStyle.Normal
            });
            string lastFailure="";
            var startDeadline=DateTime.UtcNow.AddSeconds(20);
            while(DateTime.UtcNow<startDeadline)
            {
                try
                {
                    if(File.Exists(activePortFile))
                    {
                        var lines=File.ReadAllLines(activePortFile);
                        if(lines.Length>0)Int32.TryParse(lines[0],out port);
                    }
                    if(port>=1024&&port<=65535)
                    {
                        var v=await Read(port,"/json/version");
                        var id=Json.Text(v,"webSocketDebuggerUrl");
                        if(id.Length>0)
                        {
                            a.Port=port;
                            a.BrowserId=id;
                            a.Status="Đã mở; đăng nhập trong Chrome";
                            store.Save();
                            return;
                        }
                    }
                }
                catch(Exception e)
                {
                    lastFailure=e.GetBaseException().Message;
                }
                await Task.Delay(400);
            }
            throw new Exception("Không kết nối được hồ sơ Chrome tại 127.0.0.1:"+port+". Nguyên nhân: "+lastFailure);
        }
        public async Task<Cdp> Connect(Account a)
        {
            if(!await IsOpen(a))await Open(a);
            var pages=(await Read(a.Port,"/json/list")) as object[] ?? new object[0];
            var targets=pages.Where(p=>Json.Text(p,"type")=="page"&&Policy.FlowUrl(Json.Text(p,"url"))&&!jobTargets.Contains(Json.Text(p,"id"))).ToList();
            if(targets.Count==0)targets=pages.Where(p=>Json.Text(p,"type")=="page"&&Policy.FlowUrl(Json.Text(p,"url"))).ToList();
            if(targets.Count==0)throw new Exception("Đăng nhập Google và mở Flow trong cửa sổ hồ sơ này.");
            if(targets.Count>1)targets=targets.OrderBy(p=>store.Data.Queue.Any(q=>q.Url==Json.Text(p,"url"))?1:0).Take(1).ToList();
            var client=new Cdp();
            try
            {
                await client.Connect(Json.Text(targets[0],"webSocketDebuggerUrl"));
                return client;
            }
            catch
            {
                client.Dispose();
                throw;
            }
        }
        readonly Dictionary<string,SemaphoreSlim> jobOpenLocks=new Dictionary<string,SemaphoreSlim>();
        readonly HashSet<string> jobTargets=new HashSet<string>();
        public async Task<Cdp> ConnectJob(Account a,string projectUrl)
        {
            SemaphoreSlim gate;
            if(!jobOpenLocks.TryGetValue(a.Id,out gate))
            {
                gate=new SemaphoreSlim(1,1);
                jobOpenLocks.Add(a.Id,gate);
            }
            await gate.WaitAsync();
            try
            {
                if(a.LoginMode)throw new Exception("Đóng Chrome đăng nhập và kết nối tài khoản trước khi chạy job.");
                if(!await IsOpen(a))await Open(a);
                string targetId=null;
                var pages=(await Read(a.Port,"/json/list")) as object[] ?? new object[0];
                if(!String.IsNullOrWhiteSpace(projectUrl))
                {
                    if(!Policy.FlowUrl(projectUrl))throw new Exception("URL dự án của job không hợp lệ.");
                    var existing=pages.Where(p=>Json.Text(p,"type")=="page"&&Json.Text(p,"url")==projectUrl).ToList();
                    if(existing.Count>1)throw new Exception("Có nhiều tab của cùng dự án job; giữ một tab trước khi kiểm tra.");
                    if(existing.Count==1)targetId=Json.Text(existing[0],"id");
                }
                if(targetId==null)
                {
                    using(var control=new Cdp())
                    {
                        await control.Connect(a.BrowserId);
                        var created=await control.Call("Target.createTarget",new
                        {
                            url=String.IsNullOrWhiteSpace(projectUrl)?"https://flow.google.com/":projectUrl
                        });
                        targetId=Json.Text(created,"targetId");
                    }
                }
                jobTargets.Add(targetId);
                for(int i=0;i<40;i++)
                {
                    pages=(await Read(a.Port,"/json/list")) as object[] ?? new object[0];
                    var target=pages.SingleOrDefault(p=>Json.Text(p,"id")==targetId&&Policy.FlowUrl(Json.Text(p,"url")));
                    if(target!=null)
                    {
                        var client=new Cdp();
                        try
                        {
                            await client.Connect(Json.Text(target,"webSocketDebuggerUrl"));
                            await WaitForJobPage(client);
                            return client;
                        }
                        catch
                        {
                            client.Dispose();
                            throw;
                        }
                    }
                    await Task.Delay(250);
                }
                throw new Exception("Tab riêng của job chưa tải Flow; thử lại bước chưa gửi.");
            }
            finally
            {
                gate.Release();
            }
        }
        static async Task WaitForJobPage(Cdp client)
        {
            for(int attempt=0;attempt<100;attempt++)
            {
                var history=await client.Call("Page.getNavigationHistory",new {});
                var entries=Json.Array(history,"entries").ToList();
                var current=Json.Number(history,"currentIndex")??-1;
                if(current>=0&&current<entries.Count&&Policy.FlowUrl(Json.Text(entries[current],"url")))
                {
                    var state=await client.Call("Runtime.evaluate",new
                    {
                        expression="document.readyState !== 'loading' && !!document.querySelector('.header-user-button,flow-header-user-icon')",returnByValue=true
                    });
                    if(Json.Bool(Json.Get(state,"result"),"value"))return;
                }
                await Task.Delay(250);
            }
            throw new Exception("Tab của job chưa tải xong ứng dụng Flow sau 25 giây.");
        }
        public async Task Close(Account a)
        {
            if(a.LoginMode)return;
            if(!await IsOpen(a))return;
            using(var client=new Cdp())
            {
                await client.Connect(a.BrowserId);
                try
                {
                    await client.Call("Browser.close",new {});
                }
                catch
                {
                }
            }
            a.Port=0;
            a.BrowserId="";
            store.Save();
        }
        public async Task CloseJobPage(Account a,string url)
        {
            if(String.IsNullOrWhiteSpace(url)||!Policy.FlowUrl(url)||!await IsOpen(a))return;
            var pages=(await Read(a.Port,"/json/list")) as object[]??new object[0];
            var targets=pages.Where(p=>Json.Text(p,"type")=="page"&&Json.Text(p,"url")==url).ToList();
            if(targets.Count!=1)return;
            using(var control=new Cdp())
            {
                await control.Connect(a.BrowserId);
                await control.Call("Target.closeTarget",new
                {
                    targetId=Json.Text(targets[0],"id")
                });
            }
        }
    }

    public static class ModelMatch
    {
        public static string Key(string name)
        {
            return new string((name??"").Where(Char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
        }
        public static string Resolve(IEnumerable<string> names,string desired)
        {
            return names.SingleOrDefault(n=>Key(n)==Key(desired));
        }
    }

    public static class AccountRefresh
    {
        public static void Apply(Account a,object data)
        {
            var email=Json.Text(data,"email");
            if(String.IsNullOrWhiteSpace(email))throw new Exception("Flow chưa trả email.");
            a.Email=email;
            a.Plan=Json.Text(data,"plan");
            a.Credits=Json.Number(data,"credits");
            a.Evidence=Json.Text(data,"evidence");
            a.CheckedUtc=DateTime.UtcNow;
            a.Status=a.Plan=="Unknown"||!a.Credits.HasValue?"Đã đọc email; gói/credit chưa rõ":"Hoạt động — đã xác minh từ Flow";
        }
        public static async Task Read(Store store,BrowserManager browser,Account a)
        {
            if(a.LoginMode)await browser.EnableControl(a);
            var deadline=DateTime.UtcNow.AddSeconds(25);
            Exception failure=null;
            while(DateTime.UtcNow<deadline)
            {
                try
                {
                    using(var c=await browser.Connect(a))
                    {
                        var d=await c.Bridge(new
                        {
                            action="account"
                        });
                        Apply(a,d);
                        store.Save();
                        return;
                    }
                }
                catch(Exception e)
                {
                    failure=e;
                }
                await Task.Delay(1000);
            }
            a.CheckedUtc=DateTime.MinValue;
            a.Status="Lỗi đọc tài khoản: "+(failure==null?"Chưa có phản hồi":failure.Message);
            store.Save();
            throw new Exception(a.Status);
        }
    }

    public static class JobPolicy
    {
        public static bool Eligible(Account a,StudioTask q)
        {
            return a.LoginStarted&&a.Enabled&&(q.Kind=="image"?a.Images:a.Videos)&&(String.IsNullOrEmpty(q.AccountId)||a.Id==q.AccountId);
        }
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

    public static class JobRevision
    {
        public static Account NextAccount(IList<Account> accounts,string currentId,string kind)
        {
            var current=accounts.ToList().FindIndex(a=>a.Id==currentId);
            if(current<0)return null;
            return accounts.Skip(current+1).FirstOrDefault(a=>a.LoginStarted&&a.Enabled&&(kind=="image"?a.Images:a.Videos)&&!String.IsNullOrWhiteSpace(a.Email));
        }
        public static string ExecutionKey(StudioTask q)
        {
            return String.IsNullOrEmpty(q.ExecutionId)?q.Id:q.ExecutionId;
        }
        public static void RetryInPlace(StudioTask q)
        {
            if(q.Attempts==null)q.Attempts=new List<JobAttempt>();
            q.Attempts.Add(new JobAttempt
            {
                ExecutionId=ExecutionKey(q),AccountId=q.AccountId,Prompt=RunningPrompt(q),State=q.State,Note=q.Note,Url=q.Url,Results=q.Results.ToArray()
            });
            q.ExecutionId=Guid.NewGuid().ToString("N");
            q.Submitted=false;
            q.SentPrompt=null;
            q.State="Hàng đợi";
            q.Note="";
            q.Url="";
            q.Progress=null;
            q.Results=new string[0];
            q.Baseline=new string[0];
            q.BaselineCards=new string[0];
            q.AutoDraft=false;
            q.Folder="";
        }
        public static string RunningPrompt(StudioTask q)
        {
            return q.SentPrompt??q.Prompt;
        }
    }

    public static class DraftJobs
    {
        public static void Sync(Database db,string kind,string[] prompts,Func<string,StudioTask> create)
        {
            var drafts=db.Queue.Where(q=>q.Kind==kind&&q.AutoDraft&&!q.Submitted&&q.State=="Hàng đợi").ToList();
            for(int i=0;i<prompts.Length;i++)
            {
                if(i<drafts.Count)drafts[i].Prompt=prompts[i];
                else
                {
                    var q=create(prompts[i]);
                    q.AutoDraft=true;
                    db.Queue.Add(q);
                }
            }
            for(int i=prompts.Length;i<drafts.Count;i++)db.Queue.Remove(drafts[i]);
        }
    }

    public class StudioCombo:ComboBox
    {
        public StudioCombo()
        {
            DrawMode=DrawMode.OwnerDrawFixed;
            ItemHeight=23;
        }
        protected override void OnDrawItem(DrawItemEventArgs e)
        {
            using(var b=new SolidBrush((e.State&DrawItemState.Selected)!=0?Color.FromArgb(91,103,210):Color.FromArgb(35,39,47)))e.Graphics.FillRectangle(b,e.Bounds);
            string text=e.Index>=0?GetItemText(Items[e.Index]):Text;
            TextRenderer.DrawText(e.Graphics,text,Font,e.Bounds,Color.FromArgb(222,227,237),TextFormatFlags.VerticalCenter|TextFormatFlags.Left);
        }
    }

    public class StudioTask
    {
        public string Id { get; set; }
        public string Kind { get; set; }
        public string Mode { get; set; }
        public string Model { get; set; }
        public string Ratio { get; set; }
        public string Count { get; set; }
        public string ExecutionId { get; set; }
        public List<JobAttempt> Attempts { get; set; }
        public bool AutoFailoverUsed { get; set; }
        public string SentPrompt { get; set; }
        public string ParentJobId { get; set; }
        public bool AutoDraft { get; set; }
        public string StartImage { get; set; }
        public string EndImage { get; set; }
        public string Prompt { get; set; }
        public string[] References { get; set; }
        public string State { get; set; }
        public string Note { get; set; }
        public string AccountId { get; set; }
        public string Folder { get; set; }
        public string[] BaselineCards { get; set; }
        public string[] Results { get; set; }
        public string[] Baseline { get; set; }
        public int? Progress { get; set; }
        public bool Submitted { get; set; }
        public string Url { get; set; }

        public StudioTask()
        {
            Id=Guid.NewGuid().ToString("N");
            State="Hàng đợi";
            References=new string[0];
            Results=new string[0];
            Baseline=new string[0];
            Note="";
            AccountId="";
        }
    }

    public class StudioButton:Button
    {
        public Color EndColor=Color.Empty;
        protected override void OnPaint(PaintEventArgs e)
        {
            var r=ClientRectangle;
            using(var brush=new LinearGradientBrush(r,BackColor,EndColor==Color.Empty?BackColor:EndColor,0f))e.Graphics.FillRectangle(brush,r);
            using(var pen=new Pen(Focused?Color.FromArgb(124,133,255):Color.FromArgb(58,64,76)))e.Graphics.DrawRectangle(pen,0,0,r.Width-1,r.Height-1);
            TextRenderer.DrawText(e.Graphics,Text,Font,r,Enabled?ForeColor:Color.FromArgb(126,139,149),TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter);
        }
    }

    // ORIGINAL COMPLETE STUDIOFORM - GIAO DIỆN CHUẨN ĐẦY ĐỦ 100% CỦA FLOWDESK
    public class StudioForm:Form
    {
        readonly Store store;
        readonly BrowserManager browser;
        readonly Color bg=Color.FromArgb(24,27,34),card=Color.FromArgb(35,39,47),ink=Color.FromArgb(222,227,237),muted=Color.FromArgb(145,153,174);
        Color accent=Color.FromArgb(22,203,228);
        string activeKind="video";
        bool running,paused,stop,refreshing;
        int active;
        readonly HashSet<string> leased=new HashSet<string>();
        readonly Dictionary<string,DateTime> cooldowns=new Dictionary<string,DateTime>();
        readonly ComboBox model=new StudioCombo(),ratio=new StudioCombo(),concurrent=new StudioCombo(),delay=new StudioCombo(),count=new StudioCombo(),split=new StudioCombo(),mode=new StudioCombo(),accountChoice=new StudioCombo();
        readonly TextBox prompts=new TextBox(),folder=new TextBox(),referenceSummary=new TextBox();
        readonly Label stats=new Label(),status=new Label(),empty=new Label(),taskHeader=new Label();
        readonly DataGridView grid=new DataGridView();
        readonly FlowLayoutPanel navigation=new FlowLayoutPanel();
        readonly Panel work=new Panel();
        readonly TextBox logs=new TextBox();
        readonly CheckBox samePrompt=new CheckBox();
        readonly List<string> refs=new List<string>();
        StudioButton imageNav,videoNav,runButton,pauseButton,stopButton;
        readonly List<Control> editControls=new List<Control>();
        readonly Timer ticker=new Timer();
        readonly HashSet<string> pendingReruns=new HashSet<string>();

        public StudioForm(Store value)
        {
            store=value;
            browser=new BrowserManager(store);
            Text="FlowDesk Studio 1.2.14 • Flow Ảnh & Flow Video (Bypass reCAPTCHA)";
            Size=new Size(1360,850);
            MinimumSize=new Size(1220,790);
            StartPosition=FormStartPosition.CenterScreen;
            Font=new Font("Segoe UI",9);
            BackColor=bg;
            ForeColor=ink;
            AutoScaleMode=AutoScaleMode.Dpi;

            var root=new TableLayoutPanel
            {
                Dock=DockStyle.Fill,ColumnCount=3,RowCount=2,Padding=new Padding(8)
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,148));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,390));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute,32));
            root.RowStyles.Add(new RowStyle(SizeType.Percent,100));
            Controls.Add(root);

            navigation.Dock=DockStyle.Fill;
            navigation.FlowDirection=FlowDirection.TopDown;
            navigation.WrapContents=false;
            navigation.Padding=new Padding(3,8,3,0);
            root.Controls.Add(navigation,0,0);
            root.SetRowSpan(navigation,2);

            navigation.Controls.Add(new Label
            {
                Text="FLOWDESK\nSTUDIO",Font=new Font("Segoe UI",12,FontStyle.Bold),ForeColor=Color.FromArgb(116,126,255),Size=new Size(135,63)
            });

            imageNav=Nav("▧ Flow Ảnh",()=>Switch("image"));
            videoNav=Nav("▷ Flow Video",()=>Switch("video"));
            Nav("☷ Hàng chờ",()=>{ grid.Focus(); return Task.FromResult(0); });
            Nav("▣ Kho kết quả",()=>OpenFolder(store.Data.OutputFolder));
            Nav("♙ Tài khoản Flow",()=>Accounts());
            Nav("≡ Log chi tiết",()=>ShowLogs());
            Nav("⚙ Cài đặt",()=>Accounts());

            var banner=new Label
            {
                Text="FlowDesk Studio • Đăng nhập hồ sơ tại Cài đặt → Tài khoản Flow; gõ prompt để tự tạo hàng job; chọn ảnh ngay trên mỗi hàng.",
                BackColor=Color.FromArgb(255,242,200),ForeColor=Color.FromArgb(83,68,33),Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleLeft,Padding=new Padding(12,0,0,0)
            };
            root.Controls.Add(banner,1,0);
            root.SetColumnSpan(banner,2);

            var config=new TableLayoutPanel
            {
                Dock=DockStyle.Fill,ColumnCount=1,RowCount=7,Padding=new Padding(8,8,8,0)
            };
            int[] heights={52,278,132,40,0,43,47};
            for(int i=0;i<7;i++)config.RowStyles.Add(i==4?new RowStyle(SizeType.Percent,100):new RowStyle(SizeType.Absolute,heights[i]));
            root.Controls.Add(config,1,1);

            stats.Dock=DockStyle.Fill;
            stats.TextAlign=ContentAlignment.MiddleCenter;
            stats.BackColor=card;
            stats.Font=new Font("Segoe UI",10,FontStyle.Bold);
            stats.ForeColor=accent;
            config.Controls.Add(stats,0,0);

            var basic=Group("Cấu hình cơ bản",278);
            config.Controls.Add(basic,0,1);
            var body=(Panel)basic.Tag;
            Field(body,"Model",model,8,4,217);
            Field(body,"Tỷ lệ",ratio,232,4,127);
            Fill(model,new[]{"Veo 3.1 Fast","Veo 3.1 Lite","Veo 3.1 Quality","Omni 1.1 Flash"});
            Fill(ratio,new[]{"9:16","16:9"});

            Field(body,"Số hàng đồng thời",concurrent,8,60,170);
            Field(body,"Chờ giữa các hàng",delay,188,60,171);
            Fill(concurrent,new[]{"1","2","3","4"});
            Fill(delay,new[]{"5–10 giây","10–20 giây","20–30 giây"});
            delay.SelectedIndex=1;

            Field(body,"Số kết quả",count,8,116,92);
            Fill(count,new[]{"x1","x2","x3","x4"});
            Field(body,"Tài khoản",accountChoice,110,116,249);
            accountChoice.DisplayMember="Name";

            body.Controls.Add(Button("Dự án mới",async()=>
            {
                var a=ChosenAccount();
                using(var c=await browser.Connect(a))
                await c.Bridge(new { action="newProject" });
            },8,173,112));
            body.Controls.Add(Button("Thư mục lưu…",ChooseFolder,125,173,112));

            folder.SetBounds(8,213,350,25);
            StyleText(folder);
            folder.ReadOnly=true;
            body.Controls.Add(folder);
            store.Data.OutputFolder=String.IsNullOrWhiteSpace(store.Data.OutputFolder)?Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Results"):store.Data.OutputFolder;
            folder.Text=store.Data.OutputFolder;

            var advanced=Group("Cấu hình nâng cao / Ảnh tham chiếu",132);
            config.Controls.Add(advanced,0,2);
            var adv=(Panel)advanced.Tag;
            mode.SetBounds(8,4,350,27);
            StyleCombo(mode);
            Fill(mode,new[]{"Văn bản / Khung hình → Video","Thành phần → Video"});
            adv.Controls.Add(mode);
            adv.Controls.Add(Button("+ Ảnh tham chiếu",AddReferences,8,38,155));
            adv.Controls.Add(Button("Bỏ ảnh",()=>
            {
                refs.Clear();
                referenceSummary.Text="Chưa chọn ảnh";
                return Task.FromResult(0);
            },172,38,83));
            referenceSummary.SetBounds(8,73,350,23);
            StyleText(referenceSummary);
            referenceSummary.ReadOnly=true;
            referenceSummary.Text="Chưa chọn ảnh";
            adv.Controls.Add(referenceSummary);

            var importRow=new FlowLayoutPanel{ Dock=DockStyle.Fill,WrapContents=false };
            var import=Button("Nhập tệp (TXT, Excel)",ImportPrompts,0,0,175);
            import.EndColor=Color.FromArgb(129,72,166);
            importRow.Controls.Add(import);
            StyleCombo(split);
            split.Width=177;
            Fill(split,new[]{"1 hàng / 1 prompt","Đoạn trống / 1 prompt"});
            importRow.Controls.Add(split);
            config.Controls.Add(importRow,0,3);

            var promptPanel=new TableLayoutPanel{ Dock=DockStyle.Fill,RowCount=2 };
            promptPanel.RowStyles.Add(new RowStyle(SizeType.Percent,100));
            promptPanel.RowStyles.Add(new RowStyle(SizeType.Absolute,28));
            StyleText(prompts);
            prompts.Multiline=true;
            prompts.ScrollBars=ScrollBars.Vertical;
            prompts.Dock=DockStyle.Fill;
            promptPanel.Controls.Add(prompts);
            samePrompt.Text="Dùng một prompt cho tất cả ảnh";
            samePrompt.Dock=DockStyle.Fill;
            promptPanel.Controls.Add(samePrompt,0,1);
            config.Controls.Add(promptPanel,0,4);

            var queueRow=new FlowLayoutPanel{ Dock=DockStyle.Fill,WrapContents=false };
            queueRow.Controls.Add(new Label{ Text="Gõ prompt → tự tạo hàng job",ForeColor=muted,Size=new Size(192,33),TextAlign=ContentAlignment.MiddleLeft });
            config.Controls.Add(queueRow,0,5);

            var runRow=new FlowLayoutPanel{ Dock=DockStyle.Fill,WrapContents=false };
            runButton=Button("CHẠY NGAY",StartRun,0,0,158);
            runButton.BackColor=Color.FromArgb(14,164,147);
            runButton.EndColor=Color.FromArgb(34,229,112);
            runButton.Font=new Font(Font,FontStyle.Bold);
            pauseButton=Button("TẠM DỪNG",()=>
            {
                paused=!paused;
                pauseButton.Text=paused?"TIẾP TỤC":"TẠM DỪNG";
                return Task.FromResult(0);
            },0,0,95);
            stopButton=Button("DỪNG",()=>
            {
                stop=true;
                paused=false;
                return Task.FromResult(0);
            },0,0,95);
            runRow.Controls.Add(runButton);
            runRow.Controls.Add(pauseButton);
            runRow.Controls.Add(stopButton);
            config.Controls.Add(runRow,0,6);

            work.Dock=DockStyle.Fill;
            work.Padding=new Padding(0,8,0,0);
            root.Controls.Add(work,2,1);

            var right=new TableLayoutPanel{ Dock=DockStyle.Fill,RowCount=4 };
            right.RowStyles.Add(new RowStyle(SizeType.Absolute,38));
            right.RowStyles.Add(new RowStyle(SizeType.Percent,100));
            right.RowStyles.Add(new RowStyle(SizeType.Absolute,36));
            right.RowStyles.Add(new RowStyle(SizeType.Absolute,28));
            work.Controls.Add(right);

            taskHeader.Text="Văn bản / Khung hình → Video | Hàng chờ tác vụ";
            taskHeader.ForeColor=accent;
            taskHeader.Font=new Font(Font,FontStyle.Bold);
            taskHeader.Dock=DockStyle.Fill;
            taskHeader.TextAlign=ContentAlignment.MiddleLeft;
            right.Controls.Add(taskHeader,0,0);

            StyleGrid(grid);
            grid.MultiSelect=true;
            grid.ReadOnly=false;
            grid.CellContentClick+=async(s,e)=>
            {
                if(e.RowIndex>=0&&e.ColumnIndex>=0&&new[]{"StartSlot","EndSlot","RefSlot"}.Contains(grid.Columns[e.ColumnIndex].Name))
                    await Guard(()=>PickJobImage(e.RowIndex,grid.Columns[e.ColumnIndex].Name));
            };
            grid.CellPainting+=PaintSlot;

            var gridPanel=new Panel{ Dock=DockStyle.Fill };
            gridPanel.Controls.Add(grid);
            empty.Text="Chưa có hàng nào\n\nGõ prompt bên trái để tự xuất hiện job";
            empty.TextAlign=ContentAlignment.MiddleCenter;
            empty.Font=new Font("Segoe UI",12,FontStyle.Bold);
            empty.ForeColor=muted;
            empty.BackColor=bg;
            gridPanel.Controls.Add(empty);
            gridPanel.Resize+=(s,e)=>empty.Bounds=new Rectangle(1,43,Math.Max(0,gridPanel.Width-2),Math.Max(0,gridPanel.Height-44));
            right.Controls.Add(gridPanel,0,1);

            var bottom=new FlowLayoutPanel{ Dock=DockStyle.Fill,WrapContents=false,AutoScroll=true };
            bottom.Controls.Add(Button("Xem",Inspect,0,0,53));
            bottom.Controls.Add(Button("Mở thư mục",()=>OpenFolder(SelectedTask().Folder),0,0,91));
            bottom.Controls.Add(Button("Xóa chọn",RemoveSelected,0,0,78));
            bottom.Controls.Add(Button("Chạy lỗi",RetryErrors,0,0,72));
            bottom.Controls.Add(Button("Chạy chọn",RunSelected,0,0,78));
            right.Controls.Add(bottom,0,2);

            status.Dock=DockStyle.Fill;
            status.AutoEllipsis=true;
            status.ForeColor=muted;
            right.Controls.Add(status,0,3);

            editControls.AddRange(new Control[]{ model,ratio,count,mode,concurrent,delay });

            RefreshAccounts();
            RefreshQueue();
            Switch("video");
            ticker.Interval=1000;
            ticker.Tick+=(s,e)=>RefreshStats();
            ticker.Start();

            prompts.TextChanged+=(sender,e)=>SyncDrafts();
            split.SelectedIndexChanged+=(sender,e)=>SyncDrafts();
            samePrompt.CheckedChanged+=(sender,e)=>SyncDrafts();
        }

        Panel Group(string caption,int height)
        {
            var p=new Panel{ Dock=DockStyle.Fill,BackColor=card,Margin=new Padding(0,7,0,0) };
            var h=new Label{ Text=" "+caption,Font=new Font(Font,FontStyle.Bold),BackColor=Color.FromArgb(51,55,64),ForeColor=ink,Dock=DockStyle.Top,Height=29,TextAlign=ContentAlignment.MiddleLeft };
            p.Controls.Add(h);
            var body=new Panel{ Dock=DockStyle.Fill };
            p.Controls.Add(body);
            body.BringToFront();
            p.Tag=body;
            return p;
        }
        void StyleText(TextBox t)
        {
            t.BackColor=card;
            t.ForeColor=ink;
            t.BorderStyle=BorderStyle.FixedSingle;
        }
        void StyleCombo(ComboBox c)
        {
            c.DropDownStyle=ComboBoxStyle.DropDownList;
            c.BackColor=card;
            c.ForeColor=ink;
            c.FlatStyle=FlatStyle.Flat;
        }
        void Fill(ComboBox c,string[] items)
        {
            c.Items.Clear();
            c.Items.AddRange(items);
            if(c.Items.Count>0)c.SelectedIndex=0;
        }
        void Field(Panel p,string label,ComboBox c,int x,int y,int width)
        {
            p.Controls.Add(new Label{ Text=label,ForeColor=muted,Bounds=new Rectangle(x,y,width,20) });
            c.SetBounds(x,y+21,width,27);
            StyleCombo(c);
            p.Controls.Add(c);
        }
        StudioButton Button(string text,Func<Task> action,int x,int y,int width)
        {
            var b=new StudioButton{ Text=text,BackColor=card,ForeColor=ink,FlatStyle=FlatStyle.Flat,Bounds=new Rectangle(x,y,width,33),Margin=new Padding(0,3,6,0) };
            b.Click+=async(s,e)=>await Guard(action);
            return b;
        }
        StudioButton Nav(string text,Func<Task> action)
        {
            var b=Button(text,action,0,0,132);
            b.Height=40;
            b.Margin=new Padding(0,0,0,8);
            navigation.Controls.Add(b);
            return b;
        }
        async Task Guard(Func<Task> action)
        {
            try
            {
                await action();
            }
            catch(Exception e)
            {
                MessageBox.Show(this,e.GetBaseException().Message,"FlowDesk",MessageBoxButtons.OK,MessageBoxIcon.Information);
            }
            finally
            {
                RefreshQueue();
            }
        }
        void StyleGrid(DataGridView g)
        {
            g.Dock=DockStyle.Fill;
            g.AllowUserToAddRows=false;
            g.AllowUserToDeleteRows=false;
            g.RowHeadersVisible=false;
            g.BackgroundColor=bg;
            g.BorderStyle=BorderStyle.FixedSingle;
            g.EnableHeadersVisualStyles=false;
            g.ColumnHeadersHeight=42;
            g.ColumnHeadersDefaultCellStyle.BackColor=card;
            g.ColumnHeadersDefaultCellStyle.ForeColor=ink;
            g.DefaultCellStyle.BackColor=bg;
            g.DefaultCellStyle.ForeColor=ink;
            g.DefaultCellStyle.SelectionBackColor=Color.FromArgb(47,61,80);
            g.DefaultCellStyle.SelectionForeColor=Color.White;
            g.GridColor=Color.FromArgb(55,61,72);
            g.RowTemplate.Height=92;
            g.SelectionMode=DataGridViewSelectionMode.FullRowSelect;
            g.AutoSizeColumnsMode=DataGridViewAutoSizeColumnsMode.Fill;
            g.DefaultCellStyle.WrapMode=DataGridViewTriState.True;
        }
        Task Switch(string kind)
        {
            if(running)throw new Exception("Dừng hàng chờ trước khi đổi chế độ.");
            activeKind=kind;
            taskHeader.Text=kind=="video"?"Văn bản / Khung hình → Video | Hàng chờ tác vụ":"Flow Ảnh | Ảnh tham chiếu | Hàng chờ tác vụ";
            accent=kind=="video"?Color.FromArgb(22,203,228):Color.FromArgb(127,120,255);
            imageNav.BackColor=kind=="image"?Color.FromArgb(106,87,234):card;
            videoNav.BackColor=kind=="video"?Color.FromArgb(82,112,235):card;
            imageNav.Invalidate();
            videoNav.Invalidate();
            Fill(model,kind=="video"?new[]{"Veo 3.1 Fast","Veo 3.1 Lite","Veo 3.1 Quality","Omni 1.1 Flash"}:new[]{"Nano Banana 2 Lite","Nano Banana 2.1","Nano Banana Pro"});
            Fill(mode,kind=="video"?new[]{"Văn bản / Khung hình → Video","Thành phần → Video"}:new[]{"Văn bản / Ảnh tham chiếu → Ảnh"});
            refs.Clear();
            referenceSummary.Text="Chưa chọn ảnh";
            RefreshQueue();
            return Task.FromResult(0);
        }
        void RefreshAccounts()
        {
            var id=(accountChoice.SelectedItem as Account);
            accountChoice.Items.Clear();
            accountChoice.Items.Add(new Account{ Id="auto",Name="Tự chọn tài khoản đủ quyền" });
            foreach(var a in store.Data.Accounts.Where(x=>x.LoginStarted))accountChoice.Items.Add(a);
            accountChoice.SelectedIndex=0;
            if(id!=null)for(int i=1;i<accountChoice.Items.Count;i++)if(((Account)accountChoice.Items[i]).Id==id.Id)accountChoice.SelectedIndex=i;
            RefreshStats();
        }
        Account ChosenAccount()
        {
            var a=accountChoice.SelectedItem as Account;
            if(a!=null&&a.Id!="auto")return a;
            var usable=store.Data.Accounts.Where(x=>x.LoginStarted&&x.Enabled&&(activeKind=="image"?x.Images:x.Videos)).ToList();
            var known=usable.FirstOrDefault(x=>!String.IsNullOrEmpty(x.Email));
            if(known!=null)return known;
            if(usable.Count>0)return usable[0];
            throw new Exception("Thêm tài khoản ở Cài đặt trước.");
        }
        Task ChooseFolder()
        {
            using(var d=new FolderBrowserDialog{ Description="Thư mục lưu kết quả",SelectedPath=store.Data.OutputFolder })
            if(d.ShowDialog(this)==DialogResult.OK)
            {
                store.Data.OutputFolder=d.SelectedPath;
                folder.Text=d.SelectedPath;
                store.Save();
            }
            return Task.FromResult(0);
        }
        Task AddReferences()
        {
            using(var d=new OpenFileDialog{ Multiselect=true,Filter="Ảnh|*.png;*.jpg;*.jpeg;*.webp" })
            if(d.ShowDialog(this)==DialogResult.OK)
            {
                refs.Clear();
                refs.AddRange(d.FileNames);
                SyncDrafts();
                foreach(var q in store.Data.Queue.Where(x=>x.Kind==activeKind&&x.AutoDraft&&!x.Submitted))q.References=refs.ToArray();
                store.Save();
                RefreshQueue();
                referenceSummary.Text=refs.Count+" ảnh: "+String.Join(", ",refs.Select(Path.GetFileName));
            }
            return Task.FromResult(0);
        }
        Task ImportPrompts()
        {
            using(var d=new OpenFileDialog{ Filter="Prompt TXT / CSV / Excel|*.txt;*.csv;*.xlsx" })
            if(d.ShowDialog(this)==DialogResult.OK)
            {
                prompts.Text=String.Join(Environment.NewLine+Environment.NewLine,PromptImport.Read(d.FileName));
                split.SelectedIndex=1;
            }
            return Task.FromResult(0);
        }
        public static string[] ParsePrompts(string value,bool paragraphs)
        {
            return (paragraphs?System.Text.RegularExpressions.Regex.Split(value.Replace("\r",""),@"\n\s*\n"):value.Replace("\r","").Split('\n')).Select(x=>x.Trim()).Where(x=>x.Length>0).ToArray();
        }
        StudioTask NewDraft(string text)
        {
            var a=accountChoice.SelectedItem as Account;
            return new StudioTask
            {
                Kind=activeKind,Mode=mode.Text,Model=model.Text,Ratio=ratio.Text,Count=count.Text,Prompt=text,References=refs.ToArray(),AccountId=a!=null&&a.Id!="auto"?a.Id:""
            };
        }
        void SyncDrafts()
        {
            if(refreshing)return;
            var values=ParsePrompts(prompts.Text,split.SelectedIndex==1);
            if(samePrompt.Checked&&refs.Count>0&&values.Length>0)values=Enumerable.Repeat(prompts.Text.Trim(),refs.Count).ToArray();
            DraftJobs.Sync(store.Data,activeKind,values,NewDraft);
            foreach(var q in store.Data.Queue.Where(x=>x.Kind==activeKind&&x.AutoDraft&&!x.Submitted&&x.State=="Hàng đợi"))
            {
                q.Model=model.Text;
                q.Ratio=ratio.Text;
                q.Count=count.Text;
                q.Mode=q.Kind=="video"&&(!String.IsNullOrWhiteSpace(q.StartImage)||!String.IsNullOrWhiteSpace(q.EndImage))?"Văn bản / Khung hình → Video":mode.Text;
            }
            store.Save();
            RefreshQueue();
        }
        Task PickJobImage(int rowIndex,string slot)
        {
            var q=store.Data.Queue.Single(x=>x.Id==Convert.ToString(grid.Rows[rowIndex].Cells["Id"].Value));
            if(q.Submitted||q.State=="Đang chạy")throw new Exception("Chỉ đổi ảnh ở job chưa gửi.");
            using(var d=new OpenFileDialog
            {
                Title=slot=="StartSlot"?"Ảnh đầu":slot=="EndSlot"?"Ảnh cuối":"Ảnh tham chiếu",Multiselect=slot=="RefSlot",Filter="Ảnh|*.png;*.jpg;*.jpeg;*.webp"
            })
            if(d.ShowDialog(this)==DialogResult.OK)
            {
                if(slot=="StartSlot")
                {
                    q.StartImage=d.FileName;
                    q.Mode="Văn bản / Khung hình → Video";
                }
                else if(slot=="EndSlot")
                {
                    q.EndImage=d.FileName;
                    q.Mode="Văn bản / Khung hình → Video";
                }
                else q.References=d.FileNames;
                store.Save();
            }
            return Task.FromResult(0);
        }
        void PaintSlot(object sender,DataGridViewCellPaintingEventArgs e)
        {
            if(e.RowIndex<0||e.ColumnIndex<0)return;
            var slot=grid.Columns[e.ColumnIndex].Name;
            if(!new[]{"StartSlot","EndSlot","RefSlot"}.Contains(slot))return;
            var q=store.Data.Queue.Single(x=>x.Id==Convert.ToString(grid.Rows[e.RowIndex].Cells["Id"].Value));
            var path=slot=="StartSlot"?q.StartImage:slot=="EndSlot"?q.EndImage:q.References.FirstOrDefault();
            if(String.IsNullOrWhiteSpace(path)||!File.Exists(path))return;
            e.PaintBackground(e.CellBounds,true);
            try
            {
                using(var img=Image.FromFile(path))
                {
                    var r=new Rectangle(e.CellBounds.X+5,e.CellBounds.Y+5,e.CellBounds.Width-10,e.CellBounds.Height-24);
                    e.Graphics.DrawImage(img,r);
                    TextRenderer.DrawText(e.Graphics,Path.GetFileName(path),Font,new Rectangle(e.CellBounds.X+3,e.CellBounds.Bottom-19,e.CellBounds.Width-6,18),ink,TextFormatFlags.EndEllipsis);
                    e.Handled=true;
                }
            }
            catch
            {
            }
        }
        void ImageColumns()
        {
            foreach(var name in new[]{"StartSlot","EndSlot","RefSlot"})
            if(!grid.Columns.Contains(name))grid.Columns.Add(new DataGridViewButtonColumn
            {
                Name=name,HeaderText=name=="StartSlot"?"Ảnh đầu":name=="EndSlot"?"Ảnh cuối":"Ảnh tham chiếu",Text=name=="StartSlot"?"+ Bắt đầu":name=="EndSlot"?"+ Kết thúc":"+ Thêm ảnh",UseColumnTextForButtonValue=true,FlatStyle=FlatStyle.Flat
            });
            grid.Columns["StartSlot"].Visible=activeKind=="video";
            grid.Columns["EndSlot"].Visible=activeKind=="video";
            grid.Columns["RefSlot"].Visible=activeKind=="image"||mode.Text.StartsWith("Thành phần");
        }
        void RefreshStats()
        {
            stats.Text="▷ "+active+" đang chạy ◷ "+store.Data.Queue.Count(q=>q.State=="Hàng đợi")+" chờ\n✓ "+store.Data.Queue.Count(q=>q.State=="Hoàn tất")+" xong ⚠ "+store.Data.Queue.Count(q=>q.State=="Lỗi")+" lỗi ♙ "+store.Data.Accounts.Count(a=>a.LoginStarted&&a.Enabled)+" TK";
            pauseButton.Enabled=running;
            stopButton.Enabled=running;
            runButton.Enabled=!running;
        }
        void RefreshQueue()
        {
            if(refreshing||grid.IsCurrentCellInEditMode)return;
            refreshing=true;
            var selected=grid.CurrentRow==null?"":Convert.ToString(grid.CurrentRow.Cells["Id"].Value);
            grid.DataSource=store.Data.Queue.Where(q=>q.Kind==activeKind).Select(q=>new
            {
                Id=q.Id,TacVu=q.Id.Substring(0,6)+"\n"+q.Model,Prompt=q.Prompt,TrangThai=q.State
            }).ToList();
            if(grid.Columns.Contains("Id"))grid.Columns["Id"].Visible=false;
            ImageColumns();
            empty.Visible=grid.Rows.Count==0;
            refreshing=false;
            RefreshStats();
        }
        StudioTask SelectedTask()
        {
            if(grid.CurrentRow==null)throw new Exception("Chọn một tác vụ.");
            return store.Data.Queue.Single(q=>q.Id==Convert.ToString(grid.CurrentRow.Cells["Id"].Value));
        }
        HashSet<string> SelectedIds()
        {
            return new HashSet<string>(grid.SelectedRows.Cast<DataGridViewRow>().Select(r=>Convert.ToString(r.Cells["Id"].Value)));
        }
        Task RemoveSelected()
        {
            var ids=SelectedIds();
            store.Data.Queue.RemoveAll(q=>ids.Contains(q.Id));
            store.Save();
            return Task.FromResult(0);
        }
        Task RetryErrors()
        {
            foreach(var q in store.Data.Queue.Where(q=>q.State=="Lỗi"&&!q.Submitted))
            {
                q.State="Hàng đợi";
                q.Note="";
            }
            store.Save();
            return StartRun();
        }
        Task StartRun()
        {
            SyncDrafts();
            return ExecuteQueue(null);
        }
        async Task ExecuteQueue(HashSet<string> only)
        {
            if(running)return;
            var rows=store.Data.Queue.Where(q=>q.Kind==activeKind&&q.State=="Hàng đợi"&&(only==null||only.Contains(q.Id))).ToList();
            if(rows.Count==0)throw new Exception("Không có tác vụ đang chờ.");
            foreach(var draft in store.Data.Queue.Where(x=>x.Kind==activeKind&&x.AutoDraft))draft.AutoDraft=false;
            refreshing=true;
            prompts.Clear();
            refreshing=false;
            running=true;
            paused=false;
            stop=false;
            foreach(var e in editControls)e.Enabled=false;
            var workers=new List<Task>();
            int limit=1;
            Int32.TryParse(concurrent.Text, out limit);
            if (limit <= 0) limit = 1;
            try
            {
                foreach(var q in rows)
                {
                    while(!stop&&(paused||workers.Count>=limit))
                    {
                        if(workers.Count>0)
                        {
                            await Task.WhenAny(workers.Concat(new[]{ Task.Delay(250) }));
                            workers.RemoveAll(t=>t.IsCompleted);
                        }
                        else await Task.Delay(250);
                    }
                    if(stop)break;
                    var available=store.Data.Accounts.Where(a=>JobPolicy.Eligible(a,q)).OrderByDescending(a=>a.CheckedUtc).ToList();
                    while(available.Count==0&&workers.Count>0&&!stop)
                    {
                        await Task.WhenAny(workers);
                        workers.RemoveAll(t=>t.IsCompleted);
                        available=store.Data.Accounts.Where(a=>JobPolicy.Eligible(a,q)).ToList();
                    }
                    if(stop)break;
                    if(available.Count==0)
                    {
                        q.State="Lỗi";
                        q.Note="Không có hồ sơ được bật cho tác vụ này.";
                        store.Save();
                        continue;
                    }
                    var selectedAccount=available.FirstOrDefault(x=>!String.IsNullOrEmpty(x.Email))??available[0];
                    workers.Add(ProcessTask(q,selectedAccount));
                }
                await Task.WhenAll(workers);
            }
            finally
            {
                running=false;
                active=0;
                leased.Clear();
                foreach(var e in editControls)e.Enabled=true;
                pauseButton.Text="TẠM DỪNG";
                store.Save();
                RefreshQueue();
            }
        }
        async Task ProcessTask(StudioTask q,Account a)
        {
            active++;
            q.AutoDraft=false;
            q.SentPrompt=q.Prompt;
            q.State="Đang chạy";
            q.AccountId=a.Id;
            RefreshQueue();
            try
            {
                DateTime until;
                if(cooldowns.TryGetValue(a.Id,out until)&&until>DateTime.UtcNow)await Task.Delay(until-DateTime.UtcNow);
                using(var c=await browser.ConnectJob(a,q.Url))
                {
                    c.Trace=message=>status.Text=("[Job "+q.Id.Substring(0,6)+"]["+a.Name+"] "+message);
                    await c.EnableDiagnostics();
                    await AccountRefresh.Read(store,browser,a);
                    var catalog=await c.Bridge(new{ action="catalog",kind=q.Kind });
                    q.Url=Json.Text(await c.Bridge(new{ action="status" }),"url");
                    store.Save();
                    var names=Json.Array(catalog,"models").Where(x=>!Json.Bool(x,"disabled")).Select(x=>Json.Text(x,"name")).ToArray();
                    string actual=ModelMatch.Resolve(names,q.Model);
                    if(actual==null)throw new Exception("Model '"+q.Model+"' không có hoặc bị khóa.");
                    q.Model=actual;
                    var s=await c.Bridge(new{ action="configure",kind=q.Kind,model=actual });
                    var options=new List<object>();
                    foreach(var field in Json.Array(s,"fields"))
                    {
                        var name=Json.Text(field,"name");
                        var opts=Json.Array(field,"options").Where(o=>!Json.Bool(o,"disabled")).Select(o=>Json.Text(o,"name")).ToArray();
                        string target=null;
                        if(opts.Contains(q.Ratio))target=q.Ratio;
                        else if(opts.Contains(q.Count))target=q.Count;
                        if(target!=null)options.Add(new{ name=name,value=target });
                    }
                    s=await c.Bridge(new{ action="configure",kind=q.Kind,fields=options.ToArray() });
                    var policy=Policy.Check(a,Json.Number(s,"cost"),true,DateTime.UtcNow);
                    if(policy.Length>0)throw new Exception(policy);
                    await c.Bridge(new{ action="fill",prompt=JobRevision.RunningPrompt(q) });
                    if(JobFiles(q).Length>0)
                    {
                        await UploadJobImages(c,q);
                    }
                    await SubmitAndMonitor(c,q,a,s);
                }
            }
            catch(Exception e)
            {
                q.State="Lỗi";
                q.Note=e.GetBaseException().Message;
            }
            finally
            {
                store.Save();
                active--;
                leased.Remove(a.Id);
                RefreshQueue();
                cooldowns[a.Id]=DateTime.UtcNow.AddSeconds(10);
            }
        }
        string[] JobFiles(StudioTask q)
        {
            return q.References.Concat(new[]{ q.StartImage,q.EndImage }).Where(x=>!String.IsNullOrWhiteSpace(x)).Distinct().ToArray();
        }
        async Task UploadJobImages(Cdp c,StudioTask q)
        {
            if(!String.IsNullOrWhiteSpace(q.StartImage))await c.UploadImage(q.StartImage,"start");
            if(!String.IsNullOrWhiteSpace(q.EndImage))await c.UploadImage(q.EndImage,"end");
            foreach(var path in q.References)await c.UploadImage(path,"reference");
        }
        async Task SubmitAndMonitor(Cdp c,StudioTask q,Account a,object settings)
        {
            q.Folder=Path.Combine(store.Data.OutputFolder,q.Kind,q.Id.Substring(0,8));
            Directory.CreateDirectory(q.Folder);
            q.State="Đang gửi";
            q.Submitted=true;
            store.Save();
            await c.Bridge(new{ action="submit",prompt=JobRevision.RunningPrompt(q),jobId=JobRevision.ExecutionKey(q) });
            q.State="Đang chạy";
            store.Save();
            await Monitor(c,q);
        }
        async Task Monitor(Cdp c,StudioTask q)
        {
            var deadline=DateTime.UtcNow.AddMinutes(15);
            while(DateTime.UtcNow<deadline)
            {
                var d=await c.Bridge(new{ action="jobStatus",prompt=JobRevision.RunningPrompt(q),baseline=q.Baseline,kind=q.Kind });
                q.Progress=Json.Number(d,"progress");
                q.Note=Json.Text(d,"message");
                var error=Json.Text(d,"error");
                if(error.Length>0)throw new Exception(error);
                var urls=Json.Array(d,"urls").Select(Convert.ToString).Distinct().ToArray();
                if(urls.Length>0)
                {
                    q.State="Hoàn tất";
                    q.Progress=100;
                    store.Save();
                    RefreshQueue();
                    return;
                }
                store.Save();
                RefreshQueue();
                await Task.Delay(3000);
            }
        }
        Task Inspect()
        {
            var q=SelectedTask();
            MessageBox.Show(this,"Prompt: "+q.Prompt+"\nTrạng thái: "+q.State,"Chi tiết Job",MessageBoxButtons.OK);
            return Task.FromResult(0);
        }
        Task OpenFolder(string path)
        {
            if(String.IsNullOrWhiteSpace(path))throw new Exception("Chưa có thư mục kết quả.");
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo("explorer.exe","\""+Path.GetFullPath(path)+"\""){ UseShellExecute=true });
            return Task.FromResult(0);
        }
        Task ShowLogs()
        {
            MessageBox.Show(this,logs.Text,"Nhật ký",MessageBoxButtons.OK);
            return Task.FromResult(0);
        }
        Task Accounts()
        {
            using(var dialog=new AccountForm(store,browser))dialog.ShowDialog(this);
            RefreshAccounts();
            return Task.FromResult(0);
        }
    }

    // ORIGINAL COMPLETE ACCOUNTFORM - GIAO DIỆN CHUẨN ĐẦY ĐỦ 100% CỦA ẢNH MẪU
    public class AccountForm:Form
    {
        readonly Store store;
        readonly BrowserManager browser;
        readonly DataGridView table=new DataGridView();
        readonly Label summary=new Label(),note=new Label();
        bool busy;
        string focusId="";

        public AccountForm(Store value,BrowserManager manager)
        {
            store=value;
            browser=manager;
            Text="Cài đặt hệ thống — Tài khoản Flow";
            Size=new Size(1150,660);
            MinimumSize=new Size(960,560);
            StartPosition=FormStartPosition.CenterParent;
            BackColor=Color.FromArgb(24,27,34);
            ForeColor=Color.FromArgb(223,229,239);
            Font=new Font("Segoe UI",9);

            var layout=new TableLayoutPanel
            {
                Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,Padding=new Padding(12)
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,175));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
            Controls.Add(layout);

            var nav=new FlowLayoutPanel
            {
                Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown
            };
            nav.Controls.Add(new Label
            {
                Text="CÀI ĐẶT HỆ THỐNG",Size=new Size(168,50),ForeColor=Color.FromArgb(126,137,255),Font=new Font(Font,FontStyle.Bold)
            });
            foreach(var text in new[]{ "Tài khoản Flow","Đăng nhập trình duyệt","Gói & tín dụng" })
                nav.Controls.Add(new Label
                {
                    Text=text,BackColor=Color.FromArgb(41,45,55),Size=new Size(163,42),TextAlign=ContentAlignment.MiddleLeft,Padding=new Padding(10,0,0,0)
                });
            layout.Controls.Add(nav,0,0);

            var right=new TableLayoutPanel
            {
                Dock=DockStyle.Fill,RowCount=5
            };
            right.RowStyles.Add(new RowStyle(SizeType.Absolute,52));
            right.RowStyles.Add(new RowStyle(SizeType.Absolute,84));
            right.RowStyles.Add(new RowStyle(SizeType.Absolute,38));
            right.RowStyles.Add(new RowStyle(SizeType.Percent,100));
            right.RowStyles.Add(new RowStyle(SizeType.Absolute,54));
            layout.Controls.Add(right,1,0);

            right.Controls.Add(new Label
            {
                Text="Thêm tài khoản Flow để bắt đầu. Đăng nhập Google trong hồ sơ Chrome riêng.\nBật/tắt quyền chạy ảnh, video cho từng tài khoản; gói và credit được đọc từ Flow.",Dock=DockStyle.Fill,ForeColor=Color.FromArgb(59,220,136)
            },0,0);

            var actions=new FlowLayoutPanel{ Dock=DockStyle.Fill };
            Add(actions,"+ Thêm đăng nhập",async()=>
            {
                var a=store.CreateLoginAccount();focusId=a.Id;RefreshTable();await browser.OpenLogin(a);note.Text=a.Status;
            });
            Add(actions,"Đăng nhập Chrome thường",async()=>
            {
                var a=Selected();await browser.OpenLogin(a);note.Text=a.Status;
            });
            Add(actions,"Kết nối và đọc tài khoản",()=>RefreshAccount(Selected()));
            Add(actions,"Làm mới",()=>RefreshAccount(Selected()));
            Add(actions,"Làm mới tất cả",async()=>
            {
                int good=0;
                foreach(var a in store.Data.Accounts.Where(x=>x.LoginStarted&&x.Enabled))
                {
                    try { await RefreshAccount(a); good++; } catch {}
                }
                note.Text="Đã làm mới "+good+" tài khoản.";
            });
            Add(actions,"Đóng hồ sơ",async()=>await browser.Close(Selected()));
            right.Controls.Add(actions,0,1);

            summary.Dock=DockStyle.Fill;
            summary.TextAlign=ContentAlignment.MiddleLeft;
            right.Controls.Add(summary,0,2);

            table.Dock=DockStyle.Fill;
            table.AllowUserToAddRows=false;
            table.AllowUserToDeleteRows=false;
            table.RowHeadersVisible=false;
            table.BackgroundColor=BackColor;
            table.AutoSizeColumnsMode=DataGridViewAutoSizeColumnsMode.Fill;
            table.SelectionMode=DataGridViewSelectionMode.FullRowSelect;
            table.MultiSelect=false;
            table.EnableHeadersVisualStyles=false;
            table.ColumnHeadersDefaultCellStyle.BackColor=Color.FromArgb(41,45,55);
            table.ColumnHeadersDefaultCellStyle.ForeColor=ForeColor;
            table.DefaultCellStyle.BackColor=BackColor;
            table.DefaultCellStyle.ForeColor=ForeColor;
            table.RowTemplate.Height=45;
            table.ColumnHeadersHeight=36;

            table.CellValueChanged+=(s,e)=>
            {
                if(e.RowIndex<0||busy)return;
                var row=table.Rows[e.RowIndex];
                var a=store.Data.Accounts.Single(item=>item.Id==Convert.ToString(row.Cells["Id"].Value));
                a.Enabled=Convert.ToBoolean(row.Cells["Bat"].Value);
                a.Images=Convert.ToBoolean(row.Cells["Anh"].Value);
                a.Videos=Convert.ToBoolean(row.Cells["Video"].Value);
                store.Save();
            };

            table.CellContentClick+=async(sender,e)=>
            {
                if(e.RowIndex<0||e.ColumnIndex<0||table.Columns[e.ColumnIndex].Name!="CheckAccount"||busy)return;
                var id=Convert.ToString(table.Rows[e.RowIndex].Cells["Id"].Value);
                busy=true;
                note.Text="Đang kiểm tra…";
                try
                {
                    await RefreshAccount(store.Data.Accounts.Single(a=>a.Id==id));
                }
                catch(Exception ex)
                {
                    note.Text=ex.GetBaseException().Message;
                }
                finally
                {
                    busy=false;
                    focusId=id;
                    RefreshTable();
                }
            };

            right.Controls.Add(table,0,3);

            note.Dock=DockStyle.Fill;
            note.ForeColor=Color.FromArgb(150,160,180);
            note.Text="Gói/credit chưa rõ sẽ chặn tạo. Chi phí đọc từ Flow.\nĐăng nhập xong: đóng Chrome hồ sơ → Kết nối và đọc tài khoản.";
            right.Controls.Add(note,0,4);

            RefreshTable();
        }

        void Add(Control p,string text,Func<Task> action)
        {
            var b=new Button
            {
                Text=text,AutoSize=true,Height=32,FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(40,127,180),ForeColor=Color.White,Padding=new Padding(8,4,8,4)
            };
            b.Click+=async(s,e)=>
            {
                if(busy)return;
                busy=true;
                try
                {
                    await action();
                }
                catch(Exception ex)
                {
                    MessageBox.Show(this,ex.GetBaseException().Message,"FlowDesk",MessageBoxButtons.OK,MessageBoxIcon.Information);
                }
                finally
                {
                    busy=false;
                    RefreshTable();
                }
            };
            p.Controls.Add(b);
        }

        Account Selected()
        {
            if(table.CurrentRow==null)throw new Exception("Chọn tài khoản.");
            return store.Data.Accounts.Single(a=>a.Id==Convert.ToString(table.CurrentRow.Cells["Id"].Value));
        }

        async Task RefreshAccount(Account a)
        {
            await AccountRefresh.Read(store,browser,a);
            note.Text="Đã đọc: "+a.Email+" | "+a.Plan+" | "+(a.Credits.HasValue?a.Credits+" credit":"credit chưa rõ");
        }

        void RefreshTable()
        {
            bool previous=busy;
            busy=true;
            string id="";
            try { id=Selected().Id; } catch {}
            if(focusId.Length>0) { id=focusId; focusId=""; }

            table.DataSource=store.Data.Accounts.Where(a=>a.LoginStarted).Select(a=>new AccountView
            {
                Id=a.Id,Bat=a.Enabled,Anh=a.Images,Video=a.Videos,HoSo=a.Name,TaiKhoan=a.Email.Length>0?a.Email:a.LoginMode?"Chờ kết nối Flow":"Chưa đọc email",Loai=a.Plan=="Unknown"?"Chưa rõ":a.Plan,TinDung=a.Credits.HasValue?a.Credits.ToString():"—",TrangThai=a.Status
            }).ToList();

            if(table.Columns.Contains("Id"))table.Columns["Id"].Visible=false;
            foreach(DataGridViewColumn col in table.Columns)
            {
                col.ReadOnly=!(col.Name=="Bat"||col.Name=="Anh"||col.Name=="Video");
                col.HeaderText=col.Name=="Bat"?"Bật / Tắt":col.Name=="Anh"?"Ảnh":col.Name=="HoSo"?"Hồ sơ":col.Name=="TaiKhoan"?"Tài khoản":col.Name=="Loai"?"Gói":col.Name=="TinDung"?"Tín dụng":col.Name=="TrangThai"?"Trạng thái":col.HeaderText;
            }
            foreach(DataGridViewRow row in table.Rows)if(Convert.ToString(row.Cells["Id"].Value)==id)
            {
                table.CurrentCell=row.Cells["HoSo"];
                break;
            }
            if(!table.Columns.Contains("CheckAccount"))table.Columns.Add(new DataGridViewButtonColumn
            {
                Name="CheckAccount",HeaderText="Hành động",Text="↻ Kiểm tra",UseColumnTextForButtonValue=true,FlatStyle=FlatStyle.Flat
            });
            summary.Text="Tài khoản Flow | Đang bật: "+store.Data.Accounts.Count(a=>a.LoginStarted&&a.Enabled)+" | Credit đã đọc: "+store.Data.Accounts.Where(a=>a.Credits.HasValue).Sum(a=>a.Credits.Value);
            busy=previous;
        }

        public class AccountView
        {
            public string Id { get; set; }
            public bool Bat { get; set; }
            public bool Anh { get; set; }
            public bool Video { get; set; }
            public string HoSo { get; set; }
            public string TaiKhoan { get; set; }
            public string Loai { get; set; }
            public string TinDung { get; set; }
            public string TrangThai { get; set; }
        }
    }

    public static class PromptImport
    {
        public static List<string[]> Csv(string content)
        {
            var rows=new List<string[]>();
            var row=new List<string>();
            var cell=new StringBuilder();
            bool quoted=false;
            for(int i=0;i<content.Length;i++)
            {
                char c=content[i];
                if(c=='"')
                {
                    if(quoted&&i+1<content.Length&&content[i+1]=='"')
                    {
                        cell.Append('"');
                        i++;
                    }
                    else quoted=!quoted;
                }
                else if(c==','&&!quoted)
                {
                    row.Add(cell.ToString());
                    cell.Clear();
                }
                else if((c=='\r'||c=='\n')&&!quoted)
                {
                    if(c=='\r'&&i+1<content.Length&&content[i+1]=='\n')i++;
                    row.Add(cell.ToString());
                    cell.Clear();
                    if(row.Any(s=>!String.IsNullOrWhiteSpace(s)))rows.Add(row.ToArray());
                    row.Clear();
                }
                else cell.Append(c);
            }
            row.Add(cell.ToString());
            if(row.Any(s=>!String.IsNullOrWhiteSpace(s)))rows.Add(row.ToArray());
            return rows;
        }
        public static string[] Read(string path)
        {
            var extension=Path.GetExtension(path).ToLowerInvariant();
            if(extension==".txt")return StudioForm.ParsePrompts(File.ReadAllText(path,Encoding.UTF8),false);
            if(extension==".csv")return Column(Csv(File.ReadAllText(path,Encoding.UTF8)));
            return new string[0];
        }
        static string[] Column(List<string[]> rows)
        {
            if(rows.Count==0)return new string[0];
            int column=Array.FindIndex(rows[0],s=>String.Equals((s??"").Trim(),"prompt",StringComparison.OrdinalIgnoreCase)||String.Equals((s??"").Trim(),"câu lệnh",StringComparison.OrdinalIgnoreCase));
            bool header=column>=0;
            if(column<0)column=0;
            return rows.Skip(header?1:0).Select(row=>column<row.Length?(row[column]??"").Trim():"").Where(s=>s.Length>0).ToArray();
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var locationFile=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"data-location.txt");
            var dataRoot=File.Exists(locationFile)?Path.GetFullPath(File.ReadAllText(locationFile).Trim()):Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Data");
            var store=new Store(dataRoot);
            Application.Run(new StudioForm(store));
        }
    }
}
