import java.util.Properties

plugins {
    id("com.android.application")
}

// بستهٔ وب که PyInstaller-وار داخل APK می‌رود: همان خروجی `npm run build:mobile`
val webBundle = rootProject.file("../frontend/dist-mobile")

android {
    namespace = "ir.kavosh.db"
    compileSdk = 35

    defaultConfig {
        applicationId = "ir.kavosh.db"
        minSdk = 24
        targetSdk = 35
        versionCode = 13
        versionName = "3.4.0"
    }

    sourceSets["main"].assets.srcDirs("src/main/assets", webBundle)

    signingConfigs {
        create("release") {
            // کلید داخلی مخزن: برای توزیع درون‌سازمانی، تا نسخهٔ جدید روی
            // نسخهٔ قبلی نصب شود. برای انتشار عمومی باید جایگزین شود.
            val props = Properties().apply {
                val file = rootProject.file("keystore/keystore.properties")
                if (file.exists()) file.inputStream().use { load(it) }
            }
            val store = rootProject.file(props.getProperty("storeFile", "keystore/kavosh.jks"))
            if (store.exists()) {
                storeFile = store
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // چیزی برای کوچک‌سازی نیست: کل کد جاوا یک اکتیویتی است و رابط
            // کاربری وب از قبل بیلد و فشرده شده. خاموش بودنش یعنی هیچ قاعدهٔ
            // مبهم ProGuard نمی‌تواند بی‌صدا چیزی را خراب کند.
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.13.1")
}

// بدون بستهٔ وب، APK ساخته می‌شود ولی صفحهٔ سفید نشان می‌دهد؛ بهتر است
// همین‌جا با پیام روشن بایستد.
val checkWebBundle by tasks.registering {
    doFirst {
        val missing = listOf("index.html", "kb.sqlite").filterNot { webBundle.resolve(it).exists() }
        if (missing.isNotEmpty()) {
            throw GradleException(
                "بستهٔ وب ناقص است (${missing.joinToString()}) در $webBundle\n" +
                    "پیش از ساخت APK اجرا کنید:\n" +
                    "  cd backend && python3 -m core.indexer --kb kb --out ../frontend/public-mobile/kb.sqlite --instance instances/live\n" +
                    "  cd frontend && npm ci && npm run build:mobile",
            )
        }
    }
}

tasks.named("preBuild") { dependsOn(checkWebBundle) }
