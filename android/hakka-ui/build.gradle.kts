plugins {
    id("com.android.library")
    kotlin("android")
    id("com.vanniktech.maven.publish") version "0.36.0"
}

group = "com.noodleapps.hakka"
version = "0.0.1"

android {
    namespace = "com.noodleapps.hakka.ui"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("proguard-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":hakka-common"))
    implementation(project(":hakka-network"))
    implementation(project(":hakka-performance"))
    implementation("androidx.core:core-ktx:1.16.0")
    // Request list view recycling (HakkaActivity) — a standard, near-ubiquitous AndroidX
    // artifact (most host apps already pull it in transitively via appcompat/material),
    // not a "real" third-party dependency in the sense the "zero external deps" POM
    // description above is guarding against (OkHttp/Timber/etc.).
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    // compileOnly (never bundled) — the host app already provides OkHttp, same as
    // hakka-network. Used by the one-line `OkHttpClient.Builder.installHakka()` DSL.
    compileOnly("com.squareup.okhttp3:okhttp:4.12.0")
    // compileOnly (never bundled into hakka-* artifacts) — the host app provides Timber
    // if it wants HakkaTimberTree wired in. Guarded to be a no-op when absent from the
    // classpath (see HakkaTimberTree.kt / Hakka.plantTimber()).
    compileOnly("com.jakewharton.timber:timber:5.0.1")

    testImplementation("org.junit.jupiter:junit-jupiter:6.0.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.0.3")
    testImplementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("com.jakewharton.timber:timber:5.0.1")
    // Real org.json impl for JVM unit tests — Android's compileSdk stub throws "Stub!" at
    // runtime. Same test-only dependency hakka-network already uses; never bundled.
    testImplementation("org.json:json:20231013")
}

tasks.withType<Test> {
    useJUnitPlatform()
}

mavenPublishing {
    publishToMavenCentral()
    signAllPublications()
    coordinates("com.noodleapps.hakka", "hakka-ui", "0.0.1")
    pom {
        name.set("Hakka UI")
        description.set("Native Android notification + overlay UI for Hakka — depends only on androidx.recyclerview")
        url.set("https://github.com/ansumanshah/hakka")
        licenses {
            license {
                name.set("MIT")
                url.set("https://opensource.org/licenses/MIT")
            }
        }
        developers {
            developer {
                id.set("ansumanshah")
                name.set("Ansuman Shah")
            }
        }
        scm {
            url.set("https://github.com/ansumanshah/hakka")
        }
    }
}
