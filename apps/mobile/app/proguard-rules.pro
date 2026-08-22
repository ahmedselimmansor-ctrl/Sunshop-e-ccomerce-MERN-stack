# kotlinx.serialization keeps generated serializers off the entry-point graph;
# without these rules R8 strips them and every response fails to parse.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.sunshop.app.**$$serializer { *; }
-keepclassmembers class com.sunshop.app.** {
    *** Companion;
}

# Retrofit interfaces are referenced reflectively.
-keep,allowobfuscation interface retrofit2.Call
-keepattributes Signature, Exceptions

# OkHttp platform warnings for optional providers.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**

# androidx.security:security-crypto pulls in Tink, which is annotated with
# Error Prone's compile-only annotations. They are deliberately absent at
# runtime, so R8 must be told the dangling references are expected rather than
# failing the release build over them.
-dontwarn com.google.errorprone.annotations.**
