#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include "shadow-pixels.h"
#include <new>

namespace {

struct WindowShadow {
  HWND window;
  SIZE lastSize{};
  int lastRadius = 0;
  int lastSpread = 0;
  int lastBlur = 0;
  uint32_t lastColor = 0;

  bool Draw(POINT position, SIZE size, int radius, int spread, int blur, uint32_t color) {
    const HDC dc = CreateCompatibleDC(nullptr);
    if (!dc) return false;

    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = size.cx;
    info.bmiHeader.biHeight = -size.cy;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    void* bits = nullptr;
    const HBITMAP bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
    const HGDIOBJ previous = bitmap ? SelectObject(dc, bitmap) : nullptr;
    bool drawn = false;

    if (previous && bits) {
      PaintWindowShadow(static_cast<uint32_t*>(bits), size.cx, size.cy, radius, spread, blur, color);
      POINT origin{};
      BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
      drawn = UpdateLayeredWindow(window, nullptr, &position, &size, dc, &origin, 0, &blend, ULW_ALPHA);
      SelectObject(dc, previous);
    }
    if (bitmap) DeleteObject(bitmap);
    DeleteDC(dc);
    return drawn;
  }
};

}  // namespace

extern "C" __declspec(dllexport) WindowShadow* CreateEditorShadow(HWND owner) noexcept {
  // Ownership keeps the shadow in the editor's stacking group. A layered tool
  // window with transparent hit-testing stays out of the taskbar and focus chain.
  const HWND window = CreateWindowExW(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
    L"Static", L"Ymd window shadow", WS_POPUP, 0, 0, 0, 0, owner, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!window) return nullptr;
  auto* shadow = new (std::nothrow) WindowShadow{window};
  if (!shadow) DestroyWindow(window);
  return shadow;
}

extern "C" __declspec(dllexport) void UpdateEditorShadow(WindowShadow* shadow, int left, int top, int width,
                                                         int height, int radius, int dpi,
                                                         int spread, int blur, uint32_t color) noexcept {
  if (!width || !height) {
    ShowWindow(shadow->window, SW_HIDE);
    return;
  }
  spread = (spread * dpi + 48) / 96;
  blur = (blur * dpi + 48) / 96;
  const int margin = spread + blur;
  const POINT position{left - margin, top - margin};
  const SIZE size{width + 2 * margin, height + 2 * margin};
  if (size.cx != shadow->lastSize.cx || size.cy != shadow->lastSize.cy ||
      radius != shadow->lastRadius || spread != shadow->lastSpread || blur != shadow->lastBlur || color != shadow->lastColor) {
    if (!shadow->Draw(position, size, radius, spread, blur, color)) return;
    shadow->lastSize = size;
    shadow->lastRadius = radius;
    shadow->lastSpread = spread;
    shadow->lastBlur = blur;
    shadow->lastColor = color;
  } else {
    SetWindowPos(shadow->window, nullptr, position.x, position.y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
  }
  if (!IsWindowVisible(shadow->window)) ShowWindow(shadow->window, SW_SHOWNOACTIVATE);
}

extern "C" __declspec(dllexport) void DestroyEditorShadow(WindowShadow* shadow) noexcept {
  if (IsWindow(shadow->window)) DestroyWindow(shadow->window);
  delete shadow;
}
