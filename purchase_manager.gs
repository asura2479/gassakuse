/**
 * 仕入れ管理スクリプト
 *
 * 【設定シート構造】
 *   行1: パートナーID  → B1 に値を入力
 *   行2: パートナーキー → B2 に値を入力
 *   行3: ショップID    → B3, C3, D3 … (複数ショップ対応)
 *   行4: アクセストークン
 *   行5: リフレッシュトークン
 *
 * 【初回セットアップ手順】
 *   1. 設定シートの B1 にパートナーID、B2 にパートナーキーを入力
 *   2. スクリプトを「ウェブアプリ」としてデプロイ（アクセス: 全員）
 *   3. メニュー「Shopee認証」→「認証URLを表示」でURLを開き、ショップを認証
 *   4. トークンが設定シートに自動保存されたら完了
 */

const SS_P = SpreadsheetApp.getActiveSpreadsheet();
const CONFIG_P = SS_P.getSheetByName("設定");

// =============================================
// メニュー
// =============================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Shopee認証")
    .addItem("認証URLを表示", "showAuthUrl")
    .addItem("トークン手動更新（全ショップ）", "refreshAllTokens")
    .addToUi();
}

// =============================================
// Shopee 認証フロー
// =============================================

/**
 * 認証URLを生成してダイアログに表示する
 * ※スクリプトエディタ or メニューから手動実行
 */
function showAuthUrl() {
  const ui = SpreadsheetApp.getUi();

  if (!CONFIG_P) {
    ui.alert("設定シートが見つかりません。「設定」という名前のシートを作成してください。");
    return;
  }

  const pId  = String(CONFIG_P.getRange("B1").getValue()).trim();
  const pKey = String(CONFIG_P.getRange("B2").getValue()).trim();

  if (!pId || !pKey) {
    ui.alert("設定シートの B1（パートナーID）と B2（パートナーキー）を入力してください。");
    return;
  }

  // ウェブアプリのURLをリダイレクト先に指定
  const redirectUrl = ScriptApp.getService().getUrl();
  const path        = "/api/v2/shop/auth_partner";
  const timestamp   = Math.floor(Date.now() / 1000);
  const sign        = computeHmacSign(pId + path + timestamp, pKey);
  const authUrl     = "https://partner.shopeemobile.com" + path
    + "?partner_id=" + pId + "&timestamp=" + timestamp + "&sign=" + sign
    + "&redirect=" + encodeURIComponent(redirectUrl);

  const html = HtmlService.createHtmlOutput(
    "<style>body{font-family:sans-serif;padding:16px}</style>"
    + "<p>以下のURLをブラウザで開いて、ショップの認証を完了してください。</p>"
    + "<p><a href='" + authUrl + "' target='_blank' style='word-break:break-all'>" + authUrl + "</a></p>"
    + "<p>認証後、このスプレッドシートにトークンが自動保存されます。</p>"
  ).setWidth(620).setHeight(180);

  ui.showModalDialog(html, "Shopee 認証URL");
}

/**
 * OAuth コールバック — ウェブアプリへのGETリクエストで呼ばれる
 * Shopeeが ?code=xxx&shop_id=yyy を付けてリダイレクトしてくる
 */
function doGet(e) {
  try {
    const code   = e.parameter.code;
    const shopId = e.parameter.shop_id;

    if (!code || !shopId) {
      return ContentService.createTextOutput(
        "パラメータが不足しています（code / shop_id）。"
      );
    }

    const pId  = String(CONFIG_P.getRange("B1").getValue()).trim();
    const pKey = String(CONFIG_P.getRange("B2").getValue()).trim();

    const tokens = fetchTokenByCode(pId, pKey, shopId, code);

    if (tokens && tokens.access_token) {
      saveTokensToConfig(shopId, tokens.access_token, tokens.refresh_token);
      return ContentService.createTextOutput(
        "✅ 認証成功！スプレッドシートにトークンを保存しました。このタブを閉じてください。"
      );
    } else {
      return ContentService.createTextOutput(
        "❌ トークン取得失敗: " + JSON.stringify(tokens)
      );
    }
  } catch (err) {
    return ContentService.createTextOutput("エラー: " + err.toString());
  }
}

