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
  // the codes reqwest follows; another 3xx is the answer
  private val redirects = setOf(301, 302, 303, 307, 308)
  // the whole check, redirects and body included, as reqwest's timeout
  private val limitMs = 15000L

  // → { status, finalUrl, contentType?, body } an answer, or
  //   { error: "tls" | "connect" | "timeout" | "other", detail } no answer
  @Command
  fun probe(invoke: Invoke) {
    val args = invoke.parseArgs(ProbeArgs::class.java)
    Thread {
      val r = try {
        get(URL(args.url), System.nanoTime() + limitMs * 1_000_000)
      } catch (e: Throwable) { // anything: a check that never answers would hang the screen
        JSObject().put("error", kind(e)).put("detail", chain(e))
      }
      invoke.resolve(r)
    }.start()
  }

  // Redirects are followed here, not by HttpURLConnection, which would not
  // follow one between http and https; finalUrl is where the answer came from.
  private fun get(start: URL, deadline: Long): JSObject {
    var url = start
    var hops = 0
    while (true) {
      val ms = left(deadline)
      val c = url.openConnection() as HttpURLConnection
      try {
        c.connectTimeout = minOf(8000, ms)
        c.readTimeout = ms
        c.instanceFollowRedirects = false
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "KiSiauThong-app/" + BuildConfig.VERSION_NAME)
        val status = c.responseCode
        val location = c.getHeaderField("Location")
        if (status in redirects && location != null) {
          if (hops == maxRedirects) throw IOException("too many redirects")
          url = URL(url, location)
          hops++
          continue
        }
        val stream = if (status in 200..299) c.inputStream else c.errorStream
        val body = stream?.use { read(it, deadline) } ?: ""
        val r = JSObject().put("status", status).put("finalUrl", url.toString()).put("body", body)
        c.contentType?.let { r.put("contentType", it) }
        return r
      } finally {
        c.disconnect()
      }
    }
  }

  // milliseconds until the deadline, at least 1 (0 would mean no limit)
  private fun left(deadline: Long): Int {
    val ms = (deadline - System.nanoTime()) / 1_000_000
    if (ms <= 0) throw SocketTimeoutException("the check took over 15 s")
    return ms.toInt()
  }

  // at most 64 KiB, as text
  private fun read(s: InputStream, deadline: Long): String {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(16 * 1024)
    while (out.size() < maxBody) {
      left(deadline)
      val n = s.read(buf)
      if (n < 0) break
      out.write(buf, 0, minOf(n, maxBody - out.size()))
    }
    return String(out.toByteArray(), Charsets.UTF_8)
  }

  private fun kind(e: Throwable): String = when (e) {
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
