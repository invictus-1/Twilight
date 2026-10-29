// Twilight's installer: the app's first-run evening (ui/index.html) in a borderless window drawn by
// WebView2, wrapped around the regular NSIS installer, which does the installing itself, silently.
// So shortcuts, the uninstaller, upgrades and Add/Remove Programs all stay exactly as before.
//
// The NSIS installer and a little metadata are appended to this program by build.cjs:
//   [setup.exe][NSIS installer][metadata JSON][trailer]
// Run with /S (as Twilight's updater does) and the window never opens: the arguments go straight
// to the NSIS installer. Without the WebView2 runtime, the classic installer pages open instead.

#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <dwmapi.h>
#include <wrl.h>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <string>
#include <thread>
#include <vector>
#include "WebView2.h"

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "version.lib")
#pragma comment(lib, "WebView2LoaderStatic.lib")

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {

constexpr wchar_t kClass[] = L"TwilightSetupWindow";
constexpr UINT WM_APP_POST = WM_APP + 1;  // lParam: a std::wstring* of JSON for the page
constexpr int kWidth = 920, kHeight = 600;
constexpr COLORREF kNight = RGB(0x0b, 0x0d, 0x1c);

// ——— The appended payload ———

#pragma pack(push, 1)
struct Trailer {
  char magic[16];  // "TWILIGHT-SETUP-1"
  uint64_t payloadOffset, payloadSize, metaOffset, metaSize;
};
#pragma pack(pop)

struct Payload {
  std::wstring self;
  uint64_t offset = 0, size = 0;
  std::string meta;
};

/** Finds the trailer near the end of this program (a signature may follow it). */
bool readPayload(Payload& p) {
  wchar_t path[MAX_PATH];
  GetModuleFileNameW(nullptr, path, MAX_PATH);
  p.self = path;
  HANDLE f = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
  if (f == INVALID_HANDLE_VALUE) return false;
  LARGE_INTEGER total{};
  GetFileSizeEx(f, &total);
  const uint64_t window = total.QuadPart < (1 << 20) ? total.QuadPart : (1 << 20);
  std::vector<char> tail(static_cast<size_t>(window));
  LARGE_INTEGER at{};
  at.QuadPart = total.QuadPart - window;
  SetFilePointerEx(f, at, nullptr, FILE_BEGIN);
  DWORD got = 0;
  ReadFile(f, tail.data(), static_cast<DWORD>(window), &got, nullptr);
  bool found = false;
  for (int64_t i = static_cast<int64_t>(got) - sizeof(Trailer); i >= 0; --i) {
    if (memcmp(tail.data() + i, "TWILIGHT-SETUP-1", 16) == 0) {
      Trailer t;
      memcpy(&t, tail.data() + i, sizeof t);
      p.offset = t.payloadOffset;
      p.size = t.payloadSize;
      p.meta.resize(static_cast<size_t>(t.metaSize));
      at.QuadPart = static_cast<LONGLONG>(t.metaOffset);
      SetFilePointerEx(f, at, nullptr, FILE_BEGIN);
      ReadFile(f, p.meta.data(), static_cast<DWORD>(t.metaSize), &got, nullptr);
      found = true;
      break;
    }
  }
  CloseHandle(f);
  return found && p.size > 0;
}

/** A string or number field from the flat metadata JSON build.cjs writes. */
std::string metaField(const std::string& json, const char* key) {
  const std::string k = std::string("\"") + key + "\":";
  size_t i = json.find(k);
  if (i == std::string::npos) return "";
  i += k.size();
  if (json[i] == '"') {
    size_t end = json.find('"', i + 1);
    return json.substr(i + 1, end - i - 1);
  }
  size_t end = json.find_first_of(",}", i);
  return json.substr(i, end - i);
}

std::wstring widen(const std::string& s) {
  if (s.empty()) return L"";
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
  return w;
}

/** Copies the NSIS installer out to a temporary file, reporting progress from 0 to 1. */
template <typename F>
bool extractPayload(const Payload& p, const std::wstring& target, F onProgress) {
  HANDLE in = CreateFileW(p.self.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (in == INVALID_HANDLE_VALUE) return false;
  HANDLE out = CreateFileW(target.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, nullptr);
  if (out == INVALID_HANDLE_VALUE) {
    CloseHandle(in);
    return false;
  }
  LARGE_INTEGER at{};
  at.QuadPart = static_cast<LONGLONG>(p.offset);
  SetFilePointerEx(in, at, nullptr, FILE_BEGIN);
  std::vector<char> buf(4 << 20);
  uint64_t left = p.size;
  bool ok = true;
  while (left > 0 && ok) {
    DWORD want = static_cast<DWORD>(left < buf.size() ? left : buf.size()), got = 0, wrote = 0;
    ok = ReadFile(in, buf.data(), want, &got, nullptr) && got == want && WriteFile(out, buf.data(), got, &wrote, nullptr) && wrote == got;
    left -= got;
    onProgress(1.0 - static_cast<double>(left) / static_cast<double>(p.size));
  }
  CloseHandle(in);
  CloseHandle(out);
  if (!ok) DeleteFileW(target.c_str());
  return ok;
}

std::wstring tempInstallerPath(const std::wstring& version) {
  wchar_t dir[MAX_PATH];
  GetTempPathW(MAX_PATH, dir);
  return std::wstring(dir) + L"Twilight-Setup-core-" + version + L"-" + std::to_wstring(GetCurrentProcessId()) + L".exe";
}

/** Starts the NSIS installer with `args`; returns its process handle, or null. */
HANDLE startInstaller(const std::wstring& exe, const std::wstring& args) {
  std::wstring cmd = L"\"" + exe + L"\" " + args;
  STARTUPINFOW si{sizeof si};
  PROCESS_INFORMATION pi{};
  if (!CreateProcessW(exe.c_str(), cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi)) return nullptr;
  CloseHandle(pi.hThread);
  return pi.hProcess;
}

/** Runs the NSIS installer with `args` and waits; returns its exit code (or -1 if it never ran). */
DWORD runInstaller(const std::wstring& exe, const std::wstring& args) {
  HANDLE process = startInstaller(exe, args);
  if (!process) return static_cast<DWORD>(-1);
  WaitForSingleObject(process, INFINITE);
  DWORD code = 0;
  GetExitCodeProcess(process, &code);
  CloseHandle(process);
  return code;
}

// ——— Where Twilight is (or will be) installed ———

struct Installed {
  std::wstring location, version;
};

/** Twilight's entry in Add/Remove Programs for this user, if there is one. */
Installed findInstalled() {
  Installed result;
  HKEY root;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", 0, KEY_READ, &root) != ERROR_SUCCESS) return result;
  wchar_t name[256];
  for (DWORD i = 0;; ++i) {
    DWORD len = 256;
    if (RegEnumKeyExW(root, i, name, &len, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
    HKEY key;
    if (RegOpenKeyExW(root, name, 0, KEY_READ, &key) != ERROR_SUCCESS) continue;
    wchar_t value[1024];
    DWORD size = sizeof value;
    if (RegGetValueW(key, nullptr, L"DisplayName", RRF_RT_REG_SZ, nullptr, value, &size) == ERROR_SUCCESS && wcsncmp(value, L"Twilight", 8) == 0 &&
        (value[8] == 0 || value[8] == L' ')) {
      size = sizeof value;
      if (RegGetValueW(key, nullptr, L"InstallLocation", RRF_RT_REG_SZ, nullptr, value, &size) == ERROR_SUCCESS && value[0]) result.location = value;
      // electron-builder leaves InstallLocation empty; the icon path ("…\Twilight.exe,0") says where.
      size = sizeof value;
      if (result.location.empty() && RegGetValueW(key, nullptr, L"DisplayIcon", RRF_RT_REG_SZ, nullptr, value, &size) == ERROR_SUCCESS) {
        std::wstring icon = value;
        const size_t slash = icon.find_last_of(L'\\');
        if (slash != std::wstring::npos) result.location = icon.substr(icon[0] == L'"' ? 1 : 0, slash - (icon[0] == L'"' ? 1 : 0));
      }
      size = sizeof value;
      if (RegGetValueW(key, nullptr, L"DisplayVersion", RRF_RT_REG_SZ, nullptr, value, &size) == ERROR_SUCCESS) result.version = value;
    }
    RegCloseKey(key);
    if (!result.location.empty()) break;
  }
  RegCloseKey(root);
  return result;
}

std::wstring defaultLocation() {
  wchar_t* local = nullptr;
  std::wstring out;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) out = std::wstring(local) + L"\\Programs\\Twilight";
  CoTaskMemFree(local);
  return out;
}

uint64_t folderBytes(const std::wstring& dir) {
  uint64_t total = 0;
  WIN32_FIND_DATAW d;
  HANDLE h = FindFirstFileExW((dir + L"\\*").c_str(), FindExInfoBasic, &d, FindExSearchNameMatch, nullptr, FIND_FIRST_EX_LARGE_FETCH);
  if (h == INVALID_HANDLE_VALUE) return 0;
  do {
    if (wcscmp(d.cFileName, L".") == 0 || wcscmp(d.cFileName, L"..") == 0) continue;
    if (d.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) total += folderBytes(dir + L"\\" + d.cFileName);
    else total += (static_cast<uint64_t>(d.nFileSizeHigh) << 32) | d.nFileSizeLow;
  } while (FindNextFileW(h, &d));
  FindClose(h);
  return total;
}

// ——— The window ———

HWND g_hwnd = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
std::atomic<bool> g_installing{false};
Payload g_payload;
std::wstring g_version;
uint64_t g_installedBytes = 0;

/** TWILIGHT_SETUP_DRYRUN=1 plays the whole window through without installing anything. */
bool dryRun() {
  wchar_t v[8];
  return GetEnvironmentVariableW(L"TWILIGHT_SETUP_DRYRUN", v, 8) > 0 && v[0] == L'1';
}

/** Sends JSON to the page from any thread (it's delivered on the window's thread). */
void post(const std::wstring& json) {
  PostMessageW(g_hwnd, WM_APP_POST, 0, reinterpret_cast<LPARAM>(new std::wstring(json)));
}

void postProgress(double value, const wchar_t* phase) {
  wchar_t buf[128];
  swprintf_s(buf, L"{\"type\":\"progress\",\"value\":%.4f,\"phase\":\"%s\"}", value, phase);
  post(buf);
}

/**
 * Extracts and runs the NSIS installer silently. NSIS reports nothing while silent, so progress
 * comes from the install folder filling up toward the size build.cjs measured. Shown progress
 * never goes backwards (the page holds it), and stays short of the end until NSIS finishes.
 */
void installWorker() {
  const std::wstring inner = tempInstallerPath(g_version);
  postProgress(0.01, L"extract");
  if (!extractPayload(g_payload, inner, [](double f) { postProgress(0.02 + f * 0.13, L"extract"); })) {
    post(L"{\"type\":\"error\",\"message\":\"Couldn't unpack the installer. Check there's free space on this drive and try again.\"}");
    g_installing = false;
    return;
  }
  if (dryRun()) {
    // A rehearsal for testing the window: the real payload is unpacked, nothing is installed.
    const wchar_t* phases[] = {L"clear", L"install", L"install", L"finish"};
    for (int i = 0; i <= 40; ++i) {
      postProgress(0.15 + 0.8 * i / 40.0, phases[i * 3 / 40]);
      Sleep(80);
    }
    DeleteFileW(inner.c_str());
    post(L"{\"type\":\"done\"}");
    g_installing = false;
    return;
  }
  std::wstring location = findInstalled().location;
  if (location.empty()) location = defaultLocation();
  const double expected = g_installedBytes ? static_cast<double>(g_installedBytes) : 300.0 * 1024 * 1024;
  HANDLE process = startInstaller(inner, L"/S /currentuser");
  if (!process) {
    DeleteFileW(inner.c_str());
    post(L"{\"type\":\"error\",\"message\":\"The installer couldn't start.\"}");
    g_installing = false;
    return;
  }
  const ULONGLONG started = GetTickCount64();
  // A reinstall first removes the old copy; until the folder has emptied, that's the phase.
  bool clearing = folderBytes(location) > expected * 0.3;
  while (WaitForSingleObject(process, 220) == WAIT_TIMEOUT) {
    const double seconds = (GetTickCount64() - started) / 1000.0;
    const double bytes = static_cast<double>(folderBytes(location));
    if (clearing && (bytes < expected * 0.25 || seconds > 20)) clearing = false;
    // Time alone moves it gently too, so a slow disk never looks frozen.
    const double creep = 0.15 + 0.6 * (1.0 - std::exp(-seconds / 25.0));
    double value = clearing ? 0.15 + 0.1 * (1.0 - std::exp(-seconds / 3.0)) : 0.25 + 0.7 * (bytes / expected > 1 ? 1 : bytes / expected);
    value = (value > creep ? value : creep);
    postProgress(value < 0.96 ? value : 0.96, clearing ? L"clear" : value > 0.9 ? L"finish" : L"install");
  }
  DWORD code = 0;
  GetExitCodeProcess(process, &code);
  CloseHandle(process);
  DeleteFileW(inner.c_str());
  if (code == 0) post(L"{\"type\":\"done\"}");
  else {
    wchar_t buf[200];
    swprintf_s(buf, L"{\"type\":\"error\",\"message\":\"The installer stopped with code %lu. Close Twilight if it's open, then try again.\"}", code);
    post(buf);
  }
  g_installing = false;
}

void openTwilight() {
  std::wstring location = findInstalled().location;
  if (location.empty()) location = defaultLocation();
  ShellExecuteW(nullptr, L"open", (location + L"\\Twilight.exe").c_str(), nullptr, location.c_str(), SW_SHOWNORMAL);
}

std::wstring loadPage() {
  HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(2), RT_RCDATA);
  if (!res) return L"";
  HGLOBAL data = LoadResource(nullptr, res);
  const char* bytes = static_cast<const char*>(LockResource(data));
  return widen(std::string(bytes, SizeofResource(nullptr, res)));
}

void sendInfo() {
  const Installed installed = findInstalled();
  std::wstring json = L"{\"type\":\"info\",\"version\":\"" + g_version + L"\"";
  if (!installed.version.empty()) json += L",\"installed\":\"" + installed.version + L"\"";
  if (dryRun()) json += L",\"rehearse\":true";
  json += L"}";
  post(json);
}

void onMessage(const std::wstring& word) {
  if (word == L"ready") sendInfo();
  else if (word == L"install" && !g_installing.exchange(true)) std::thread(installWorker).detach();
  else if (word == L"open") {
    if (!dryRun()) openTwilight();
    DestroyWindow(g_hwnd);
  } else if (word == L"close") {
    if (!g_installing) DestroyWindow(g_hwnd);
  } else if (word == L"minimize") ShowWindow(g_hwnd, SW_MINIMIZE);
  else if (word == L"drag") {
    ReleaseCapture();
    SendMessageW(g_hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0);
  }
}

void resizeWebView() {
  if (!g_controller) return;
  RECT r;
  GetClientRect(g_hwnd, &r);
  g_controller->put_Bounds(r);
}

/** No WebView2 here: open the classic installer pages instead, and wait for them. */
int runClassic() {
  const std::wstring inner = tempInstallerPath(g_version);
  if (!extractPayload(g_payload, inner, [](double) {})) return 1;
  const DWORD code = runInstaller(inner, L"");
  DeleteFileW(inner.c_str());
  return static_cast<int>(code);
}

bool g_classic = false;

void createWebView() {
  wchar_t temp[MAX_PATH];
  GetTempPathW(MAX_PATH, temp);
  const std::wstring data = std::wstring(temp) + L"TwilightSetup.WebView2";
  const HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, data.c_str(), nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
        if (FAILED(result) || !env) {
          g_classic = true;
          DestroyWindow(g_hwnd);
          return S_OK;
        }
        env->CreateCoreWebView2Controller(
            g_hwnd, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
              if (FAILED(result) || !controller) {
                g_classic = true;
                DestroyWindow(g_hwnd);
                return S_OK;
              }
              g_controller = controller;
              g_controller->get_CoreWebView2(&g_webview);
              ComPtr<ICoreWebView2Controller2> c2;
              if (SUCCEEDED(g_controller.As(&c2))) c2->put_DefaultBackgroundColor({255, 0x0b, 0x0d, 0x1c});
              ComPtr<ICoreWebView2Settings> settings;
              g_webview->get_Settings(&settings);
              settings->put_AreDefaultContextMenusEnabled(FALSE);
              settings->put_AreDevToolsEnabled(FALSE);
              settings->put_IsStatusBarEnabled(FALSE);
              settings->put_IsZoomControlEnabled(FALSE);
              ComPtr<ICoreWebView2Settings3> s3;
              if (SUCCEEDED(settings.As(&s3))) s3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
              g_webview->add_WebMessageReceived(
                  Callback<ICoreWebView2WebMessageReceivedEventHandler>([](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                    LPWSTR text = nullptr;
                    if (SUCCEEDED(args->TryGetWebMessageAsString(&text)) && text) {
                      onMessage(text);
                      CoTaskMemFree(text);
                    }
                    return S_OK;
                  }).Get(),
                  nullptr);
              // Links never open inside the installer.
              g_webview->add_NewWindowRequested(
                  Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                    args->put_Handled(TRUE);
                    return S_OK;
                  }).Get(),
                  nullptr);
              resizeWebView();
              g_webview->NavigateToString(loadPage().c_str());
              return S_OK;
            }).Get());
        return S_OK;
      }).Get());
  if (FAILED(hr)) {
    g_classic = true;
    DestroyWindow(g_hwnd);
  }
}

