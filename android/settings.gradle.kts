pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    resolutionStrategy {
        eachPlugin {
            if (requested.id.id == "com.vanniktech.maven.publish") {
                useModule("com.vanniktech:gradle-maven-publish-plugin:${requested.version}")
            }
        }
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "hakka-android"

include(":hakka-common")
include(":hakka-network")
include(":hakka-network-noop")
include(":hakka-performance")
include(":hakka-performance-noop")
include(":hakka-ui")
include(":example")
include(":size-gate")
include(":benchmark")
