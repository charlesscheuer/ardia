#pragma once

#include <algorithm>
#include <cmath>

namespace ardiacore_pip_zoom {

struct Rect {
  double x, y, w, h;
  double maxX() const { return x + w; }
  double maxY() const { return y + h; }
};
struct Size {
  double w, h;
};
struct Point {
  double x, y;
};

constexpr double kPerPoint = 0.004, kPerLine = 0.08;
constexpr double kDockSlop = 64;

inline double ScrollFactor(double deltaY, bool precise) {
  return std::exp((precise ? kPerPoint : kPerLine) * deltaY);
}

inline double MagnifyFactor(double magnification) {
  return std::max(0.05, 1 + magnification);
}

inline Rect Moved(Rect frame, double dx, double dy, Rect visible) {
  double x = std::clamp(frame.x + dx, visible.x, std::max(visible.x, visible.maxX() - frame.w));
  double y = std::clamp(frame.y + dy, visible.y, std::max(visible.y, visible.maxY() - frame.h));
  return {x, y, frame.w, frame.h};
}

inline double ExpandedWidth(double aspect, Rect visible) {
  return std::min(visible.w * 0.65, visible.h * 0.75 * aspect);
}

inline void WidthLimits(double aspect, Size minSize, Size maxSize, Rect visible, double *low, double *high) {
  *low = std::max({minSize.w, minSize.h * aspect, 1.0});
  *high = std::min({maxSize.w, maxSize.h * aspect, visible.w, visible.h * aspect});
  if (*low > *high) *low = *high;
}

inline double Anchor(double origin, double size, double next, double pointer, double low, double high) {
  double before = origin - low, after = high - (origin + size);
  if (std::min(before, after) <= kDockSlop) return before <= after ? origin : origin + size - next;
  double fraction = std::clamp((pointer - origin) / size, 0.0, 1.0);
  return pointer - fraction * next;
}

struct Result {
  Rect frame;
  double width;
};

inline Result Zoom(Rect frame, double width, double aspect, double factor, Point pointer, Rect visible, Size minSize,
                   Size maxSize) {
  double low, high;
  WidthLimits(aspect, minSize, maxSize, visible, &low, &high);
  double w = std::clamp(width * factor, low, high);
  double rw = std::clamp(std::round(w), std::ceil(low), std::max(std::ceil(low), std::floor(high)));
  double rh = std::round(rw / aspect);
  double x = Anchor(frame.x, frame.w, rw, pointer.x, visible.x, visible.maxX());
  double y = Anchor(frame.y, frame.h, rh, pointer.y, visible.y, visible.maxY());
  x = std::clamp(x, visible.x, visible.maxX() - rw);
  y = std::clamp(y, visible.y, visible.maxY() - rh);
  return {{std::round(x), std::round(y), rw, rh}, w};
}

}
