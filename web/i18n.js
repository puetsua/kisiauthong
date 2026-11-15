// SPDX-License-Identifier: AGPL-3.0-or-later
// UI translations. English source strings are the keys; a missing translation
// falls back to English. Check coverage with: node scripts/check-i18n.js
"use strict";
const LANGS = { en: "English", "zh-TW": "繁體中文（台灣）" };
const I18N = {
  // Traditional Chinese as used in Taiwan (台灣用語).
  "zh-TW": {
    // navigation and screens
    "Dashboard": "總覽", "Transactions": "交易", "Accounts": "帳戶", "Budgets": "預算", "Money boxes": "存錢筒",
    "Templates": "範本", "Tags": "標籤", "Settings": "設定", "Main": "主選單", "Menu": "選單",
    // enum labels
    "Expense": "支出", "Income": "收入", "Transfer": "轉帳", "Allocate": "分配",
    "Bank": "銀行", "Savings": "儲蓄", "Cash": "現金", "Investment": "投資", "Loan": "貸款",
    "Category": "分類",
    "Every {n} days": "每 {n} 天", "Every {n} weeks": "每 {n} 週", "Every {n} months": "每 {n} 個月", "Every {n} years": "每 {n} 年",
    "days": "天", "weeks": "週", "months": "個月", "years": "年", "Date range": "指定期間", "Custom…": "自訂…",
    "{amount} left": "剩 {amount}", "{amount} over": "超支 {amount}", "Starts {date}": "{date} 開始", "Ended {date}": "{date} 已結束",
    "{amount} a day for {n} day(s)": "每天 {amount}，還有 {n} 天", "{n} day(s) left": "還有 {n} 天", "of {limit}": "／{limit}",
    "{amount} this month": "本月 {amount}", "Nothing spent this month": "本月沒有支出", "Categories": "分類",
    "or": "或", "Sign in with a passkey": "使用通行金鑰登入", "Passkey on {device}": "{device} 上的通行金鑰", "Passkey": "通行金鑰",
    "Added {date}": "{date} 加入", "Last used {date}": "{date} 最後使用", "Add a passkey": "新增通行金鑰", "Passkey name": "通行金鑰名稱",
    "This browser does not support passkeys.": "這個瀏覽器不支援通行金鑰。",
    "Remove this passkey? You will no longer be able to sign in with it.": "要移除這把通行金鑰嗎？之後就不能再用它登入。",
    "Passkey removed.": "已移除通行金鑰。", "Passkey added.": "已新增通行金鑰。", "Passkeys": "通行金鑰",
    "Two-step verification": "兩步驟驗證", "Code from your authenticator app": "驗證器 App 上的驗證碼",
    "Lost your phone? Enter one of your recovery codes instead.": "手機遺失了？改輸入一組備用碼。", "Verify": "驗證", "‹ Back": "‹ 返回",
    "QR code for your authenticator app": "給驗證器 App 掃描的 QR 碼",
    "Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy…).": "用驗證器 App（Google Authenticator、1Password、Authy…）掃描 QR 碼。",
    "Or enter this key by hand:": "或手動輸入這組金鑰：", "Enter the 6-digit code it shows:": "輸入 App 顯示的 6 位數驗證碼：",
    "Two-step verification is on.": "已開啟兩步驟驗證。",
    "Save these recovery codes somewhere safe. Each works once if you lose your phone; they will not be shown again.": "請把這些備用碼存放在安全的地方。手機遺失時，每組可使用一次；之後不會再顯示。",
    "Copy": "複製", "Download": "下載", "Done": "完成", "Copied.": "已複製。", "Copy failed; select the codes instead.": "無法複製，請直接選取備用碼。",
    "Authenticator app": "驗證器 App", "Off": "關閉", "On": "開啟", "Turn on": "開啟", "Turn off": "關閉",
    "{n} recovery code(s) left": "剩 {n} 組備用碼", "Current code": "目前的驗證碼", "Two-step verification is off.": "已關閉兩步驟驗證。",
    "Please sign in again.": "請重新登入。", "Create your account": "建立你的帳號", "Sign in": "登入",
    "You are the first user and will manage this server.": "你是第一位使用者，將負責管理這台伺服器。", "Username": "使用者名稱",
    "Display name": "顯示名稱", "Password": "密碼", "Create account": "建立帳號", "{name}: account menu": "{name}：帳號選單",
    "My account": "我的帳號", "Sign out": "登出", "Profile": "個人資料", "Administrator": "管理員", "Current password": "目前密碼",
    "New password": "新密碼", "Confirm new password": "確認新密碼", "Change password": "變更密碼", "Profile saved.": "已儲存個人資料。",
    "The new passwords do not match.": "兩次輸入的新密碼不一致。", "Password changed. Other devices were signed out.": "密碼已變更，其他裝置已登出。",
    "Language & region": "語言與地區", "Money": "金額", "Display": "顯示", "Layout": "版面", "Export all data": "匯出所有資料",
    "Number format": "數字格式", "Groups of three (1,074,958)": "三位一組（1,074,958）", "Groups of four (107,4958)": "四位一組（107,4958）",
    "Plain (1074958)": "不分位（1074958）", "Number format saved.": "已儲存數字格式。",
    "Time": "時間", "Time zone": "時區", "Auto (this device · {zone})": "自動（這台裝置 · {zone}）", "Time zone saved.": "已儲存時區。",
    "{time} in {zone}": "{zone}當地 {time}", "Total": "總額", "Frequently used": "常用",
    "Owed": "欠款", "Card": "卡片", "Wallet": "錢包", "Phone": "手機", "Coins": "零錢", "Home": "住家", "Car": "汽車", "Travel": "旅行",
    "Gift": "禮物", "Work": "工作", "Shop": "商店", "Globe": "地球", "Icon": "圖示", "Optional": "選填",
    "{name} is at {pct}% of its limit": "{name}已用到上限的 {pct}%",
    "Free {amount}": "可用 {amount}", "Earmarked {amount}": "已預留 {amount}", "Last activity {date}": "最近交易 {date}",
    "No transactions yet": "還沒有交易", 
    "No budgets yet. Give a category a limit to track it here.": "還沒有預算。替分類設定上限，就會在這裡追蹤。", 
    "Edit money box": "編輯存錢筒", "Edit category": "編輯分類", "New money box": "新增存錢筒", "New category": "新增分類",
    "Set a budget": "設定預算", "Every": "每", "First period starts": "第一期開始日", "From": "從", "To": "到",
    "Add money box": "新增存錢筒", "Add category": "新增分類", "Money box added.": "已新增存錢筒。", "Category added.": "已新增分類。",
    "{spent} of {limit} spent · {period}": "已花 {spent}／{limit} · {period}",
    "Daily": "每日", "Weekly": "每週", "Monthly": "每月", "Quarterly": "每季", "Yearly": "每年",
    // common columns and fields
    "Account": "帳戶", "Amount": "金額", "Date": "日期", "Tag": "標籤", "Note": "備註", "Status": "狀態", "Kind": "類型",
    "Name": "名稱", "Currency": "幣別", "Balance": "餘額", "Earmarked": "已預留", "Free": "可用",
    "Budget": "預算", "Spent": "已花費", "Progress": "進度", "Remaining": "剩餘", "Share": "佔比",
    "Template": "範本", "Generates": "產生", "Schedule": "排程", "Next due": "下次到期", "Decision": "決定", "To account": "轉入帳戶", "Title": "標題", "Rows": "列數", "Show": "顯示",
    // dashboard
    "Balances by currency": "各幣別餘額", "Expected to confirm": "待確認",
    "Spending this month": "本月支出", "Recent transactions": "最近交易", "Customize dashboard": "自訂總覽",
    "Widgets": "小工具", "Add": "加入", "Remove": "移除", "Width": "寬度", "‹ All widgets": "‹ 所有小工具",
    "Move {widget} earlier": "將{widget}往前移", "Move {widget} later": "將{widget}往後移",
    "Settings for {widget}": "{widget}設定", "Remove {widget}": "移除{widget}", "Remove from dashboard": "從總覽移除", "Duplicate": "複製", "Columns": "欄位", "Used": "已用", "Limit": "上限", "% of spending": "占支出比例",
    "Move {column} left": "將{column}往左移", "Move {column} right": "將{column}往右移", "Keep at least one column.": "至少保留一個欄位。",
    "No widgets yet. Customize the dashboard to add some.": "還沒有小工具。自訂總覽來加入。", "Drop here to remove": "拖到這裡移除",
    "Drag widgets here, or use Add.": "把小工具拖到這裡，或按「加入」。",
    "Keep at least one item, or remove the widget.": "至少保留一項，或移除這個小工具。",
    "Reset to default": "還原預設", "Cancel": "取消", "Save": "儲存",
    "Full width": "全寬", "Half width": "半寬",
    "{n} account(s)": "{n} 個帳戶",
    "No budgets yet.": "還沒有預算。",
    "Uncategorised": "未分類", "No posted expenses this month.": "本月還沒有已入帳的支出。", "No money boxes yet.": "還沒有存錢筒。",
    "Dashboard saved.": "總覽已儲存。", "Dashboard reset.": "總覽已還原預設。",
    "{spent} of {limit}": "{spent}／{limit}", "{saved} of {target} · {pct}%": "{saved}／{target} · {pct}%", "by {date}": "{date} 前",
    "No allocations yet": "還沒有分配",
    // transactions
    "All accounts": "所有帳戶", "All types": "所有類型",
    "Clear": "清除", "Today": "今天", "Expected range {min} – {max}.": "預計範圍 {min} – {max}。",
    "Expected on {date}, not confirmed yet. Check the amount and save to confirm it.": "預計在 {date}，尚未確認。核對金額後儲存即可確認。",
    "Has a note": "有備註",
    "Details worth remembering: who, why, receipt number…": "值得記下的細節：和誰、為什麼、收據號碼…", "A negative amount takes money back out of the money box.": "輸入負數可以把錢從存錢筒撥回帳戶。", "Enter an amount other than zero.": "金額不能是 0。",
    "{box} holds {amount} in {account}; you can take out at most that.": "{box}在{account}只有 {amount}，最多只能撥回這個金額。",
    "External": "外部", "External accounts": "外部帳戶", "New external account": "新增外部帳戶",
    "Paid to": "付給", "Received from": "收自", "Employer": "雇主", "Notifications": "通知", "Notifications ({n})": "通知（{n}）", "Dismiss": "清除", "Dismiss all": "全部清除",
    "You're all caught up.": "沒有新通知。", "Open in Transactions": "到交易頁查看", "Waiting for confirmation · {date} · {amount}": "等待確認 · {date} · {amount}",
    "{name} is over budget": "{name}超出預算",
    "{name} has used {pct}% of its budget": "{name}已用掉預算的 {pct}%", 
    "{name} reached its target": "{name}已達成目標", "{saved} of {target} saved": "已存 {saved}／{target}",
    "{name} passed its target date": "{name}已過目標日期", "{saved} of {target} saved; target date was {date}": "已存 {saved}／{target}，目標日期是 {date}", "Week": "週", "Month": "月", "Custom": "自訂", "Period": "期間", "Back to today": "回到今天", "End date": "結束日期",
    "No transactions in this period.": "這段期間沒有交易。", "A range can be at most {n} days.": "日期範圍最多 {n} 天。", "Tags": "標籤", "{n} transaction(s)": "{n} 筆交易", "Days open by default": "預設展開天數", "Days open by default saved.": "預設展開天數已儲存。", "Yesterday": "昨天", "No transactions yet.": "還沒有交易。", "Search note, tag, account…": "搜尋備註、標籤、帳戶…", "‹ Previous": "‹ 上一頁", "Next ›": "下一頁 ›",
    "Delete this transaction? This cannot be undone.": "要刪除這筆交易嗎？刪除後無法復原。", "Deleted.": "已刪除。",
    "Add transaction": "新增交易", "Edit transaction": "編輯交易", "Save transaction": "儲存交易", "Transaction editor": "交易編輯器",
    "Transaction updated.": "交易已更新。", "Saved.": "已儲存。", "Groceries": "買菜", "Close": "關閉",
    "From account": "轉出帳戶", "Money box": "存錢筒", "Choose an account to transfer to.": "請選擇轉入帳戶。",
    "No other {currency} account. To move money into another currency, record spending in one account and income in the other.": "沒有其他 {currency} 帳戶。要換成其他幣別，請在一個帳戶記一筆支出，再在另一個帳戶記一筆收入。", "Target amount": "目標金額",
    "Allocate to money box": "分配到存錢筒",
    // accounts
    "New account": "新增帳戶", "Edit account": "編輯帳戶",
    "Add account": "新增帳戶", "Save changes": "儲存變更", "Account added.": "帳戶已新增。", "Account updated.": "帳戶已更新。",
    "Opening balance": "期初餘額", "Savings A": "儲蓄帳戶 A",
    "{owed} owed of {limit} ({pct}%)": "欠款 {owed}／額度 {limit}（{pct}%）",
    // tags
    "Tag updated.": "標籤已更新。", "Target date": "目標日期", "House fund": "購屋基金", "Food": "餐飲",
    "History": "紀錄", "History — {name}": "紀錄：{name}",
    // money boxes
    // templates
    "Transaction templates": "交易範本", "Generate due": "產生到期項目", "+ New template": "＋ 新增範本", "No templates yet.": "還沒有範本。",
    "Enabled": "啟用中", "Paused": "已暫停", "Pause": "暫停", "Resume": "繼續",
    "Template added.": "範本已新增。", "Template updated.": "範本已更新。", "Add template": "新增範本",
    "New transaction template": "新增交易範本", "Edit transaction template": "編輯交易範本", "Streaming": "影音串流", "Frequency": "頻率", "Day of month": "每月日期", "Start date": "開始日期",
    "Expected min (variable bill, optional)": "預計最低（金額不固定的帳單，選填）", "Expected max (variable bill, optional)": "預計最高（金額不固定的帳單，選填）",
    "variable {min}–{max}": "不固定 {min}–{max}", "day {n}": "{n} 日", "from {date}": "自 {date} 起",
    "Generated {n} due transaction(s).": "已產生 {n} 筆到期交易。",
    // confirm
    "Confirm expected transaction": "確認預計交易", "Delete": "刪除",
    // settings
    "Language": "語言", "Browser default": "依瀏覽器設定", "Language saved.": "語言已儲存。",
    "Page width": "頁面寬度", "Default": "預設", "Wide": "加寬", "Page width saved.": "頁面寬度已儲存。",
    "Default currency": "預設幣別", "Default currency saved.": "預設幣別已儲存。", "Frequently used currencies": "常用幣別",
    "Add currency": "新增幣別", "+ Add currency…": "＋ 新增幣別…", "Remove {currency}": "移除 {currency}", "All currencies": "所有幣別",
    "{currency} added.": "已新增 {currency}。", "{currency} removed.": "已移除 {currency}。",
    "Reset the dashboard to its default layout?": "要把總覽還原成預設版面嗎？",
    "Data": "資料", "Export JSON": "匯出 JSON", "About": "關於", "License": "授權條款", "Source": "原始碼",
    "Set KISIAUTHONG_SOURCE_URL": "請設定 KISIAUTHONG_SOURCE_URL", "— none —": "— 無 —",
    // errors
    "Error: {message}": "錯誤：{message}", "Failed to load: {message}": "載入失敗：{message}",
    "Settings unavailable, using defaults: {message}": "無法讀取設定，改用預設值：{message}",
  },
};
let LANG = "en";
// N_ marks a string for translation without translating it yet (translated where shown).
const N_ = (s) => s;
function __(s, vars) {
  let r = (LANG !== "en" && I18N[LANG] && I18N[LANG][s]) || s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return r;
}
// pickLang resolves the stored preference ("" = follow the browser).
function pickLang(pref) {
  if (pref && LANGS[pref]) return pref;
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const x = String(l).toLowerCase();
    if (x === "zh-tw" || x.startsWith("zh-hant")) return "zh-TW";
    if (x.startsWith("en")) return "en";
  }
  return "en";
}
function setLang(lang) {
  LANG = LANGS[lang] ? lang : "en";
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = __(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", __(el.dataset.i18nAria)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => el.setAttribute("title", __(el.dataset.i18nTitle)));
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => el.setAttribute("placeholder", __(el.dataset.i18nPlaceholder)));
}
