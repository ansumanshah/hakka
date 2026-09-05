plugins {
    id("java-library")
    id("org.jetbrains.kotlin.jvm") version "2.2.21"
    id("com.vanniktech.maven.publish") version "0.37.0"
}

repositories {
    mavenCentral()
}

group = "com.noodleapps.hakka"
version = "0.0.1"

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    api(project(":hakka-common"))
    compileOnly("com.squareup.okhttp3:okhttp:4.12.0")
    compileOnly("org.json:json:20260814")

    testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")
    testImplementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.json:json:20260814")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.1.3")
}

tasks.test {
    useJUnitPlatform()
}

mavenPublishing {
    publishToMavenCentral()
    if (providers.gradleProperty("signingInMemoryKey").isPresent) {
        signAllPublications()
    }
    coordinates("com.noodleapps.hakka", "hakka-network", "0.0.1")
    pom {
        name.set("Hakka Network")
        description.set("OkHttp network interceptor for Android — zero-config request capture")
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
