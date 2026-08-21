#include "hakka_sim_inject_c.h"

/// dyld runs every `__attribute__((constructor))` function in an image as
/// soon as that image is mapped — for a dylib inserted via
/// `DYLD_INSERT_LIBRARIES`, that happens before the host process's own
/// `main()`. This is the one piece of C in this package; it exists only
/// because Swift refuses to define ObjC's `+load` (see SimInjectBootstrap.swift),
/// and dyld constructors are otherwise a C-level mechanism.
__attribute__((constructor))
static void hakka_sim_inject_ctor(void) {
    hakka_sim_inject_start();
}
