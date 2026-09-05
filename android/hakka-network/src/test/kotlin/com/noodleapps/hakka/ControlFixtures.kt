package com.noodleapps.hakka

import java.io.File
import org.json.JSONObject

/**
 * Loads a pinned control-channel wire fixture from the repo-shared
 * `fixtures/control/` directory — the same JSON the TypeScript and Swift
 * parser tests assert against, so the three runtimes cannot drift apart on
 * the `breakpoint.paused` / `.resume` / `.abort` shapes. See
 * `fixtures/control/README.md`.
 *
 * Gradle's test working directory varies (module dir vs. repo root
 * depending on how the task is invoked), so this walks up from the current
 * working directory until it finds a `fixtures` sibling, rather than
 * assuming a fixed relative depth.
 */
object ControlFixtures {
    private val repoRoot: File by lazy {
        var dir = File(System.getProperty("user.dir")).absoluteFile
        var depth = 0
        while (!File(dir, "fixtures").isDirectory && depth < 10) {
            dir = dir.parentFile ?: break
            depth += 1
        }
        dir
    }

    fun readJSON(name: String): JSONObject {
        val file = File(repoRoot, "fixtures/control/$name")
        return JSONObject(file.readText())
    }

    fun readRuntimeControlJSON(name: String): JSONObject {
        val file = File(repoRoot, "fixtures/runtime-control/$name")
        return JSONObject(file.readText())
    }
}
