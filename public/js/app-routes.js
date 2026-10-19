// Where a link lands inside the Walmart app, per platform. Ports of the two apps' routers:
//   iOS     glass-app      DeepLinkRouter + legacy DeepLinkRoutes/PatternMatcher (+ AsyncRouter, shown as an alternative)
//   Android walmart-glass  LinkApiImpl rewrite chain + @GlassLinkPattern regexes (generated: app-routes-android.generated.js)
// Browser: window.DLRoutes (load app-routes-android.generated.js first). Node/Bun: require("./app-routes.js").
//
// The iOS table below is hand-curated (patterns are registered in many styles, so they can't be extracted reliably).
// `node tools/extract-app-routes.mjs` re-generates the Android table and checks every iOS literal against the file cited.
(function (root) {
"use strict";

const ANDROID = typeof module !== "undefined" && module.exports ? require("./app-routes-android.generated.js") : root.DLAndroidRoutes;

/* ======================================================================================================================
 * iOS data (glass-app, USA tenant)
 * ==================================================================================================================== */
const R = "Plugins/DeepLinking/DeepLinking/Sources/Routables/";
const B = "Modules/TenantConfigurations/usa/USATenantConfiguration/Sources/Bootstrap/USATenantBootstrap+DeeplinkRoutes.swift";
const U = "Modules/TenantConfigurations/usa/USATenantConfiguration/Sources/PluginConfiguration/DeepLinking/";
const PL = "Plugins/";

// Legacy router: registration order, first match wins (DeepLinkRoutes.swift). [label, src, patterns, opts]
// opts.lit maps a pattern to the literal written in the source when the routable adds a suffix (e.g. "ip" -> "ip/:id").
// opts.webview = opens a web page inside the app; opts.note = shown to the user.
const IOS_LEGACY_GROUPS = [
  ["Add items to order", R + "AddItemsRoutable.swift", ["orders/:orderId/add"]],
  ["Ads redirect / preview", R + "AdsRoutable.swift", ["ads", "ads/redirect", "ads/preview/search", "ads/preview/browse", "ads/preview/home", "ads/preview/item/:productID"]],
  ["App appearance settings", R + "AppRootRoutable.swift", ["appAppearance"]],
  ["AR paint", R + "ARExperiencesRoutable.swift", ["arexperiences/paint"]],
  ["Auto Care Center", R + "AutoCareCenterRoutable.swift", ["acc", "acc/:deepLinkPath", "acc/tracker/:keyTag/:storeId", "acc/servicedetails/:keyTag/:storeId", "acc/garage/selectVehicle", "acc/garage/add", "acc/garage/addVehicle", "acc/garage/editVehicle", "acc/garage/addVehicleByLicensePlate", "acc/garage/edit/:vehicleId/:sourceType/:context/:page", "acc/garage/edit/:vehicleId/:sourceType/:vin/:context/:page", "acc/vehicledetails/:vehicleId/:sourceType/:vin", "acc/servicehistory", "acc/wplus/:codeType/:accCID/:workOrderId", "acc/reminderdetails/:reminderId", "express-checkin-review", "acc/serviceaddons/add", "acc/serviceaddons/confirmation"]],
  ["Auto order", R + "AutoOrderRoutable.swift", ["autoorder/enroll", "autoorder/preferences", "autoorder/splash"]],
  ["In-store Wi-Fi", PL + "PluginAPIs/PluginAPIs/APIs/CaptivePortal/CaptivePortalAPI.swift", ["in-store-wifi/verify-code"]],
  ["Cashi credit", R + "CashiCheckoutRoutable.swift", ["/cashiSilent/credit"]],
  ["Charity of choice", R + "CharityOfChoiceRoutable.swift", ["checkoutThankYou"]],
  ["Checkout (buy now)", R + "CheckoutRoutable.swift", ["checkout/buyNow"]],
  ["Chat / Sparky assistant", R + "ConverseRoutable.swift", ["converse/livechat", "sparkyAssistant", "sparkyEssentials"]],
  ["Digital cake builder", R + "DigitalCakeDashboardRoutable.swift", ["digitalcake", "digitalcakebuilder", "digitalcake/continueshopping"]],
  ["Expo preview (internal)", R + "ExpoPreviewRoutable.swift", ["expo"]],
  ["Express self-service", R + "ExpressSelfServiceRoutable.swift", ["expressselfservice", "expresscheckin"]],
  ["Global intent center", R + "GICRoutable.swift", ["gic"]],
  ["ID.me callback", R + "IdentityVerificationRoutable.swift", ["identity/idme/callback"]],
  ["InHome delivery", R + "InHomeRoutable.swift", ["inhome/chamberlain", "inhome/level", "inhome/link", "inhome/signupConfirmation", "inhome/preferences"]],
  ["Import list", R + "ImportListRoutable.swift", ["importList"]],
  ["Livestream", R + "LiveStreamRoutable.swift", ["livestream", "live", "live/shows", "live/browse"], { webview: true }],
  ["Membership", R + "MembershipRoutable.swift", ["my-account/pass", "my-account/pass/address", "dp/manage"]],
  ["Walmart Pay", R + "MobilePayRoutable.swift", ["walmartpay", "walmartpay/wcc/provision", "walmartpay/pump", "walmartpay/fuel/landingPage", "walmartpay/transaction/:transactionID"]],
  ["Money services", R + "MoneyServicesRoutable.swift", ["moneyservices/money-transfer-send/start"]],
  ["Optical", R + "OpticalsRoutable.swift", ["opticals/addtocart", "optical", "opticalcenter", "optical-center"]],
  ["Tires", R + "TiresRoutable.swift", ["tires", "tirefinder", "tire-search", "tire-finder", "tire_finder"]],
  ["Edit order substitutions", R + "OrderSubstitutionsRoutable.swift", ["orders/:orderId/edit"]],
  ["Item, other conditions", R + "OtherConditionRoutable.swift", ["itemOtherConditions"]],
  ["Dinner tonight", R + "DinnerTonightRoutable.swift", ["dinnertonight", "i/dinnertonight"]],
  ["Recipes", R + "RecipeRoutable.swift", ["i/recipe-library", "i/recipe-results", "i/recipes/:recipeName/:recipeId"]],
  ["Email sign-up", R + "RegisterForEmailRoutable.swift", ["register-for-emails"]],
  ["Push notification opt-in", R + "RegisterForPushRoutable.swift", ["register-for-push-notifications"]],
  ["Scan & Go", R + "ScanAndGoRoutable.swift", ["scanandgo/abandonedCartFeedback", "scanandgo", "scanandgo/feedback"]],
  ["Auto Care oil service", R + "ScheduleOilServiceRoutable.swift", ["accoilservice"]],
  ["All departments", R + "SearchLandingRoutable.swift", ["allDepartmentLanding", "department"]],
  ["Seller Center", R + "SellerRoutable.swift", ["seller/home", "seller/items", "seller/account", "seller/account/returns", "seller/search/items", "seller/search/orders", "seller/returns", "seller/orders", "seller/localorders", "seller/mcs", "seller/inbox", "seller/notifications", "seller/wfs/inventory", "seller/wfs/shipments", "seller/payments", "seller/feedback", "seller/help", "seller/performance", "seller/successHub", "seller/assortments", "seller/rating", "seller/webview", "seller/ado", "seller/actioncenter"]],
  ["Services / store selector", R + "ServicesRoutable.swift", ["tools", "storeSelector"]],
  ["Services store finder", R + "ServicesStoreFinderRoutable.swift", ["servicesStoreFinder/:servicesType/"]],
  ["Shoppable list", R + "ShoppableListRoutable.swift", ["i/shoppable-lists/:itemName/:itemId", "i/shoppable-lists/:itemId"]],
  ["Store maps", R + "StoreMapsRoutable.swift", ["storemaps"]],
  ["Store mode", R + "StoreModeRoutable.swift", ["storemode"]],
  ["Store page", R + "StorePagesRoutable.swift", ["store/:nearByNodeID", "club/:nearByNodeID", "club"]],
  ["Subscriptions", R + "SubscriptionRoutable.swift", ["subscriptions/manage", "subscriptions/manage/baskets", "subscriptions/bulkEnrollment", "subscriptions/replenishment", "subscriptions/terms"]],
  ["Weekly ads", R + "TabLeakRoutable.swift", ["store/weekly-ads", "store/*/weekly-ads"]],
  ["Tax exemption", R + "TaxExemptionRoutable.swift", ["taxexemption", "taxExemption", "taxExempt", "taxexempt"]],
  ["Discover feed", R + "TrendRoutable.swift", ["discover/landing", "discover/feed", "discover/feed/:contentId"]],
  ["Tipping & feedback", R + "TippingFeedbackRoutable.swift", ["orders/:orderId/tip/:shipmentId"]],
  ["Business (enterprise) landing", R + "UPCEnterpriseRoutable.swift", ["enterpise-landing"]],
  ["Contact sales", R + "UPCIntakeRoutable.swift", ["contact-sales"]],
  ["Vision center", R + "VisionCenterRoutable.swift", ["visioncenter/select-prescription-lens", "visioncenter/add-prescription", "visioncenter/signin", "health-and-wellness/vision/orders/order-lookup", "health-and-wellness/vision/orders"]],
  ["Walmart+", R + "WalmartPlusRoutable.swift", ["plus", "plus/benefits", "plus/settings", "plus/resume", "plus/pauseMembership", "plus/undopause", "plus/cancelFeedback", "account/plus/overview", "plus/redeem", "plus/chooseplan", "plus/learnmore", "plus/earlyaccess", "plus/ea-acquisition-module", "plus/plusups", "plus/plans", "plus/confirm", "account/plus/offers", "partner/plus", "plus/manageWeekly", "plus/wrs/benefits", "plus/inhomeAddress", "account/plus/manage", "plus/benefit-engagement", "plus/repeat-benefit-engagement", "plus/signupoffers", "plus/program", "plus/eventoffersplan", "plus/offer-list", "plus/wplus-free-shipping", "plus/free-unlimited-delivery", "plus/inhome", "plus/cancelInHome", "plus/free-shipping", "plus/free-delivery", "plus/OauthAuthzCode", "plus/pet-benefits", "plus/smartstyle", "plus/dunkin", "plus/travel-expedia", "plus/pawp-televet", "plus/verizon3", "plus/activate", "plus/assist", "plus/student", "plus/military", "plus/video-streaming-benefit", "plus/double-benefits", "plus/assist/verify", "plus/student/verify", "plus/military/verify", "plus/storyExperience", "plus/disclaimerModule", "plus/manageplans", "plus/cancelMembership", "plus/yearinreview", "plus/confirmation", "plus/smart-restock", "plus/changebillingdate", "plus/changeplan", "plus/helpchat", "plus/billinghistory", "plus/unifiedplanspage", "shoppablebasket", "plus/video", "plus/cancel-benefit", "plus/benefit", "plus/benefit-confirmation", "plus/event", "plus/promo", "plus/updatePlan", "plus/benefit/*", "plus/event/*", "plus/promo/*", "plus/fullscreen-video", "plus/digitalUnlock", "plus/manage-benefit-sharing", "plus/invite-member", "plus/send-invite", "plus/accept-invite", "account/plus/accept-invite", "plus/streaming-manage", "plus/initiatelinking", "plus/samsclub"], { note: { "plus/offer-list": "opens Safari instead when its native screen is switched off" } }],
  ["WIC benefits", R + "WomenInfantsAndChildrenRoutable.swift", ["generic/MobileBenefitsHubList/WIC", "generic/MobileBenefitsHubList/WIC/AddCard", "generic/MobileBenefitsHubList/WIC/Hub", "generic/MobileBenefitsHubList/WIC/Hub/InvalidPin", "generic/MobileBenefitsHubList/WIC/Hub/Error", "select/delivery-address"]],
  ["HVAC consultation", R + "PHTSRoutable.swift", ["phts/hvac-consultation"]],
  ["Inspire page", R + "InspirePageRoutable.swift", ["i/:pageName/results/:categoryName/:subCategoryName", "i/:pageName/results/:categoryName/:subCategoryName?facet=facet", "i/:pageName", "i/:pageName/:pageDesignation", "i/:pageName/:pageDesignation?facet=facet", "i/:pageName/:pageDesignation/:inspireParamsPageId", "i/:pageName/:pageDesignation/:descriptionOrName/:inspireParamsPageId", "i/:pageName/:pageDesignation/:inspireParamsPageId?facet=facet"]],
  ["Cart shortcut", R + "CartShortcutRoutable.swift", ["cartShortcut"]],
  // ---- USA bootstrap (registerCustomDeeplinkRoutes), in call order ----
  ["Account", B, ["account", "account/settings", "account/communications-and-privacy", "account/fashion", "account/passkeys", "account/petHub", "account/ccpa", "account/privacy", "notifications"]],
  ["Wallet", B, ["paymentmethods", "wallet", "account/giftcards", "wallet/addDsBenefitCard"]],
  ["Addresses", B, ["addresses", "account/delivery-addresses", "addresses/add"]],
  ["Sign in / sign up", B, ["account/signup", "signin", "account/login", "account/setcompromised", "account/profile", "account/iap", "account/pin"]],
  ["Book a delivery slot", B, ["bookslot"]],
  ["Family sharing invite", R + "FamilySharingRoutable.swift", ["account/family-sharing/accept-invite"]],
  ["Brand page", B, ["brand/*"]],
  ["List to cart", R + "ListToCartRoutable.swift", ["listtocart"]],
  ["Visual search", R + "VisualSearchRoutable.swift", ["visualsearch"]],
  ["Notepad", B, ["np"]],
  ["Cart", U + "Routables/CartRoutableConfiguration.swift", ["cart", "mystore/cart/*", "addToCart/*", "buynow/*"], { note: { "addToCart/*": "adds the item to the cart", "buynow/*": "buy now (only when the buy-now setting is on)" } }],
  ["Check-in", B, ["checkin", "storePickup", "mystore/checkin", "grocery/checkin", "returncheckin", "acccheckin", "checkin/:storeId", "storePickup/:storeId", "mystore/checkin/:storeId", "grocery/checkin/:storeId"], { lit: { "checkin/:storeId": "checkin", "storePickup/:storeId": "storePickup", "mystore/checkin/:storeId": "mystore/checkin", "grocery/checkin/:storeId": "grocery/checkin" } }],
  ["Content page", B, ["cp/:pageId", "cp/:pageName/:pageId"]],
  ["Delivery store selector", B, ["deliveryStoreSelector"]],
  ["Walmart Cash rewards", B, ["rewards-history", "cash-dashboard", "cash-overview"]],
  ["Returns", B, ["orders/:id/returns"]],
  ["Returns (web page inside the app)", R + "EasyReturnsRoutable.swift", ["returns/1231920"], { webview: true }],
  ["EV charging", B, ["ev"]],
  ["Scanner", U + "Routables/ScannerRoutableConfiguration.swift", ["scanner"]],
  ["Help center", B, ["help", "help/article/:articleTitle/:articleId", "help/thankyou", "help/chat"], { lit: { "help/article/:articleTitle/:articleId": "help/article/:" } }],
  ["Item page", B, ["ip/:id", "item/:id", "grocery/ip/:id", "war/:id", "reviews/write-review", "mystore/ip/:id", "ip/*/:id", "grocery/ip/*/:id", "multiReview", "reviews/multi-item-review", "reviews/dashboard", "reviews/all-reviews", "reviews/write-seller-review"],
    { lit: { "ip/:id": "ip", "item/:id": "item", "grocery/ip/:id": "grocery/ip", "war/:id": "war", "mystore/ip/:id": "mystore/ip", "ip/*/:id": "ip/*", "grocery/ip/*/:id": "grocery/ip/*" },
      sub: { "war/:id": "Write a review", "reviews/write-review": "Write a review", "multiReview": "Review several items", "reviews/multi-item-review": "Review several items", "reviews/dashboard": "My reviews", "reviews/all-reviews": "All my reviews", "reviews/write-seller-review": "Review a seller" } }],
  ["Order tracking", B, ["orders/:orderId/track/:trackingNumber", "orders/:orderId/track-live"]],
  ["My Items / lists / registries", B, ["myitems", "my-items/page/:pageType/:pageId", "lists", "lists/back-to-school", "lists/back-to-school/classes/:groupId", "lists/:permissionType/:listType/:listId", "lists/:listType/:listId", "my-registries", "registry", "registry/create", "registry/:registryType/:registryId", "lists/favorites", "lists/deals", "my-items", "registry/checklist", "registry/explore", "registry/product/*", "wishlist", "wishlist/create", "wishlist/*"],
    { lit: { "my-items/page/:pageType/:pageId": "my-items/page/:", "lists/back-to-school/classes/:groupId": "lists/back-to-school/classes/:", "lists/:permissionType/:listType/:listId": "lists/:", "lists/:listType/:listId": "lists/:", "registry/:registryType/:registryId": "registry/:", "registry/product/*": "registry/product", "wishlist/*": "wishlist" } }],
  ["Order details", B, ["orders/:id", "grocery/orders/:id", "receipts/:id", "orders/:id/shopper-substitutions", "guestcheckin/:id", "approveorders/:id"]],
  ["Purchase history", U + "Routables/PurchaseHistoryRoutableConfiguration.swift", ["orders", "grocery/orders"]],
  ["Protection plans", R + "PurchaseHistoryRoutable.swift", ["protection-plans"]],
  ["Savings", B, ["savings"]],
  ["Search results", B, ["search/*", "grocery/search/*"]],
  ["Browse (category) page", B, ["browse/*"]],
  ["Shop / deals page", B, ["shop/*"]],
  ["Discovery page", B, ["generic/:subPageType/:pageId"]],
  ["Topic page", B, ["tp/:topicId", "c/*/:topicId"]],
  ["Discovery page", B, ["global/seller/:pageId/cp/:cat", "global/:subPageType/:pageId", "global/:subPageType/:pageId/:cat"]],
  ["Local finds", B, ["localfinds/:subPageType", "localfinds/:subPageType/:cat", "localfinds/:subPageType/:cat/:subCat"]],
  ["Discovery page", B, ["promo/:pageId"]],
  ["Resume your journey", B, ["resumeYourJourney/*"]],
  ["Shelf-label QR (Digital Bridge)", B, ["q/WIN/:id", "stage/q/WIN/:id", "digitalbridge"]],
  ["Pet Rx", B, ["petrxmngt"]],
  ["Omni services scheduler", B, ["omniservicesplatform"]],
];

// AsyncRouter (only when CCM platform.deeplinking.asyncRouter.enabled is on in release builds; default off; always on
// in debug builds). Exact segment counts, {string:x}/{int:x} placeholders, best score wins. [label, src, patterns]
const IOS_ASYNC_GROUPS = [
  ["Item page", PL + "ItemDetails/ItemDetails/Sources/DeepLinking/ItemDetailsRoute.swift", ["item/{string:itemId}", "grocery/ip/{string:itemId}", "grocery/ip/*/{string:itemId}", "ip/{string:itemId}", "ip/*/{string:itemId}", "mystore/ip/{string:itemId}"]],
  ["Brand page", PL + "BrandPages/BrandPages/Sources/DeepLinking/BrandPagesRoute.swift", ["/brand/{string:brandId}"]],
  ["Home", PL + "Home/Home/Sources/Routing/HomeCoordinatorRoute.swift", ["", "home", "grocery"]],
  ["My Items / lists / registries", PL + "MyItems/MyItems/Sources/DeepLinking/MyItemsRoute.swift", ["myitems", "my-items/page/{string:pageType}/{string:pageId}", "lists", "lists/back-to-school", "lists/back-to-school/classes/{string:groupId}", "lists/{string:permissionType}/{string:listType}/{string:listId}", "lists/{string:listType}/{string:listId}", "lists/deals", "my-registries", "registry/{string:registryType}/{string:registryId}", "registry/create", "registry/create/{string:registryType}", "lists/favorites", "registry/checklist", "registry/explore", "registry/product/*", "wishlist", "wishlist/create/{string:wishlistSubtype}", "organizationenricher"]],
  ["Walmart Cash", PL + "WalmartCash/WalmartCash/Sources/DeepLinking/WalmartCashRoute.swift", ["walmartcash", "walmartcash/cash-out-in-store", "offer/item-detail", "offer/all-offers", "offer/claimed-offers"]],
  ["Walmart Cash rewards", PL + "DigitalRewards/DigitalRewards/Sources/DeepLinking/DigitalRewardsRoute.swift", ["rewards-history", "cash-dashboard", "cash-overview"]],
  ["Fuel", PL + "Fuel/Fuel/Sources/DeepLinking/FuelRoute.swift", ["fuel/fueling", "fuel/complete", "fuel/qr/detect/*", "fuel/QR/detect/*", "fuel/interstitial", "fuel/payInStore", "plus/link-partner-account"]],
  ["Benefit finder", PL + "BenefitFinder/BenefitFinder/Sources/Utils/BenefitFinderRoute.swift", ["plus/benefitFinder", "plus/benefit-finder"]],
  ["Pharmacy", PL + "Pharmacy/Pharmacy/Sources/Deeplinking/PharmacyRouteProvider.swift", ["pharmacy/scantorefill", "pharmacy/transfer", "pharmacy/refillhistory", "pharmacy/loggedinrefill", "pharmacy/refillsdue", "pharmacy/createaccount", "pharmacy/secondaryauth", "pharmacy/fillDetail", "pharmacy/insurance/management", "pharmacy/transferdetails", "pharmacy/rxnudge", "pharmacy/import-rx", "pharmacy/family/hub", "pharmacy/bottomsheet", "pharmacy/consent/ecomm", "pharmacy/account", "pharmacy/account/communications", "pharmacy/account/manage-permissions", "pharmacy/account/personal-info", "pharmacy/account/create/isac", "pharmacy/account/digital-wallet", "pharmacy-internal", "pharmacy/rx/history", "pharmacy/user/refill", "pharmacy/rx/details", "pharmacy/forms/ecomm-consent", "pharmacy/account/create", "pharmacy/transfer/details", "health-and-wellness/pharmacy/transfer", "health-and-wellness/pharmacy/account", "health-and-wellness/pharmacy/account/personal-info", "health-and-wellness/pharmacy/account/manage-permissions", "health-and-wellness/pharmacy/account/communications", "health-and-wellness/pharmacy/account/create/isac", "health-and-wellness/pharmacy/account/digital-wallet", "health-and-wellness/pharmacy/insurance/management", "health-and-wellness/pharmacy/family/hub", "health-and-wellness/pharmacy/user/refill", "health-and-wellness/pharmacy/rx/history", "health-and-wellness/pharmacy/account/create", "health-and-wellness/pharmacy/transfer/details", "health-and-wellness/pharmacy/rx/details", "health-and-wellness/pharmacy/forms/ecomm-consent", "health-and-wellness/pharmacy/import-rx"]],
  ["Health & wellness", PL + "HealthAndWellnessDashboard/HealthAndWellnessDashboard/Sources/Deeplinking/HealthAndWellnessDashboardRouteProvider.swift", ["healthandwellness/dashboard", "healthandwellness/identity-test", "healthandwellness/insurance", "healthandwellness/vision", "healthandwellness/teleHealth", "healthandwellness/bettercareservices"]],
  ["Content page", B, ["cp/{string:pageId}", "cp/{string:pageName}/{string:pageId}"]],
  ["Search results", B, ["search", "grocery/search/{string:searchTerm}"]],
  ["Browse (category) page", B, ["browse", "browse/{string:browseTerm}", "browse/{string:browseTerm}/*", "browse/{string:browseTerm}/{string:cat}/*"]],
  ["Shop / deals page", B, ["deals/{string:dealsId}", "shop/deals/*", "shop/gift", "shop/gift/*", "shop/gifts", "shop/gifts/*", "shop", "shop/{string:dealsId}"]],
  ["Topic page", B, ["tp/{string:topicId}", "c/*/{string:topicId}"]],
  ["Discovery page", B, ["generic/{string:subPageType}/{string:pageId}", "global/{string:subPageType}/{string:pageId}", "global/{string:subPageType}/{string:pageId}/{string:cat}"]],
  ["Local finds", B, ["localfinds/{string:subPageType}", "localfinds/{string:subPageType}/{string:cat}", "localfinds/{string:subPageType}/{string:cat}/{string:subCat}"]],
  ["Resume your journey", B, ["resumeYourJourney/*", "resumeYourJourney"]],
  ["Order tracking", B, ["orders/{string:orderId}/track/{string:trackingNumber}", "orders/{string:orderId}/track-live"]],
  ["Tipping & feedback", B, ["orders/{string:orderId}/tip/{string:shipmentId}"]],
  ["Store savings", PL + "StoreSavings/StoreSavings/Sources/DeepLinking/StoreSavingsRoute.swift", ["storesavings"]],
];

// Exact-URL redirects applied before matching (registerDeepLinkRedirects, B). [from, to, queryMustContain]
const IOS_REDIRECTS = [
  ...["walmart://cp/8910931", "walmart://cp/walmart-insurance-services/8910931", "https://www.walmart.com/cp/8910931", "https://www.walmart.com/cp/walmart-insurance-services/8910931"].map((f) => [f, "walmart://healthandwellness/insurance"]),
  ["walmart://cp/5431", "walmart://healthandwellness/dashboard"], ["walmart1h://cp/5431", "walmart://healthandwellness/dashboard"],
  ["walmart://cp/3955077", "walmart://healthandwellness/teleHealth"], ["walmart://cp/virtual-care/3955077", "walmart://healthandwellness/teleHealth"],
  ...["walmart://cp/1078944", "walmart://cp/vision-centers/1078944", "walmart1h://cp/vision-centers/1078944", "walmart1h://cp/1078944"].map((f) => [f, "walmart://healthandwellness/vision"]),
  ["walmart://cp/walmart-credit-card/632402", "walmart://cp/632402"], ["walmart://walmartcreditcard/landing", "walmart://cp/632402"],
  ["walmart://plus/inhomeAddress", "walmart://inhome/chamberlain", "partnership=chamberlain-inhome"],
  ["walmart://cp/scan-go/9679980", "walmart://scanandgo"], ["walmart://cp/find-an-item-store-maps/6422847", "walmart://storemaps"],
  ["walmart://cp/9145505", "walmart://ev"], ["walmart://cp/store-mode/8459006", "walmart://storemode"],
  ["walmart://cp/fuel-pay-instore/5291998", "walmart://fuel/payInStore"], ["walmart://cp/auto-services/1087266", "walmart://acc"],
  ["walmart://cp/returns/1231920", "walmart://returns/1231920"],
  ["walmart://cp/paint/1067617", "walmart://arexperiences/paint", "arexperiences=paint"],
  ["walmart://localfinds", "walmart://localfinds/home"], ["walmart://global/localfinds", "walmart://localfinds/home"],
];

function flatten(groups) {
  const out = [];
  for (const [label, src, pats, opts = {}] of groups) for (const p of pats) {
    out.push({ p, label: (opts.sub && opts.sub[p]) || label, src, literal: opts.lit && opts.lit[p],
      webview: opts.webview === true || !!(opts.webview && opts.webview[p]), note: opts.note && opts.note[p] });
  }
  return out;
}
const IOS_LEGACY = flatten(IOS_LEGACY_GROUPS);
const IOS_ASYNC = flatten(IOS_ASYNC_GROUPS);

/* ======================================================================================================================
 * Helpers
 * ==================================================================================================================== */
function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
// Loose RFC 3986 split (works for walmart:// and https; never throws). host = authority without userinfo/port.
function parseAny(u) {
  const m = /^([A-Za-z][A-Za-z0-9+.\-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(String(u || "").trim());
  if (!m) return null;
  const auth = m[2];
  const host = auth == null ? null : auth.replace(/^.*@/, "").replace(/:\d*$/, "");
  return { scheme: m[1].toLowerCase(), host, path: m[3] || "", query: m[4] == null ? null : m[4], fragment: m[5] == null ? null : m[5] };
}
function query(u) {
  const p = parseAny(u), out = new Map();
  if (!p || p.query == null) return out;
  for (const pair of p.query.split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const k = safeDecode(i < 0 ? pair : pair.slice(0, i)), v = i < 0 ? "" : safeDecode(pair.slice(i + 1).replace(/\+/g, " "));
    if (!out.has(k)) out.set(k, v);
  }
  return out;
}
function fullyDecode(s) { let prev = s, cur = safeDecode(s), n = 0; while (cur !== prev && n++ < 5) { prev = cur; cur = safeDecode(cur); } return cur; }
const truthy = (v) => /^(1|yes|true|on)$/i.test(String(v || ""));
const isWebLink = (u) => /^https:/i.test(String(u || ""));
const WALMART_WEB = new Set(["walmart.com", "www.walmart.com", "www-e16.walmart.com", "www-teflon.walmart.com"]);

// What to show next to a page name: the ID / search term the link carries.
function describe(label, segs, q) {
  const last = segs[segs.length - 1];
  if (label === "Item page" && last) return "item ID " + last;
  if (label === "Brand page" && last && segs.length > 1) return "brand ID " + last;
  if (label === "Content page" && last && segs.length > 1) return "page ID " + last;
  if (label === "Topic page" && last && segs.length > 1) return "topic ID " + last;
  if (label === "Store page" && last && segs.length > 1) return "store " + last;
  if (label === "Search results") { const t = q.get("q") || q.get("query") || (segs[1] === "search" ? segs[2] : segs[1]); return t ? "search for “" + t + "”" : ""; }
  if (label === "Browse (category) page" && segs.length > 1) return segs.slice(1).join(" / ");
  if (/^Order/.test(label) && segs[1]) return "order " + segs[1];
  return "";
}

/* ======================================================================================================================
 * iOS resolver
 * ==================================================================================================================== */
// Legacy PatternMatcher (WalmartFoundation/Sources/PatternMatching/PatternMatcher.swift + DeepLinkRoutes.swift).
function iosLegacyPathString(u) {
  const p = parseAny(u);
  if (!p) return null;
  let s = p.host && !p.host.includes(".") ? "/" + p.host : "";
  return s + safeDecode(p.path);
}
function iosLegacyMatch(pattern, pathStr) {
  const pat = pattern.startsWith("/") ? pattern : "/" + pattern;
  if (pat === pathStr) return {};
  const ps = pat.split("/").filter(Boolean), us = pathStr.split("/").filter(Boolean);
  while (ps.length < us.length) ps.push(ps[ps.length - 1] === "*" ? "*" : null);
  while (us.length < ps.length) us.push(us[us.length - 1] === "*" ? "*" : null);
  const vars = {};
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = us[i];
    if (a === b || a === "*") continue;
    if (a != null && a.startsWith(":") && b != null) { vars[a.slice(1)] = b; continue; }
    return null;
  }
  return vars;
}
// AsyncRouter trie match (AsyncRouter.swift): exact length, best score per segment from the left, earliest on a tie.
function iosAsyncMatch(u) {
  const p = parseAny(u);
  if (!p || p.host == null) return null;
  const comps = [p.host, ...p.path.split("/").filter(Boolean).map(safeDecode)];
  let best = null, bestScore = null;
  for (const r of IOS_ASYNC) {
    const segs = r.p.replace(/^\//, "").split("/");
    if (segs.length !== comps.length) continue;
    const score = [];
    let ok = true;
    for (let i = 0; i < segs.length && ok; i++) {
      const s = segs[i], c = comps[i];
      if (s === c) score.push(4);
      else if (/^\{int:/.test(s) && /^-?\d+$/.test(c)) score.push(3);
      else if (/^\{string:/.test(s) && c !== "") score.push(2);
      else if (s === "*") score.push(1);
      else ok = false;
    }
    if (!ok) continue;
    const diff = bestScore ? score.findIndex((v, i) => v !== bestScore[i]) : 0;
    if (!bestScore || (diff >= 0 && score[diff] > bestScore[diff])) { best = r; bestScore = score; } // tie -> earlier registration
  }
  return best;
}
function iosRedirect(u) {
  const p = parseAny(u);
  if (!p) return u;
  const key = (x) => { const q = parseAny(x); return q ? `${q.scheme}://${(q.host || "").toLowerCase()}${q.path.toLowerCase()}` : ""; };
  const k = key(u);
  for (const [from, to, mustContain] of IOS_REDIRECTS) {
    if (key(from) !== k || (mustContain && !String(u).includes(mustContain))) continue;
    return p.query != null ? to + (to.includes("?") ? "&" : "?") + p.query : to; // original query items are carried over
  }
  return u;
}
function stripLocale(u) { // first path segment "es" (path only; walmart://es/... keeps it because "es" is the host)
  const p = parseAny(u);
  if (!p) return u;
  const m = /^\/es(?=\/|$)/i.exec(p.path);
  if (!m) return u;
  return String(u).replace(p.path, p.path.slice(m[0].length) || "/");
}

/**
 * opts.toRoute(httpsUrl) -> the walmart:// URL the app builds (core.js passes walmartSchemeURL / ImpactLink).
 * kind: "scheme" (walmart:// hop), "goto", "web" (www.walmart.com & co).
 */
function resolveIOS(hopUrl, kind, opts) {
  const res = { platform: "ios", appName: "iPhone app", outcome: null, page: null, detail: "", route: null, matched: null, src: null, notes: [], alt: null };
  let universal = null, route;
  if (kind === "scheme") {
    route = String(hopUrl).replace(/^walmart1h:\/\//i, "walmart://");
    if (/^walmart:\/\/\//i.test(route)) res.notes.push("The app link has three slashes (walmart:///…). The route matches, but some screens read the part after walmart:// and may not open correctly. Use walmart://… with two slashes.");
  } else {
    universal = stripLocale(hopUrl);
    if (truthy(query(universal).get("gbo"))) {
      return Object.assign(res, { outcome: "web", route: null, why: "The link has gbo=1, which tells the app to open it in Safari.", notes: res.notes });
    }
    route = opts.toRoute(universal, kind);
    if (route == null) {
      return Object.assign(res, { outcome: "home", why: kind === "goto" ? "The goto link has no u= destination, so the app opens but has nowhere to go." : "The app can't turn this address into an app page, so it opens and stays where it is." });
    }
  }
  route = iosRedirect(route);
  res.route = route;
  const pathStr = iosLegacyPathString(route);
  const q = query(route);
  const segs = (pathStr || "").split("/").filter(Boolean);
  const webOnly = /registry/i.test(route) && /^true$/i.test(q.get("isManageItem") || "");
  const legacy = !webOnly && pathStr != null ? IOS_LEGACY.find((r) => iosLegacyMatch(r.p, pathStr)) : null;
  const asyncHit = !webOnly ? iosAsyncMatch(route) : null;
  const fallback = universal
    ? { outcome: "web", why: "The app opens, finds no page for this address, and hands it to Safari (the Walmart website)." }
    : { outcome: "home", why: "The app opens, but no page matches this app link, so it stays on the screen it was on (Home on a fresh start)." };
  if (webOnly) return Object.assign(res, fallback, { why: "Managing a registry item is web-only, so the app sends it to Safari." });
  if (legacy) {
    Object.assign(res, { outcome: legacy.webview ? "webview" : "page", page: legacy.label, matched: legacy.p, src: legacy.src, detail: describe(legacy.label, segs, q) });
    if (legacy.note) res.notes.push(legacy.label + ": " + legacy.note + ".");
    if (asyncHit && asyncHit.label !== legacy.label) res.alt = { page: asyncHit.label, matched: asyncHit.p, when: "if the new iOS router (CCM platform.deeplinking.asyncRouter.enabled) is on" };
    return res;
  }
  Object.assign(res, fallback);
  if (asyncHit) res.alt = { page: asyncHit.label, outcome: asyncHit.label === "Home" ? "home" : "page", matched: asyncHit.p, src: asyncHit.src, detail: describe(asyncHit.label, segs, q),
    when: "if the new iOS router (CCM platform.deeplinking.asyncRouter.enabled, off by default) is on" };
  return res;
}

/* ======================================================================================================================
 * Android resolver
 * ==================================================================================================================== */
const ANDROID_LABELS = {
  GlassItemLink: "Item page", GlassBrandPagesLink: "Brand page", GlassContentPagesLink: "Content page", SearchLink: "Search results",
  BrowseLink: "Browse (category) page", DealsLink: "Shop / deals page", GlassDealsLink: "Deals page", GlassTopicPageLink: "Topic page",
  GlassCartLink: "Cart", GlassAuthenticatedCartLink: "Cart", GlassShopLink: "Home", GlassDefaultRootLink: "Home", GlassGroceryLink: "Grocery home",
  GlassInspireLink: "Inspire page", GlassListsLink: "Lists", GlassMyItemsLink: "My Items", GlassRegistryLink: "Registries",
  GlassAccountLink: "Account", GlassSignInLink: "Sign in", GlassSignUpLink: "Sign up", GlassWalletLandingLink: "Wallet",
  GlassOrdersLink: "Order details", GlassPurchaseHistoryLink: "Purchase history", GlassFCTrackingLink: "Order tracking", GlassSCTrackingLink: "Order tracking",
  GlassStorePagesLink: "Store page", GlassStoreFinderLink: "Store finder", GlassStoreWeeklyAdsLink: "Weekly ads", GlassMembershipLink: "Walmart+",
  GlassHelpCenterLink: "Help center", GlassGenericSearchLink: "Search results", GlassItemWARLink: "Write a review", GlassLivestreamLink: "Livestream",
  GlassRecipeLink: "Recipe", GlassRecipeHubLink: "Recipes", GlassRecipeResultsLink: "Recipe results", GlassShoppableListLink: "Shoppable list",
  GlassTrendEngineDiscoverTabLink: "Discover feed", GlassCreatorLink: "Creator page", GlassGlobalCreatorLink: "Creator storefront", GlassDGFCreatorLink: "Creator collection",
  GlassPromoCodeItemsLink: "Promo items", GlassGiftFinderLink: "Gift finder", ResumeYourJourneyLink: "Resume your journey", GlassScanAndGoLink: "Scan & Go",
  GlassAffilCartLink: "Cart (affiliate)", GlassAffiliateCartLink: "Cart (affiliate)", GlassAffiliateAddToCartCartLink: "Add to cart (affiliate)", GlassAffiliateBuyNowCartLink: "Buy now (affiliate)",
  GlassAffiliateSCCartLink: "Cart (affiliate)", GlassAffiliateSCAddToCartCartLink: "Add to cart (affiliate)", GlassAffiliateSCBuyNowCartLink: "Buy now (affiliate)",
};
function humanize(cls) {
  const words = cls.replace(/^Glass/, "").replace(/(Deep)?[Ll]ink(Link)?$/, "").match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) || [cls];
  const SPECIAL = { sng: "Scan & Go", acc: "Auto Care Center", ev: "EV", lmp: "local marketplace", ugc: "reviews", rc: "", bdp: "benefit details", olp: "offers", mlp: "landing", plp: "partner landing", dgf: "", rx: "Rx" };
  const out = words.map((w) => (w.toLowerCase() in SPECIAL ? SPECIAL[w.toLowerCase()] : w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).filter(Boolean).join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
const androidLabel = (cls) => ANDROID_LABELS[cls] || humanize(cls);
const DEFERRED = new Set(["GlassGotoLink", "GlassLeadMeShortLink", "GlassLinksEmLink", "GlassOneLinkDeferredLink", "GlassRptrcksLink", "GlassWmtShortLink", "GlassSaveEGiftCardLink"]);
const COMPILED = ANDROID ? ANDROID.patterns.map((p) => Object.assign({}, p, { rx: new RegExp(p.re, p.flags) })) : [];

// Manifest: does Android hand this URL to the app at all (instead of the browser)?
function androidCaptures(u) {
  const p = parseAny(u);
  if (!p || !ANDROID) return null;
  return ANDROID.filters.find((f) => {
    if (!f.schemes.includes(p.scheme)) return false;
    if (f.hosts.length && !f.hosts.some((h) => h.toLowerCase() === (p.host || "").toLowerCase())) return false;
    if (!f.paths.length && !f.prefixes.length && !f.patterns.length) return true;
    return f.paths.includes(p.path) || f.prefixes.some((x) => p.path.startsWith(x));
  }) || null;
}

const ANDROID_REDIRECTS = { "cp/walmart-credit-card/632402": "walmartcreditcard/landing", "cp/find-an-item-store-maps/6422847": "storemaps", "cp/scan-go/9679980": "scanandgo",
  "cp/9145505": "ev", "cp/store-mode/8459006": "storemode", "cp/fuel-pay-instore/5291998": "fuel/payInStore", "cp/auto-services/1087266": "acc",
  "moneycenter/dashboard": "cp/walmart-moneycenter/5433", "moneyservices/identityverification": "cp/walmart-moneycenter/5433" };

// LinkApiImpl.parseInternal rewrite chain (US registration order). Returns { url, notes }.
function androidRewrite(u) {
  const notes = [];
  let s = String(u);
  if (s.includes("walmartcreditcard/landing")) s = "walmart://cp/632402";
  s = s.replace(/\?step=cart/i, "cart/?");
  let p = parseAny(s);
  if (p && /^https?$/.test(p.scheme)) { const m = /^\/es(?=\/|$)/i.exec(p.path); if (m) s = s.replace(p.path, p.path.slice(m[0].length) || "/"); }
  s = s.replace(/^walmart1h:\/\//i, "walmart://");
  p = parseAny(s);
  if (p) {
    const key = /^https?$/.test(p.scheme) ? p.path.replace(/^\//, "").toLowerCase() : ((p.host || "") + p.path).toLowerCase();
    if (ANDROID_REDIRECTS[key]) {
      const to = ANDROID_REDIRECTS[key];
      s = /^https?$/.test(p.scheme) ? `${p.scheme}://${p.host}/${to}${p.query != null ? "?" + p.query : ""}` : `walmart://${to}${p.query != null ? "?" + p.query : ""}`;
    }
  }
  if (s.includes("cp/3205993")) s = "walmart://walmartpay";
  if (/cp\/(pharmacy\/)?5431(?!\d)/.test(s)) { s = "walmart://healthandwellness/dashboard"; notes.push("Pharmacy links go to the native Health & Wellness dashboard only when its feature flag is on; otherwise they open as a web page."); }
  p = parseAny(s);
  if (p && /^https/.test(p.scheme) && /^\/health-and-wellness(\/|$)/.test(p.path)) { s = "walmart://healthandwellness/dashboard"; notes.push("Health & wellness web links open the native dashboard only for allow-listed sections with their feature flags on; otherwise they open as a web page."); }
  if (/cp\/(vision-centers\/)?1078944(?!\d)/.test(s)) s = "walmart://healthandwellness/vision";
  else if (/cp\/(walmart-insurance-services\/)?8910931(?!\d)/.test(s)) s = "walmart://healthandwellness/insurance";
  else if (/cp\/(virtual-care\/)?3955077(?!\d)/.test(s) || /^walmart:\/\/healthandwellness\/teleHealth/.test(s)) s = "walmart://healthandwellness/virtualcare";
  return { url: s, notes };
}

// Pattern match + winner selection (LinkFactory / LinkApiImpl): all classes that match; drop @Last if more than one.
function androidParse(u) {
  const rw = androidRewrite(u);
  let p = parseAny(rw.url);
  if (!p) return { error: "unparseable", notes: rw.notes };
  // Uri.newWithPathFix: walmart://abc/123 -> path /abc/123
  let path = p.path;
  if (!/^http/.test(p.scheme) && p.host) path = "/" + p.host + (p.path || "");
  const pathForMatch = safeDecode(path).replace(/^\//, "");
  const host = (p.host || "").toLowerCase();
  const typeMatches = (r) => {
    if (r.deepLink && p.scheme === "walmart") return true;
    if (p.scheme !== "https") return false;
    if (r.defaultDomains && WALMART_WEB.has(host)) return true;
    if (r.customDomains.some((d) => d.toLowerCase() === host)) return true;
    if (!r.deepLink && r.defaultDomains && r.customDomainPatterns.some((d) => host.endsWith(d.toLowerCase()))) return true;
    return false;
  };
  const hits = new Map();
  for (const r of COMPILED) if (r.rx.test(pathForMatch) && typeMatches(r)) { if (!hits.has(r.cls)) hits.set(r.cls, r); }
  let list = [...hits.values()];
  if (list.length > 1) list = list.filter((r) => !r.last);
  return { url: rw.url, notes: rw.notes, winner: list.length === 1 ? list[0] : null, candidates: [...hits.keys()], segs: pathForMatch.split("/").filter(Boolean), q: query(rw.url) };
}

function androidOutcome(parsed, res) {
  const w = parsed.winner;
  res.notes.push(...parsed.notes);
  if (!w) {
    res.outcome = "home";
    res.why = parsed.candidates.length > 1
      ? "More than one Android page matches this address (" + parsed.candidates.join(", ") + "), so the app can't pick one and stays on Home."
      : "No Android page matches this address, so the app opens and stays on Home.";
    return res;
  }
  res.matched = w.java; res.src = w.src; res.cls = w.cls;
  if (w.cls === "GlassDefaultOnlineLink") {
    res.outcome = "web";
    res.why = truthy(parsed.q.get("oab")) ? "No app page matches; with oab=1 the app shows it in an in-app browser tab." : "No app page matches this address, so the app opens it in the web browser.";
    if (truthy(parsed.q.get("oab"))) res.outcome = "webview";
    return res;
  }
  if (w.cls === "GlassDefaultRootLink" || w.cls === "GlassShopLink") { res.outcome = "home"; res.page = "Home"; res.why = "This is the Walmart home address, so the app opens on Home."; return res; }
  if (w.cls === "DeferredResolutionErrorLink") { res.outcome = "error"; res.why = "The app shows an error sheet."; return res; }
  res.outcome = "page"; res.page = androidLabel(w.cls); res.detail = describe(res.page, parsed.segs, parsed.q);
  if (w.auth) res.notes.push("This page may ask the customer to sign in first.");
  return res;
}

/**
 * Android: the first hop the OS hands to the app (manifest intent filters), then the router.
 * goto.walmart.com is resolved like GotoLinkResolver: the app follows the redirects itself (HEAD) and uses the LAST
 * URL in the chain that is a real app page (not a redirect link or the web fallback).
 */
function resolveAndroid(hops) {
  const res = { platform: "android", appName: "Android app", outcome: null, page: null, detail: "", route: null, matched: null, src: null, notes: [] };
  if (!ANDROID) return Object.assign(res, { outcome: "unknown", why: "Android route table not loaded." });
  let ai = -1;
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i];
    if (h.appScheme && /hidden iframe/.test(h.via || "")) { res.notes.push(/emulated pgbuynow/.test(h.via) ? "The redirect page opens the app this way only on iPhone; on Android it uses an intent link and then the web address, so Android is judged on the web address."
      : "The redirect page was run as an iPhone and opens the app with a hidden iframe; Android phones may be sent differently, so Android is judged on the web address the page goes to next."); continue; }
    if (h.error && !h.appScheme && !androidCaptures(h.url)) continue;
    if (androidCaptures(h.url)) { ai = i; break; }
  }
  if (ai < 0) {
    const www = hops.find((h) => WALMART_WEB.has(h.host));
    return Object.assign(res, { outcome: "web", opensApp: false,
      why: www ? "Android only opens the app for the walmart.com paths listed in the app's manifest; " + (parseAny(www.url) || {}).path + " isn't one of them, so the link stays in the browser."
        : "No address in the link is one Android opens the app for." });
  }
  const h = hops[ai];
  res.hop = ai + 1;
  res.opensApp = true;
  const parsed = androidParse(h.url);
  if (parsed.winner && parsed.winner.cls === "GlassGotoLink") {
    // GotoLinkResolver: follow the chain after goto; last URL that parses to a real (non-deferred, non-fallback) link wins.
    let chain = hops.slice(ai + 1).filter((x) => !x.appScheme).map((x) => x.url);
    let approx = false;
    if (!chain.length) {
      const u = query(h.url).get("u");
      if (u) { chain = [fullyDecode(u)]; approx = true; }
    }
    const pick = chain.slice().reverse().map((u) => ({ u, p: androidParse(u) }))
      .find((x) => x.p.winner && !DEFERRED.has(x.p.winner.cls) && x.p.winner.cls !== "GlassDefaultOnlineLink");
    if (approx) res.notes.push("The tracer couldn't follow goto.walmart.com, so this assumes it redirects to the decoded u= destination (what the Android app would follow).");
    if (!pick) return Object.assign(res, { outcome: "error", route: chain[chain.length - 1] || null,
      why: "The Android app follows the goto link's redirects but none of them is an app page, so it shows an error sheet instead of a page." });
    res.route = pick.u;
    return androidOutcome(pick.p, res);
  }
  if (parsed.winner && DEFERRED.has(parsed.winner.cls)) {
    return Object.assign(res, { outcome: "unknown", matched: parsed.winner.java, src: parsed.winner.src, why: "This is a redirect link the Android app resolves over the network; check the next addresses in the journey." });
  }
  res.route = parsed.url;
  return androidOutcome(parsed, res);
}

/* ======================================================================================================================
 * Both platforms
 * ==================================================================================================================== */
const OUTCOME_RANK = { page: 0, home: 0, webview: 1, unknown: 2, web: 3, error: 4 };
/**
 * hops: trace hops. ti: index of the app-opening hop (core.appTakeoverIndex). toRoute(url, kind): walmart:// URL the iOS app
 * builds from an https hop (core.js passes walmartSchemeURL / ImpactLink.manipulate).
 */
function resolveDestinations(hops, ti, toRoute) {
  const out = { ios: null, android: null, source: { android: ANDROID ? ANDROID.source + " (" + ANDROID.generated + ")" : null, ios: "glass-app (hand-curated table)" } };
  if (ti >= 0 && hops[ti]) {
    const h = hops[ti];
    const kind = h.appScheme ? "scheme" : /^goto(\.grocery)?\.walmart\.com$/.test(h.host) ? "goto" : "web";
    out.ios = resolveIOS(h.url, kind, { toRoute });
    out.ios.hop = ti + 1;
    out.ios.opensApp = true;
  } else out.ios = { platform: "ios", appName: "iPhone app", outcome: "web", opensApp: false, why: "Nothing in the link is an address that opens the iPhone app.", notes: [] };
  out.android = resolveAndroid(hops || []);
  return out;
}

const api = { resolveDestinations, resolveIOS, resolveAndroid, androidCaptures, androidParse, androidRewrite, iosLegacyMatch, iosLegacyPathString, iosAsyncMatch, iosRedirect,
  IOS_LEGACY, IOS_ASYNC, IOS_REDIRECTS, OUTCOME_RANK, androidLabel, ANDROID };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.DLRoutes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
