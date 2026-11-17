#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <dispatcherqueue.h>
#include <dwmapi.h>
#include <winrt/Windows.Foundation.Numerics.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.Composition.h>
#include <winrt/Windows.UI.Composition.Desktop.h>
#include <winrt/Windows.UI.ViewManagement.h>
#include <windows.ui.composition.interop.h>

using namespace winrt;
using namespace Windows::UI::Composition;

namespace {

void EnsureDispatcherQueue() {
  if (Windows::System::DispatcherQueue::GetForCurrentThread()) return;
  DispatcherQueueOptions options{sizeof(options), DQTYPE_THREAD_CURRENT, DQTAT_COM_NONE};
  // The queue serves every editor on Electron's UI thread and lasts until the process exits.
  Windows::System::DispatcherQueueController controller{nullptr};
  check_hresult(CreateDispatcherQueueController(options,
    reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(put_abi(controller))));
  (void)detach_abi(controller);
}

class AcrylicBackdrop {
 public:
  explicit AcrylicBackdrop(HWND hwnd) : window(hwnd) {
    namespace abi = ABI::Windows::UI::Composition::Desktop;
    auto interop = compositor.as<abi::ICompositorDesktopInterop>();
    check_hresult(interop->CreateDesktopWindowTarget(window, false,
      reinterpret_cast<abi::IDesktopWindowTarget**>(put_abi(target))));
    visual.Clip(compositor.CreateGeometricClip(geometry));
    visual.IsVisible(false);
    target.Root(visual);
  }

  void Update(bool visible, int radius, uint32_t color) {
    if (visible != isVisible) {
      const BOOL enabled = visible;
      check_hresult(DwmSetWindowAttribute(window, DWMWA_USE_HOSTBACKDROPBRUSH, &enabled, sizeof(enabled)));
      isVisible = visible;
      visual.IsVisible(visible);
    }
    if (!visible) return;

    RECT client{};
    check_bool(GetClientRect(window, &client));
    const Windows::Foundation::Numerics::float2 size{float(client.right), float(client.bottom)};
    visual.Size(size);
    geometry.Size(size);
    geometry.CornerRadius({float(radius), float(radius)});

    // Windows can turn off backdrop sampling for Remote Desktop, high contrast, or reduced effects.
    const Windows::UI::Color tint{255, uint8_t(color >> 16), uint8_t(color >> 8), uint8_t(color)};
    if (settings.AdvancedEffectsEnabled() && capabilities.AreEffectsFast() &&
        !GetSystemMetrics(SM_REMOTESESSION) && !GetSystemMetrics(SM_REMOTECONTROL)) {
      if (!hostBrush) hostBrush = compositor.CreateHostBackdropBrush();
      visual.Brush(hostBrush);
    } else {
      fallback.Color(tint);
      visual.Brush(fallback);
    }
  }

 private:
  HWND window;
  bool isVisible = false;
  Windows::UI::ViewManagement::UISettings settings;
  CompositionCapabilities capabilities = CompositionCapabilities::GetForCurrentView();
  Compositor compositor;
  Desktop::DesktopWindowTarget target{nullptr};
  SpriteVisual visual = compositor.CreateSpriteVisual();
  CompositionRoundedRectangleGeometry geometry = compositor.CreateRoundedRectangleGeometry();
  CompositionColorBrush fallback = compositor.CreateColorBrush();
  CompositionBackdropBrush hostBrush{nullptr};
};

}  // namespace

extern "C" __declspec(dllexport) int CreateAcrylicBackdrop(HWND window, AcrylicBackdrop** out) noexcept {
  try {
    EnsureDispatcherQueue();
    *out = new AcrylicBackdrop(window);
    return 0;
  } catch (...) {
    return to_hresult();
  }
}

extern "C" __declspec(dllexport) int UpdateAcrylicBackdrop(AcrylicBackdrop* backdrop, int visible,
                                                         int radius, uint32_t color) noexcept {
  try {
    backdrop->Update(visible != 0, radius, color);
    return 0;
  } catch (...) {
    return to_hresult();
  }
}

extern "C" __declspec(dllexport) void DestroyAcrylicBackdrop(AcrylicBackdrop* backdrop) noexcept {
  delete backdrop;
}
