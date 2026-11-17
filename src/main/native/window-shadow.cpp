#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <new>

namespace {

struct WindowShadow {
  HWND window;
  SIZE lastSize{};
  int lastRadius = 0;
  int lastSpread = 0;

  bool Draw(POINT position, SIZE size, int radius, int spread) {
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
      // BGRA with premultiplied alpha. Only the perimeter is painted, so the shadow
      // never darkens editor content or the clear or Acrylic sidebar.
      const auto pixels = static_cast<uint32_t*>(bits);
      std::memset(pixels, 0, static_cast<size_t>(size.cx) * size.cy * 4);
      const int extent = spread + radius;
      for (int y = 0; y < size.cy; ++y) {
        const double dy = extent - std::min(y + .5, size.cy - y - .5);
        for (int x = 0; x < size.cx; ++x) {
          if (dy <= 0 && x == extent) x = size.cx - extent;
          const double dx = extent - std::min(x + .5, size.cx - x - .5);
          const double distance = std::hypot(std::max(dx, 0.), std::max(dy, 0.)) +
            std::min(std::max(dx, dy), 0.) - radius;
          if (distance > 1 && distance < spread) {
            const double falloff = 1 - distance / spread;
            const auto alpha = static_cast<uint32_t>(std::lround(78 * std::min(1., (distance - 1) / 2) * falloff * falloff));
            pixels[static_cast<size_t>(y) * size.cx + x] = alpha << 24;
          }
        }
      }
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
                                                         int height, int radius, int dpi) noexcept {
  if (!width || !height) {
    ShowWindow(shadow->window, SW_HIDE);
    return;
  }
  const int spread = (18 * dpi + 95) / 96;
  const POINT position{left - spread, top - spread};
  const SIZE size{width + 2 * spread, height + 2 * spread};
  if (size.cx != shadow->lastSize.cx || size.cy != shadow->lastSize.cy ||
      radius != shadow->lastRadius || spread != shadow->lastSpread) {
    if (!shadow->Draw(position, size, radius, spread)) return;
    shadow->lastSize = size;
    shadow->lastRadius = radius;
    shadow->lastSpread = spread;
  } else {
    SetWindowPos(shadow->window, nullptr, position.x, position.y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
  }
  if (!IsWindowVisible(shadow->window)) ShowWindow(shadow->window, SW_SHOWNOACTIVATE);
}

extern "C" __declspec(dllexport) void DestroyEditorShadow(WindowShadow* shadow) noexcept {
  if (IsWindow(shadow->window)) DestroyWindow(shadow->window);
  delete shadow;
}
