#import <AppKit/AppKit.h>
#include "shadow-pixels.h"
#include <memory>

@interface YmdShadowPanel : NSPanel
@end

@implementation YmdShadowPanel
- (NSRect)constrainFrameRect:(NSRect)rect toScreen:(NSScreen*)screen {
  return rect;
}
@end

@interface YmdShadowView : NSView
@property int spread;
@property int blur;
@property uint32_t tint;
@end

@implementation YmdShadowView
- (void)drawRect:(NSRect)dirtyRect {
  const CGFloat scale = self.window.backingScaleFactor;
  const NSRect bounds = self.bounds;
  const int width = std::lround(bounds.size.width * scale);
  const int height = std::lround(bounds.size.height * scale);
  if (width <= 0 || height <= 0) return;
  auto pixels = std::make_unique_for_overwrite<uint32_t[]>(static_cast<size_t>(width) * height);
  PaintWindowShadow(pixels.get(), width, height, std::lround(10 * scale),
    std::lround(self.spread * scale), std::lround(self.blur * scale), self.tint);
  const auto space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  const auto provider = CGDataProviderCreateWithData(nullptr, pixels.release(),
    static_cast<size_t>(width) * height * 4, [](void*, const void* buffer, size_t) {
      delete[] static_cast<const uint32_t*>(buffer);
    });
  const auto image = CGImageCreate(width, height, 8, 32, width * 4, space,
    static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedFirst) | kCGBitmapByteOrder32Little, provider, nullptr, false, kCGRenderingIntentDefault);
  auto context = NSGraphicsContext.currentContext.CGContext;
  CGContextSetBlendMode(context, kCGBlendModeCopy);
  if (image) {
    CGContextDrawImage(context, bounds, image);
    CGImageRelease(image);
  }
  if (provider) CGDataProviderRelease(provider);
  CGColorSpaceRelease(space);
}
@end

namespace {

struct MacWindowShadow {
  __weak NSWindow* editor;
  NSPanel* panel;
  YmdShadowView* view;

  void Hide() {
    if (panel.parentWindow) [panel.parentWindow removeChildWindow:panel];
    [panel orderOut:nil];
  }
};

}  // namespace

extern "C" MacWindowShadow* CreateMacEditorShadow(NSView* nativeView) {
  NSWindow* editor = nativeView.window;
  if (!editor) return nullptr;
  auto* shadow = new MacWindowShadow{};
  shadow->editor = editor;
  shadow->panel = [[YmdShadowPanel alloc] initWithContentRect:NSZeroRect
    styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
    backing:NSBackingStoreBuffered defer:NO];
  shadow->panel.title = @"Ymd window shadow";
  shadow->panel.opaque = NO;
  shadow->panel.backgroundColor = NSColor.clearColor;
  shadow->panel.hasShadow = NO;
  shadow->panel.ignoresMouseEvents = YES;
  shadow->panel.animationBehavior = NSWindowAnimationBehaviorNone;
  shadow->panel.collectionBehavior = NSWindowCollectionBehaviorIgnoresCycle | NSWindowCollectionBehaviorFullScreenAuxiliary;
  shadow->view = [[YmdShadowView alloc] initWithFrame:NSZeroRect];
  shadow->panel.contentView = shadow->view;
  return shadow;
}

extern "C" void UpdateMacEditorShadow(MacWindowShadow* shadow, int show, int spread, int blur, uint32_t color) {
  NSWindow* editor = shadow->editor;
  if (!show || !editor || !editor.visible || editor.miniaturized) {
    shadow->Hide();
    return;
  }
  NSPanel* panel = shadow->panel;
  YmdShadowView* view = shadow->view;
  const bool styleChanged = spread != view.spread || blur != view.blur || color != view.tint;
  view.spread = spread;
  view.blur = blur;
  view.tint = color;
  const CGFloat margin = spread + blur;
  const NSRect frame = NSInsetRect(editor.frame, -margin, -margin);
  const bool resized = !NSEqualSizes(frame.size, panel.frame.size);
  if (!NSEqualRects(frame, panel.frame)) [panel setFrame:frame display:resized];
  if (!panel.parentWindow) [editor addChildWindow:panel ordered:NSWindowBelow];
  if (styleChanged || resized) [view setNeedsDisplay:YES];
}

extern "C" void DestroyMacEditorShadow(MacWindowShadow* shadow) {
  shadow->Hide();
  [shadow->panel close];
  delete shadow;
}