/**
 * 認証コード → アクセストークン
 */
function fetchTokenByCode(pId, pKey, shopId, code) {
  const path      = "/api/v2/auth/token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign      = computeHmacSign(pId + path + timestamp, pKey);
  const url       = "https://partner.shopeemobile.com" + path
    + "?partner_id=" + pId + "&timestamp=" + timestamp + "&sign=" + sign;

  const payload = {
    code:       String(code),
    partner_id: Number(pId),
    shop_id:    Number(shopId)
  };

  const res = JSON.parse(
    UrlFetchApp.fetch(url, {
      method:          "post",
      contentType:     "application/json",
      payload:         JSON.stringify(payload),
      muteHttpExceptions: true
    }).getContentText()
  );

  return res.access_token ? res : null;
}

/**
 * 設定シートにアクセストークン・リフレッシュトークンを保存
 * ショップIDが既存列にあれば上書き、なければ新規列に追加
 */
function saveTokensToConfig(shopId, accessToken, refreshToken) {
  const lastCol = CONFIG_P.getLastColumn();
  let   targetCol = -1;

  if (lastCol >= 2) {
    const shopIds = CONFIG_P.getRange(3, 2, 1, lastCol - 1).getValues()[0];
    for (let i = 0; i < shopIds.length; i++) {
      if (String(shopIds[i]) === String(shopId)) {
        targetCol = i + 2;
        break;
      }
    }
  }

  if (targetCol === -1) {
    targetCol = Math.max(lastCol, 1) + 1;
    CONFIG_P.getRange(3, targetCol).setValue(shopId);
  }

  CONFIG_P.getRange(4, targetCol).setValue(accessToken);
  CONFIG_P.getRange(5, targetCol).setValue(refreshToken);
}

/**
 * 設定シートの全ショップのトークンを手動更新
 */
