import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
}

android {
    namespace = "com.noodleapps.hakka.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.noodleapps.hakka.android"
        minSdk = 26
        targetSdk = 37
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

}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":hakka-network"))
    implementation(project(":hakka-ui"))
    // OkHttp is compileOnly in hakka-network, so the app must provide it
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
