/**
 * 仕入れ管理スクリプト
 *
 * 【設定シート構造】
 *   A列: ラベル（行1: パートナーID / 行2: パートナーキー / 行3: ショップID / 行4: アクセストークン / 行5: リフレッシュトークン）
 *   B列以降: ショップごとの値（複数ショップ対応）
 *   ※ パートナーIDとパートナーキーは全ショップ共通のためB1・B2のみ使用
 *
 * 【初回セットアップ手順】
 *   1. 設定シートの B1 にパートナーID、B2 にパートナーキーを入力
 *   2. メニュー「Shopee認証」→「① 認証URLを表示」でURLを開く
 *   3. Shopeeでショップを認証する
 *   4. 認証後にブラウザのアドレスバーに表示されるURLをコピー
 *   5. メニュー「Shopee認証」→「② 認証完了（URLを貼り付け）」にURLを貼り付ける
 *   6. 設定シートにトークンが自動保存されたら完了
 */

var SS_P = SpreadsheetApp.getActiveSpreadsheet();
var CONFIG_P = SS_P.getSheetByName("設定");

// =============================================
// メニュー
// =============================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Shopee認証")
    .addItem("① 認証URLを表示", "showAuthUrl")
    .addItem("② 認証完了（URLを貼り付け）", "completeAuth")
    .addSeparator()
    .addItem("トークン手動更新（全ショップ）", "refreshAllTokens")
    .addToUi();
}

// =============================================
// Shopee 認証フロー
// =============================================

/**
 * STEP 1: 認証URLを生成してダイアログに表示する
 */
function showAuthUrl() {
  var ui = SpreadsheetApp.getUi();

  CONFIG_P = SS_P.getSheetByName("設定");
  if (!CONFIG_P) {
    ui.alert("エラー", "「設定」という名前のシートが見つかりません。作成してください。", ui.ButtonSet.OK);
    return;
  }

  var pId  = String(CONFIG_P.getRange("B1").getValue()).trim();
  var pKey = String(CONFIG_P.getRange("B2").getValue()).trim();

  if (!pId || pId === "" || !pKey || pKey === "") {
    ui.alert("エラー", "設定シートの B1（パートナーID）と B2（パートナーキー）を入力してください。", ui.ButtonSet.OK);
    return;
  }

  // リダイレクト先はlocalhostを使用（サーバー不要）
  var redirectUrl = "https://localhost";
  var path        = "/api/v2/shop/auth_partner";
  var timestamp   = Math.floor(Date.now() / 1000);
  var sign        = computeHmacSign(String(pId) + path + String(timestamp), pKey);
  var authUrl     = "https://partner.shopeemobile.com" + path
    + "?partner_id=" + pId
    + "&timestamp=" + timestamp
    + "&sign=" + sign
    + "&redirect=" + encodeURIComponent(redirectUrl);

  var html = HtmlService.createHtmlOutput(
    "<style>body{font-family:sans-serif;padding:16px;line-height:1.6}</style>"
    + "<h3>STEP 1: 以下のURLをクリックして認証してください</h3>"
    + "<p><a href='" + authUrl + "' target='_blank'>" + authUrl + "</a></p>"
    + "<hr>"
    + "<h3>STEP 2: 認証後の操作</h3>"
    + "<ol>"
    + "<li>Shopeeでショップを選択して「同意する」をクリック</li>"
    + "<li>ブラウザが「このサイトにアクセスできません」エラーになります（正常です）</li>"
    + "<li><b>ブラウザのアドレスバーに表示されているURL全体をコピー</b></li>"
    + "<li>このダイアログを閉じて、メニュー「Shopee認証」→「② 認証完了（URLを貼り付け）」を実行</li>"
    + "</ol>"
  ).setWidth(680).setHeight(320);

  ui.showModalDialog(html, "Shopee 認証 - STEP 1");
}

/**
 * STEP 2: リダイレクト後のURLを貼り付けてトークンを取得・保存する
 */
function completeAuth() {
  var ui = SpreadsheetApp.getUi();

  CONFIG_P = SS_P.getSheetByName("設定");
  if (!CONFIG_P) {
    ui.alert("エラー", "「設定」という名前のシートが見つかりません。", ui.ButtonSet.OK);
    return;
  }

  var pId  = String(CONFIG_P.getRange("B1").getValue()).trim();
  var pKey = String(CONFIG_P.getRange("B2").getValue()).trim();

  if (!pId || !pKey) {
    ui.alert("エラー", "設定シートの B1（パートナーID）と B2（パートナーキー）を入力してください。", ui.ButtonSet.OK);
    return;
  }

  var result = ui.prompt(
    "Shopee認証 - STEP 2",
    "認証後にブラウザのアドレスバーに表示されたURL全体を貼り付けてください:\n（例: https://localhost?code=xxxx&shop_id=yyyy）",
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) return;

  var pastedUrl = result.getResponseText().trim();

  if (!pastedUrl) {
    ui.alert("エラー", "URLが入力されていません。", ui.ButtonSet.OK);
    return;
  }

  // URLからcodeとshop_idを抽出
  var code   = extractParam(pastedUrl, "code");
  var shopId = extractParam(pastedUrl, "shop_id");

  if (!code || !shopId) {
    ui.alert("エラー", "URLからcodeまたはshop_idを取得できませんでした。\n貼り付けたURL: " + pastedUrl, ui.ButtonSet.OK);
    return;
  }

  // トークン取得
  var tokens = fetchTokenByCode(pId, pKey, shopId, code);

  if (tokens && tokens.access_token) {
    saveTokensToConfig(shopId, tokens.access_token, tokens.refresh_token);
    ui.alert("認証成功", "ショップID " + shopId + " のトークンを設定シートに保存しました。", ui.ButtonSet.OK);
  } else {
    ui.alert("エラー", "トークンの取得に失敗しました。\n詳細: " + JSON.stringify(tokens), ui.ButtonSet.OK);
  }
}