function refreshAllTokens() {
  const ui      = SpreadsheetApp.getUi();
  const lastCol = CONFIG_P.getLastColumn();

  if (lastCol < 2) {
    ui.alert("設定シートにショップ情報がありません。");
    return;
  }

  const pId    = String(CONFIG_P.getRange("B1").getValue()).trim();
  const pKey   = String(CONFIG_P.getRange("B2").getValue()).trim();
  const rows   = CONFIG_P.getRange(3, 2, 3, lastCol - 1).getValues(); // 行3〜5
  let   count  = 0;

  for (let i = 0; i < rows[0].length; i++) {
    const shopId = String(rows[0][i]).trim();
    const rToken = String(rows[2][i]).trim();
    if (!shopId || !rToken) continue;

    const newTokens = refreshAccessTokenP(pId, pKey, shopId, rToken);
    if (newTokens) {
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
    const debugSheet = SS_P.getSheetByName("デバッグ") || SS_P.insertSheet("デバッグ");
    const now        = new Date();
    const contents   = (e && e.postData && e.postData.contents)
      ? e.postData.contents
      : "データ空っぽ";

    // 受信ログを先頭行に挿入
    debugSheet.insertRowBefore(1);
    debugSheet.getRange(1, 1).setValue(now);
    debugSheet.getRange(1, 2).setValue("受信データ");
    debugSheet.getRange(1, 3).setValue(contents);

    const data = JSON.parse(contents);
    if (data.code === 3) {
      processOrderNotificationP(data, debugSheet);
    }
  } catch (err) {
    console.error("doPost内でエラー: " + err.toString());
  }

  return ContentService.createTextOutput("success");
}

function processOrderNotificationP(data, debugSheet) {
  const PURCHASE_S = SS_P.getSheetByName("仕入れ管理") || SS_P.insertSheet("仕入れ管理");
  const now        = new Date();

  // 見出し行（シートが空のときだけ作成）
  if (PURCHASE_S.getLastRow() === 0) {
    PURCHASE_S.appendRow(["注文日", "注文ID", "注文IDの下4桁", "商品名", "SKU", "個数"]);
  }

  const status  = data.data.status;
  const orderSn = data.data.ordersn;
  const shopId  = String(data.shop_id);

  // READY_TO_SHIP 以外は無視
  if (status !== "READY_TO_SHIP") {
    debugSheet.appendRow([now, "スキップ", "ステータスが READY_TO_SHIP ではないため無視: " + status]);
    return;
  }

  // 重複チェック
  const lastRow = PURCHASE_S.getLastRow();
  if (lastRow > 1) {
    const existingIds = PURCHASE_S.getRange(2, 2, lastRow - 1, 1).getValues().flat().map(String);
    if (existingIds.includes(String(orderSn))) {
      debugSheet.appendRow([now, "重複スキップ", "すでに存在する注文ID: " + orderSn]);
      return;
    }
  }

  // 設定シートからショップ設定を取得
  const lastCol    = CONFIG_P.getLastColumn();
  const configVals = CONFIG_P.getRange(1, 2, 5, lastCol - 1).getValues();
  let shopConfig   = null;
  let colIndex     = -1;

  for (let i = 0; i < configVals[0].length; i++) {
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

  // トークン自動更新
  const newTokens = refreshAccessTokenP(shopConfig.pId, shopConfig.pKey, shopId, shopConfig.rToken);
  if (newTokens) {
    CONFIG_P.getRange(4, colIndex).setValue(newTokens.access_token);
    CONFIG_P.getRange(5, colIndex).setValue(newTokens.refresh_token);
    shopConfig.aToken = newTokens.access_token;
  }

  // 注文詳細を取得して書き込む
  const orderDetail = getOrderDetailP(
    shopConfig.pId, shopConfig.pKey, shopConfig.aToken, shopId, orderSn
  );

  if (orderDetail && orderDetail.item_list) {
    const last4 = String(orderSn).slice(-4);
    orderDetail.item_list.forEach(item => {
      PURCHASE_S.appendRow([
        now,
        orderSn,
        last4,
        item.item_name,
        item.model_sku || item.item_sku || "-",
        item.model_quantity_purchased
      ]);
    });
    debugSheet.appendRow([now, "書込成功", "注文を記録しました: " + orderSn]);
  } else {
    debugSheet.appendRow([now, "エラー", "注文詳細の取得に失敗しました: " + orderSn]);
  }
}

// =============================================
// Shopee API 補助関数
// =============================================

function getOrderDetailP(pId, pKey, aToken, sId, orderSn) {
  const path      = "/api/v2/order/get_order_detail";
  const timestamp = Math.floor(Date.now() / 1000);
  const signBase  = pId + path + timestamp + aToken + sId;
  const sign      = computeHmacSign(signBase, pKey);
  const url       = "https://partner.shopeemobile.com" + path
    + "?partner_id=" + pId + "&timestamp=" + timestamp + "&sign=" + sign
    + "&shop_id=" + sId + "&access_token=" + aToken
    + "&order_sn_list=" + orderSn + "&response_optional_fields=item_list";

  const res = JSON.parse(
    UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText()
  );
  return res.response?.order_list?.[0];
}

function refreshAccessTokenP(pId, pKey, sId, rToken) {
  const path      = "/api/v2/auth/access_token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign      = computeHmacSign(pId + path + timestamp, pKey);
  const url       = "https://partner.shopeemobile.com" + path
    + "?partner_id=" + pId + "&timestamp=" + timestamp + "&sign=" + sign;

  const payload = {
    refresh_token: String(rToken),
    partner_id:    Number(pId),
    shop_id:       Number(sId)
  };

  const res = JSON.parse(
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
  return Utilities.computeHmacSha256Signature(base, pKey)
    .map(b => ("0" + (b & 0xFF).toString(16)).slice(-2))
    .join("");
}

// 後方互換エイリアス（processOrderNotificationP 内から呼ばれる旧名）
function generateSignP(pId, path, timestamp, pKey, customBase) {
  const base = customBase ? customBase : (pId + path + timestamp);
  return computeHmacSign(base, pKey);
}
