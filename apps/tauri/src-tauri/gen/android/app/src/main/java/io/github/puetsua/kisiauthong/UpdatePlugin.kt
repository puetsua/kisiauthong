// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// App updates on Android (ADR 0020). The Rust side (src/update.rs) decides
// what to install; this class only does what needs Android: an HTTPS request
// with the system's trust store, the download with its SHA-256 check, and
// handing the APK to the system installer, which also refuses an APK not
// signed with this app's key. Only the bundled server screen reaches it,
// through the app's own commands (src/lib.rs). Rejections are codes the App
// updates screen puts into words: "badAnswer: …" (fetch), "checksum",
// "download: …" and "installer: …" (install).
package io.github.puetsua.kisiauthong

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

@InvokeArg
class FetchArgs {
  lateinit var url: String
}

@InvokeArg
class InstallArgs {
  lateinit var url: String
  lateinit var sha256: String
  var size: Long = 0
}

@TauriPlugin
class UpdatePlugin(private val activity: Activity) : Plugin(activity) {
  init {
    // the installer copies an APK before it asks, so none is needed once the app runs again
    Thread { File(activity.cacheDir, "updates").deleteRecursively() }.start()
  }

  private fun open(url: String): HttpURLConnection {
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 15000
    c.readTimeout = 30000
    c.instanceFollowRedirects = true
    c.setRequestProperty("Accept", "application/vnd.github+json")
    c.setRequestProperty("User-Agent", "KiSiauThong-app")
    return c
  }

  // GET a small JSON document → { status, body }
  @Command
  fun fetch(invoke: Invoke) {
    val args = invoke.parseArgs(FetchArgs::class.java)
    Thread {
      try {
        val c = open(args.url)
        try {
          val status = c.responseCode
          val stream = if (status in 200..299) c.inputStream else c.errorStream
          val body = stream?.use { s ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(16 * 1024)
            while (true) {
              val n = s.read(buf)
              if (n < 0) break
              out.write(buf, 0, n)
              if (out.size() > 1_000_000) {
                invoke.reject("badAnswer: the answer is over 1 MB")
                return@Thread
              }
            }
            out.toString("UTF-8")
          } ?: ""
          invoke.resolve(JSObject().put("status", status).put("body", body))
        } finally {
          c.disconnect()
        }
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }.start()
  }

  // Download, check, install → { status: "started" | "permission" }
  @Command
  fun install(invoke: Invoke) {
    val args = invoke.parseArgs(InstallArgs::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
      // Android asks once per app: "Allow from this source"; the user comes back and taps Install again
      val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
      try {
        activity.startActivity(i)
        invoke.resolve(JSObject().put("status", "permission"))
      } catch (e: Exception) {
        invoke.reject("installer: " + (e.message ?: e.toString()))
      }
      return
    }
    Thread {
      // a new file each time: an installer may still be reading an earlier one
      val dir = File(activity.cacheDir, "updates")
      val apk = File(dir, "kisiauthong-update-" + System.currentTimeMillis() + ".apk")
      try {
        dir.mkdirs()
        val c = open(args.url)
        val md = MessageDigest.getInstance("SHA-256")
        var total = 0L
        try {
          c.setRequestProperty("Accept", "application/octet-stream")
          if (c.responseCode !in 200..299) throw IOException("HTTP " + c.responseCode)
          c.inputStream.use { input ->
            apk.outputStream().use { out ->
              val buf = ByteArray(64 * 1024)
              while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                if (total > args.size) throw IOException("the download is larger than the release says")
                md.update(buf, 0, n)
                out.write(buf, 0, n)
              }
            }
          }
        } finally {
          c.disconnect()
        }
        val hex = md.digest().joinToString("") { "%02x".format(it) }
        if (total != args.size || !hex.equals(args.sha256, ignoreCase = true)) {
          apk.delete()
          invoke.reject("checksum")
          return@Thread
        }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", apk)
        val i = Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.runOnUiThread {
          try {
            activity.startActivity(i)
            invoke.resolve(JSObject().put("status", "started"))
          } catch (e: Exception) {
            invoke.reject("installer: " + (e.message ?: e.toString()))
          }
        }
      } catch (e: Exception) {
        apk.delete()
        invoke.reject("download: " + (e.message ?: e.toString()))
      }
    }.start()
  }
}
