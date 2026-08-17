// Native module autolinking configuration
// Both platforms enabled — podspec for iOS, Gradle for Android
module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        packageImportPath: 'import com.noodleapps.hakka.rn.HakkaMonitorPackage;',
        packageInstance: 'new HakkaMonitorPackage()',
      },
    },
  },
}