/**
 * URLからクエリパラメータを抽出するヘルパー
 */
function extractParam(url, key) {
  var match = url.match(new RegExp("[?&]" + key + "=([^&]+)"));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 認証コード → アクセストークン
 */
function fetchTokenByCode(pId, pKey, shopId, code) {
  var path      = "/api/v2/auth/token/get";
  var timestamp = Math.floor(Date.now() / 1000);
  var sign      = computeHmacSign(String(pId) + path + String(timestamp), pKey);
  var url       = "https://partner.shopeemobile.com" + path
    + "?partner_id=" + pId
    + "&timestamp=" + timestamp
    + "&sign=" + sign;

  var payload = {
    code:       String(code),
    partner_id: Number(pId),
    shop_id:    Number(shopId)
  };

  var res = JSON.parse(
    UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    }).getContentText()
  );

  return res.access_token ? res : res;
}

/**
 * 設定シートにトークンを保存（既存列に上書き、なければ新規追加）
 */
function saveTokensToConfig(shopId, accessToken, refreshToken) {
  var lastCol   = CONFIG_P.getLastColumn();
  var targetCol = -1;

  if (lastCol >= 2) {
    var shopIds = CONFIG_P.getRange(3, 2, 1, lastCol - 1).getValues()[0];
    for (var i = 0; i < shopIds.length; i++) {
      if (String(shopIds[i]) === String(shopId)) {
        targetCol = i + 2;
        break;
      }
    }
  }

  if (targetCol === -1) {
    targetCol = (lastCol < 2 ? 2 : lastCol + 1);
    CONFIG_P.getRange(3, targetCol).setValue(shopId);
  }

  CONFIG_P.getRange(4, targetCol).setValue(accessToken);
  CONFIG_P.getRange(5, targetCol).setValue(refreshToken);
}

/**
 * 全ショップのトークンをリフレッシュトークンで更新
 */
function refreshAllTokens() {
  var ui      = SpreadsheetApp.getUi();
  CONFIG_P    = SS_P.getSheetByName("設定");
  var lastCol = CONFIG_P.getLastColumn();

  if (lastCol < 2) {
    ui.alert("設定シートにショップ情報がありません。");
    return;
  }

  var pId   = String(CONFIG_P.getRange("B1").getValue()).trim();
  var pKey  = String(CONFIG_P.getRange("B2").getValue()).trim();
  var rows  = CONFIG_P.getRange(3, 2, 3, lastCol - 1).getValues();
  var count = 0;

  for (var i = 0; i < rows[0].length; i++) {
    var shopId = String(rows[0][i]).trim();
    var rToken = String(rows[2][i]).trim();
    if (!shopId || !rToken) continue;

    var newTokens = refreshAccessTokenP(pId, pKey, shopId, rToken);
    if (newTokens && newTokens.access_token) {
      CONFIG_P.getRange(4, i + 2).setValue(newTokens.access_token);
      CONFIG_P.getRange(5, i + 2).setValue(newTokens.refresh_token);
      count++;
    }
  }

  ui.alert(count + " ショップのトークンを更新しました。");
}

// =============================================
// 注文通知処理（Webhook）
// =============================================

function doPost(e) {
  try {
    CONFIG_P = SS_P.getSheetByName("設定");
    var debugSheet = SS_P.getSheetByName("デバッグ") || SS_P.insertSheet("デバッグ");
    var now        = new Date();
    var contents   = (e && e.postData && e.postData.contents)
      ? e.postData.contents
      : "データ空っぽ";

    debugSheet.insertRowBefore(1);
    debugSheet.getRange(1, 1).setValue(now);
    debugSheet.getRange(1, 2).setValue("受信データ");
    debugSheet.getRange(1, 3).setValue(contents);

    var data = JSON.parse(contents);
    if (data.code === 3) {
      processOrderNotificationP(data, debugSheet);
    }
  } catch (err) {
    console.error("doPost内でエラー: " + err.toString());
  }

  return ContentService.createTextOutput("success");
}

