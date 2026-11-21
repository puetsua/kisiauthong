// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// The server screen's check on Android: one GET of <server>api/auth/status,
// answered as src/probe.rs does on the other platforms, so connect.js reads
// both the same way. It runs here because HttpURLConnection uses the system's
// trust store and network security policy, the ones the WebView uses; the
// Rust TLS stack would need its own Android set-up and could only differ.
package io.github.puetsua.kisiauthong

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException

@InvokeArg
class ProbeArgs {
  lateinit var url: String
}

@TauriPlugin
class ProbePlugin(activity: Activity) : Plugin(activity) {
  private val maxBody = 64 * 1024
  private val maxRedirects = 5

  // → { status, finalUrl, contentType?, body } an answer, or
  //   { error: "tls" | "connect" | "timeout" | "other", detail } no answer
  @Command
  fun probe(invoke: Invoke) {
    val args = invoke.parseArgs(ProbeArgs::class.java)
    Thread {
      val r = try {
        get(URL(args.url))
      } catch (e: Exception) {
        JSObject().put("error", kind(e)).put("detail", chain(e))
      }
      invoke.resolve(r)
    }.start()
  }

  // Redirects are followed here, not by HttpURLConnection, which would not
  // follow one between http and https; finalUrl is where the answer came from.
  private fun get(start: URL): JSObject {
    var url = start
    var hops = 0
    while (true) {
      val c = url.openConnection() as HttpURLConnection
      try {
        c.connectTimeout = 8000
        c.readTimeout = 15000
        c.instanceFollowRedirects = false
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "KiSiauThong-app/" + BuildConfig.VERSION_NAME)
        val status = c.responseCode
        val location = c.getHeaderField("Location")
        if (status in 300..399 && location != null) {
          if (hops == maxRedirects) throw IOException("too many redirects")
          url = URL(url, location)
          hops++
          continue
        }
        val stream = if (status in 200..299) c.inputStream else c.errorStream
        val body = stream?.use { read(it) } ?: ""
        val r = JSObject().put("status", status).put("finalUrl", url.toString()).put("body", body)
        c.contentType?.let { r.put("contentType", it) }
        return r
      } finally {
        c.disconnect()
      }
    }
  }

  // at most 64 KiB, as text
  private fun read(s: InputStream): String {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(16 * 1024)
    while (out.size() < maxBody) {
      val n = s.read(buf)
      if (n < 0) break
      out.write(buf, 0, minOf(n, maxBody - out.size()))
    }
    return String(out.toByteArray(), Charsets.UTF_8)
  }

  private fun kind(e: Exception): String = when (e) {
    is SSLException -> "tls"
    is SocketTimeoutException -> "timeout"
    is ConnectException, is UnknownHostException, is NoRouteToHostException -> "connect"
    else -> "other"
  }

  private fun chain(e: Throwable): String {
    val out = mutableListOf<String>()
    var cur: Throwable? = e
    while (cur != null && out.size < 8) {
      out.add(cur.message ?: cur.javaClass.simpleName)
      cur = cur.cause
    }
    return out.joinToString(": ")
  }
}
