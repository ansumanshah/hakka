import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.noodleapps.hakka.benchmark"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.noodleapps.hakka.benchmark"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    flavorDimensions += "inspector"
    productFlavors {
        create("baseline") {
            dimension = "inspector"
            applicationIdSuffix = ".baseline"
        }
        create("hakka") {
            dimension = "inspector"
            applicationIdSuffix = ".hakka"
        }
        create("chucker") {
            dimension = "inspector"
            applicationIdSuffix = ".chucker"
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
        }
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
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    add("hakkaImplementation", project(":hakka-network"))
    add("hakkaImplementation", project(":hakka-performance"))

    add("chuckerImplementation", "com.github.chuckerteam.chucker:library:4.2.0")
}
