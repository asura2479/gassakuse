/**
 * 仕入れ管理専用スクリプト（名前重複エラー回避版）
 */

// 変数名を SS_P や CONFIG_P など、他と被らない名前に変更しました
const SS_P = SpreadsheetApp.getActiveSpreadsheet();
const CONFIG_P = SS_P.getSheetByName("設定");

function doPost(e) {
  try {
    var debugSheet = SS_P.getSheetByName("デバッグ") || SS_P.insertSheet("デバッグ");
    var now = new Date();
    var contents = (e && e.postData && e.postData.contents) ? e.postData.contents : "データ空っぽ";

    // 届いたデータをデバッグシートの1行目に挿入
    debugSheet.insertRowBefore(1);
    debugSheet.getRange(1, 1).setValue(now);
    debugSheet.getRange(1, 2).setValue("受信データ");
    debugSheet.getRange(1, 3).setValue(contents);

    // 注文通知(Code 3)の場合の処理
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
  const PURCHASE_S = SS_P.getSheetByName("仕入れ管理") || SS_P.insertSheet("仕入れ管理");
  const now = new Date();

  // 見出し作成
  if (PURCHASE_S.getLastRow() === 0) {
    PURCHASE_S.appendRow(["注文日", "注文ID", "ショップ名(ID)", "商品名", "SKU", "個数", "注文ID下4桁", "チェック1", "チェック2"]);
  }

  const status = data.data.status; // 注文のステータス
  const orderSn = data.data.ordersn;
  const shopId = String(data.shop_id);

  // 【改善1】ステータスが「READY_TO_SHIP」以外の時は無視する
  // これでキャンセルや未払いのデータは書き込まれなくなります
  if (status !== 'READY_TO_SHIP') {
    debugSheet.appendRow([now, "スキップ", "ステータスがREADY_TO_SHIPではないため無視しました: " + status]);
    return;
  }

  // 【改善2】すでにシートに同じ注文IDがあるかチェックする（重複防止）
  const lastRow = PURCHASE_S.getLastRow();
  if (lastRow > 1) {
    const existingIds = PURCHASE_S.getRange(2, 2, lastRow - 1, 1).getValues().flat().map(String);
    if (existingIds.includes(String(orderSn))) {
      debugSheet.appendRow([now, "重複スキップ", "すでにシートに存在する注文IDです: " + orderSn]);
      return;
    }
  }

  // --- 以降、設定シートから情報を取って書き込む処理（変更なし） ---
  const lastCol = CONFIG_P.getLastColumn();
  const configValues = CONFIG_P.getRange(1, 2, 5, lastCol - 1).getValues();
  let shopConfig = null;
  let colIndex = -1;

  for (let i = 0; i < configValues[0].length; i++) {
    if (String(configValues[2][i]) === shopId) {
      shopConfig = { pId: configValues[0][i], pKey: configValues[1][i], aToken: configValues[3][i], rToken: configValues[4][i] };
      colIndex = i + 2;
      break;
    }
  }

  if (!shopConfig) return;

  const newTokens = refreshAccessTokenP(shopConfig.pId, shopConfig.pKey, shopId, shopConfig.rToken);
  if (newTokens) {
    CONFIG_P.getRange(4, colIndex).setValue(newTokens.access_token);
    CONFIG_P.getRange(5, colIndex).setValue(newTokens.refresh_token);
    shopConfig.aToken = newTokens.access_token;
  }

  const orderDetail = getOrderDetailP(shopConfig.pId, shopConfig.pKey, shopConfig.aToken, shopId, orderSn);
  if (orderDetail && orderDetail.item_list) {
    // 注文IDの下4桁を取得
    const orderSnStr = String(orderSn);
    const last4 = orderSnStr.slice(-4);

    orderDetail.item_list.forEach(item => {
      // A~Gまでデータを書き込む
      PURCHASE_S.appendRow([
        now, orderSn, `Shop_${shopId}`, item.item_name,
        item.model_sku || item.item_sku || "-", item.model_quantity_purchased,
        last4
      ]);

      // 追加した行のH列・I列にチェックボックスを挿入
      const newRow = PURCHASE_S.getLastRow();
      PURCHASE_S.getRange(newRow, 8).insertCheckboxes();  // H列
      PURCHASE_S.getRange(newRow, 9).insertCheckboxes();  // I列
    });
    debugSheet.appendRow([now, "書込成功", "注文を記録しました: " + orderSn]);
  }
}

// 補助関数も名前が被らないように末尾に P を付けました
function getOrderDetailP(pId, pKey, aToken, sId, orderSn) {
  const path = "/api/v2/order/get_order_detail";
  const timestamp = Math.floor(Date.now() / 1000);
  const signBase = pId + path + timestamp + aToken + sId;
  const sign = generateSignP(pId, path, timestamp, pKey, signBase);
  const url = `https://partner.shopeemobile.com${path}?partner_id=${pId}&timestamp=${timestamp}&sign=${sign}&shop_id=${sId}&access_token=${aToken}&order_sn_list=${orderSn}&response_optional_fields=item_list`;
  const res = JSON.parse(UrlFetchApp.fetch(url, { "muteHttpExceptions": true }).getContentText());
  return res.response?.order_list?.[0];
}

function refreshAccessTokenP(pId, pKey, sId, rToken) {
  const path = "/api/v2/auth/access_token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignP(pId, path, timestamp, pKey);
  const url = `https://partner.shopeemobile.com${path}?partner_id=${pId}&timestamp=${timestamp}&sign=${sign}`;
  const payload = { "refresh_token": String(rToken), "partner_id": Number(pId), "shop_id": Number(sId) };
  const res = JSON.parse(UrlFetchApp.fetch(url, { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true }).getContentText());
  return res.access_token ? res : null;
}

function generateSignP(pId, path, timestamp, pKey, customBase = null) {
  const base = customBase ? customBase : (pId + path + timestamp);
  return Utilities.computeHmacSha256Signature(base, pKey).map(b => ("0" + (b & 0xFF).toString(16)).slice(-2)).join("");
}