LRESULT CALLBACK windowProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_SIZE:
      resizeWebView();
      return 0;
    case WM_DPICHANGED: {
      const RECT* r = reinterpret_cast<RECT*>(lp);
      SetWindowPos(hwnd, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
      return 0;
    }
    case WM_APP_POST: {
      std::wstring* json = reinterpret_cast<std::wstring*>(lp);
      if (g_webview) g_webview->PostWebMessageAsJson(json->c_str());
      delete json;
      return 0;
    }
    case WM_CLOSE:
      if (!g_installing) DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      if (g_controller) g_controller->Close();
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

/** True when the command line has /S: the updater (or a script) wants a silent install. */
bool silentRequested(std::wstring& rest) {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  bool silent = false;
  for (int i = 1; i < argc; ++i) {
    if (wcscmp(argv[i], L"/S") == 0) silent = true;
    rest += (rest.empty() ? L"" : L" ") + std::wstring(argv[i]);
  }
  LocalFree(argv);
  return silent;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
  if (!readPayload(g_payload)) {
    MessageBoxW(nullptr, L"This installer is incomplete. Download it again from the releases page.", L"Twilight Setup", MB_ICONERROR);
    return 1;
  }
  g_version = widen(metaField(g_payload.meta, "version"));
  g_installedBytes = std::strtoull(metaField(g_payload.meta, "installedBytes").c_str(), nullptr, 10);

  // --extract <file>: write the bundled NSIS installer out, for checking a build.
  {
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    const bool extract = argc == 3 && wcscmp(argv[1], L"--extract") == 0;
    const std::wstring to = extract ? argv[2] : L"";
    LocalFree(argv);
    if (extract) return extractPayload(g_payload, to, [](double) {}) ? 0 : 1;
  }

  std::wstring args;
  if (silentRequested(args)) {
    // Silent: the updater's /S --updated --force-run (or a script's) go straight to NSIS.
    const std::wstring inner = tempInstallerPath(g_version);
    if (!extractPayload(g_payload, inner, [](double) {})) return 1;
    const DWORD code = runInstaller(inner, args);
    DeleteFileW(inner.c_str());
    return static_cast<int>(code);
  }

  // One installer window at a time.
  HANDLE once = CreateMutexW(nullptr, TRUE, L"Local\\TwilightSetup");
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    if (HWND other = FindWindowW(kClass, nullptr)) SetForegroundWindow(other);
    return 0;
  }

  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  WNDCLASSEXW wc{sizeof wc};
  wc.style = CS_DROPSHADOW;
  wc.lpfnWndProc = windowProc;
  wc.hInstance = instance;
  wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
  wc.hIconSm = wc.hIcon;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.hbrBackground = CreateSolidBrush(kNight);
  wc.lpszClassName = kClass;
  RegisterClassExW(&wc);

  const UINT dpi = GetDpiForSystem();
  const int w = MulDiv(kWidth, dpi, 96), h = MulDiv(kHeight, dpi, 96);
  RECT work;
  SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
  g_hwnd = CreateWindowExW(WS_EX_APPWINDOW, kClass, L"Twilight Setup", WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX, work.left + (work.right - work.left - w) / 2,
                           work.top + (work.bottom - work.top - h) / 2, w, h, nullptr, nullptr, instance, nullptr);
  const DWORD round = 2;  // DWMWCP_ROUND
  DwmSetWindowAttribute(g_hwnd, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, &round, sizeof round);
  const BOOL dark = TRUE;
  DwmSetWindowAttribute(g_hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof dark);
  ShowWindow(g_hwnd, show);
  UpdateWindow(g_hwnd);
  createWebView();

  MSG m;
  while (GetMessageW(&m, nullptr, 0, 0)) {
    TranslateMessage(&m);
    DispatchMessageW(&m);
  }
  g_webview.Reset();
  g_controller.Reset();
  CoUninitialize();
  ReleaseMutex(once);
  return g_classic ? runClassic() : 0;
}
