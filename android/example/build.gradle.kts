plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.noodleapps.hakka.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.noodleapps.hakka.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
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
    implementation(project(":hakka-network"))
    implementation(project(":hakka-ui"))
    // OkHttp is compileOnly in hakka-network, so the app must provide it
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
