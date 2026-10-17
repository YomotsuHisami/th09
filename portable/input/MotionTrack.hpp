#pragma once
#include "../../third_party/eagler-common/include/eagler/input/MotionTrack.hpp"

namespace touhou::input {
using MotionTrack = eagler::input::MotionTrack<false>;
using eagler::input::limit_vector;
}
