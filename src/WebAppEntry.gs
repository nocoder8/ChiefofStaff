/**
 * Web app entrypoints: closure actions (GET) and Telegram webhook (POST).
 * Deploy once; use the same /exec URL for calendar links and Telegram setWebhook.
 */
function doGet(e) {
  return CosClosureWebApp.handleGet(e || {});
}

function doPost(e) {
  return CosTelegramWebhook.handlePost(e || {});
}
