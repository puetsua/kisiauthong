// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 kisiauthong contributors
//
// Strings of the app's server screen, in English and Traditional Chinese as
// used in Taiwan. scripts/test-app.js checks both have the same keys and the
// same {url} placeholders.
"use strict";
(function (root) {
  const STRINGS = {
    en: {
      firstTitle: "Connect to a server",
      firstLead: "Enter the address of your KiSiauThong server, then sign in.",
      addTitle: "Add server",
      editTitle: "Edit server",
      nameLabel: "Name (optional)",
      urlLabel: "Server address",
      hint: "The address may include a path, such as",
      connect: "Connect",
      connecting: "Connecting…",
      save: "Save",
      cancel: "Cancel",
      invalidTitle: "Check the address",
      invalidText: "Enter an address that starts with https:// or http://, such as https://example.com/.",
      unreachableTitle: "Cannot reach the server",
      unreachableText: "Could not connect to {url}. Check that the address is right, the server is running, and this device can reach it (for example, Tailscale is connected).",
      notServerTitle: "Not a KiSiauThong server",
      notServerText: "{url} answered, but not as a KiSiauThong server. Check the address, including a path such as /kisiauthong/.",
      cleartextTitle: "Unencrypted connection blocked",
      cleartextText: "{url} uses unencrypted http://, which this app allows only on your own network, such as 192.168.x.x, a .local name or a Tailscale 100.x.y.z address. Use an https:// address.",
      certificateTitle: "Certificate not trusted",
      certificateText: "A secure connection to {url} failed: the server's certificate is invalid, expired, or not trusted by this device.",
      saveTitle: "Could not save the server",
      saveText: "{url}",
    },
    "zh-TW": {
      firstTitle: "連線到伺服器",
      firstLead: "輸入你的記數通伺服器網址，連線後再登入。",
      addTitle: "新增伺服器",
      editTitle: "編輯伺服器",
      nameLabel: "名稱（選填）",
      urlLabel: "伺服器網址",
      hint: "網址可以包含路徑，例如",
      connect: "連線",
      connecting: "連線中…",
      save: "儲存",
      cancel: "取消",
      invalidTitle: "請檢查網址",
      invalidText: "請輸入以 https:// 或 http:// 開頭的網址，例如 https://example.com/。",
      unreachableTitle: "連不上伺服器",
      unreachableText: "無法連到 {url}。請確認網址正確、伺服器已開啟，而且這台裝置連得到它（例如已連上 Tailscale）。",
      notServerTitle: "這不是記數通伺服器",
      notServerText: "{url} 有回應，但不是記數通伺服器。請確認網址，包括 /kisiauthong/ 這類路徑。",
      cleartextTitle: "已封鎖未加密的連線",
      cleartextText: "{url} 使用未加密的 http://，這個 App 只允許在自己的網路內使用，例如 192.168.x.x、.local 名稱或 Tailscale 的 100.x.y.z 位址。請改用 https:// 網址。",
      certificateTitle: "憑證不受信任",
      certificateText: "無法安全連線到 {url}：伺服器的憑證無效、已過期，或不受這台裝置信任。",
      saveTitle: "無法儲存伺服器",
      saveText: "{url}",
    },
  };
  if (typeof module === "object" && module.exports) module.exports = STRINGS;
  else root.KstStrings = STRINGS;
})(this);
