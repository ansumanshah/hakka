#ifndef HAKKA_SIM_INJECT_C_H
#define HAKKA_SIM_INJECT_C_H

/// Implemented in Swift (`HakkaSimInject/SimInjectBootstrap.swift`) via
/// `@_cdecl("hakka_sim_inject_start")`. Declared here so the C constructor
/// in `constructor.c` can call it without a generated bridging header.
extern void hakka_sim_inject_start(void);

#endif
