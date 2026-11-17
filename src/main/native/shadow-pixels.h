#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

inline void PaintWindowShadow(uint32_t* pixels, int width, int height, int radius, int spread, int blur, uint32_t color) {
  const int margin = spread + blur;
  const int extent = margin + radius;
  std::memset(pixels, 0, static_cast<size_t>(width) * height * sizeof(uint32_t));
  for (int y = 0; y < height; ++y) {
    const double dy = extent - std::min(y + .5, height - y - .5);
    for (int x = 0; x < width; ++x) {
      if (dy <= 0 && x == extent && width > 2 * extent) x = width - extent;
      const double dx = extent - std::min(x + .5, width - x - .5);
      const double distance = std::hypot(std::max(dx, 0.), std::max(dy, 0.)) +
        std::min(std::max(dx, dy), 0.) - radius;
      if (distance <= 1 || distance >= margin) continue;
      const double falloff = 1 - std::max(0., distance - spread) / blur;
      const auto alpha = static_cast<uint32_t>(std::lround(78 * std::min(1., (distance - 1) / 2) * falloff * falloff));
      const uint32_t red = (((color >> 16) & 255) * alpha + 127) / 255;
      const uint32_t green = (((color >> 8) & 255) * alpha + 127) / 255;
      const uint32_t blue = ((color & 255) * alpha + 127) / 255;
      pixels[static_cast<size_t>(y) * width + x] = (alpha << 24) | (red << 16) | (green << 8) | blue;
    }
  }
}
