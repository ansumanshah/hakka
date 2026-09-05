import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
}

android {
    namespace = "com.noodleapps.hakka.sizegate"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.noodleapps.hakka.sizegate"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
    }

    flavorDimensions += "hakka"
    productFlavors {
        create("baseline") {
            dimension = "hakka"
            applicationIdSuffix = ".baseline"
        }
        create("noop") {
            dimension = "hakka"
            applicationIdSuffix = ".noop"
        }
        create("network") {
            dimension = "hakka"
            applicationIdSuffix = ".network"
        }
        create("performanceNoop") {
            dimension = "hakka"
            applicationIdSuffix = ".performance.noop"
        }
        create("performance") {
            dimension = "hakka"
            applicationIdSuffix = ".performance"
        }
        create("baseSdk") {
            dimension = "hakka"
            applicationIdSuffix = ".base"
        }
        create("full") {
            dimension = "hakka"
            applicationIdSuffix = ".full"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    add("baselineImplementation", "com.squareup.okhttp3:okhttp:4.12.0")

    add("noopImplementation", project(":hakka-network-noop"))
    add("noopImplementation", "com.squareup.okhttp3:okhttp:4.12.0")

    add("networkImplementation", project(":hakka-network"))
    add("networkImplementation", "com.squareup.okhttp3:okhttp:4.12.0")

    add("performanceNoopImplementation", project(":hakka-performance-noop"))
    add("performanceNoopImplementation", "com.squareup.okhttp3:okhttp:4.12.0")

    add("performanceImplementation", project(":hakka-performance"))
    add("performanceImplementation", "com.squareup.okhttp3:okhttp:4.12.0")

    add("baseSdkImplementation", project(":hakka-network"))
    add("baseSdkImplementation", project(":hakka-performance"))
    add("baseSdkImplementation", "com.squareup.okhttp3:okhttp:4.12.0")

    add("fullImplementation", project(":hakka-network"))
    add("fullImplementation", project(":hakka-ui"))
    add("fullImplementation", "com.squareup.okhttp3:okhttp:4.12.0")
}