function processOrderNotificationP(data, debugSheet) {
  var PURCHASE_S = SS_P.getSheetByName("仕入れ管理") || SS_P.insertSheet("仕入れ管理");
  var now        = new Date();

  if (PURCHASE_S.getLastRow() === 0) {
    PURCHASE_S.appendRow(["注文日", "注文ID", "注文IDの下4桁", "商品名", "SKU", "個数"]);
  }

  var status  = data.data.status;
  var orderSn = data.data.ordersn;
  var shopId  = String(data.shop_id);

  if (status !== "READY_TO_SHIP") {
    debugSheet.appendRow([now, "スキップ", "ステータスが READY_TO_SHIP ではないため無視: " + status]);
    return;
  }

  var lastRow = PURCHASE_S.getLastRow();
  if (lastRow > 1) {
    var existingIds = PURCHASE_S.getRange(2, 2, lastRow - 1, 1).getValues();
    for (var r = 0; r < existingIds.length; r++) {
      if (String(existingIds[r][0]) === String(orderSn)) {
        debugSheet.appendRow([now, "重複スキップ", "すでに存在する注文ID: " + orderSn]);
        return;
      }
    }
  }

  var lastCol    = CONFIG_P.getLastColumn();
  var configVals = CONFIG_P.getRange(1, 2, 5, lastCol - 1).getValues();
  var shopConfig = null;
  var colIndex   = -1;

  for (var i = 0; i < configVals[0].length; i++) {
    if (String(configVals[2][i]) === shopId) {
      shopConfig = {
        pId:    configVals[0][i],
        pKey:   configVals[1][i],
        aToken: configVals[3][i],
        rToken: configVals[4][i]
      };
      colIndex = i + 2;
      break;
    }
  }

  if (!shopConfig) {
    debugSheet.appendRow([now, "エラー", "設定シートにショップID " + shopId + " が見つかりません"]);
    return;
  }

  var newTokens = refreshAccessTokenP(shopConfig.pId, shopConfig.pKey, shopId, shopConfig.rToken);
  if (newTokens && newTokens.access_token) {
    CONFIG_P.getRange(4, colIndex).setValue(newTokens.access_token);
    CONFIG_P.getRange(5, colIndex).setValue(newTokens.refresh_token);
    shopConfig.aToken = newTokens.access_token;
  }

  var orderDetail = getOrderDetailP(
    shopConfig.pId, shopConfig.pKey, shopConfig.aToken, shopId, orderSn
  );

  if (orderDetail && orderDetail.item_list) {
    var last4 = String(orderSn).slice(-4);
    for (var j = 0; j < orderDetail.item_list.length; j++) {
      var item = orderDetail.item_list[j];
      PURCHASE_S.appendRow([
        now,
        orderSn,
        last4,
        item.item_name,
        item.model_sku || item.item_sku || "-",
        item.model_quantity_purchased
      ]);
    }
    debugSheet.appendRow([now, "書込成功", "注文を記録しました: " + orderSn]);
  } else {
    debugSheet.appendRow([now, "エラー", "注文詳細の取得に失敗しました: " + orderSn]);
  }
}

// =============================================
// Shopee API 補助関数
// =============================================

function getOrderDetailP(pId, pKey, aToken, sId, orderSn) {
  var path      = "/api/v2/order/get_order_detail";
  var timestamp = Math.floor(Date.now() / 1000);
  var signBase  = String(pId) + path + String(timestamp) + String(aToken) + String(sId);
  var sign      = computeHmacSign(signBase, pKey);
  var url       = "https://partner.shopeemobile.com" + path
    + "?partner_id=" + pId
    + "&timestamp=" + timestamp
    + "&sign=" + sign
    + "&shop_id=" + sId
    + "&access_token=" + aToken
    + "&order_sn_list=" + orderSn
    + "&response_optional_fields=item_list";

  var res = JSON.parse(
    UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText()
  );

  if (res.response && res.response.order_list && res.response.order_list.length > 0) {
    return res.response.order_list[0];
  }
  return null;
}

function refreshAccessTokenP(pId, pKey, sId, rToken) {
  var path      = "/api/v2/auth/access_token/get";
  var timestamp = Math.floor(Date.now() / 1000);
  var sign      = computeHmacSign(String(pId) + path + String(timestamp), pKey);
  var url       = "https://partner.shopeemobile.com" + path
    + "?partner_id=" + pId
    + "&timestamp=" + timestamp
    + "&sign=" + sign;

  var payload = {
    refresh_token: String(rToken),
    partner_id:    Number(pId),
    shop_id:       Number(sId)
  };

  var res = JSON.parse(
    UrlFetchApp.fetch(url, {
      method:             "post",
      contentType:        "application/json",
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    }).getContentText()
  );

  return res.access_token ? res : null;
}

/**
 * HMAC-SHA256 署名を計算して16進文字列で返す
 */
function computeHmacSign(base, pKey) {
  var bytes = Utilities.computeHmacSha256Signature(base, pKey);
  var result = "";
  for (var i = 0; i < bytes.length; i++) {
    var hex = (bytes[i] & 0xFF).toString(16);
    result += (hex.length === 1 ? "0" : "") + hex;
  }
  return result;
}

function generateSignP(pId, path, timestamp, pKey, customBase) {
  var base = customBase ? customBase : (String(pId) + path + String(timestamp));
  return computeHmacSign(base, pKey);
}
