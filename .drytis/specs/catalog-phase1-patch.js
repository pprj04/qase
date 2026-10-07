/**
 * Catalog expansion patch — Phase 1 (#14273).
 *
 * These arrays REPLACE the corresponding device lists in
 * server/environmentCatalog.js wholesale (data-only expansion, catalog
 * 2027.01.0). Applied via scripts/apply-catalog-phase1.mjs.
 */

// ---------------------------------------------------------------------------
// Legacy + generational iPhones (prepended before the existing 11-17 block).
// Honest per-device iOS ranges (factual support windows):
//   X / 8 / 7 lines: iOS 13–16 max (X/8 cap at iOS 16, 7 at iOS 15)
//   XR / XS / XS Max: iOS 12–18 (cap 18 per Apple support)
//   SE 1st gen (2016): iOS 13–15 · SE 2nd (2020): 13–18 · SE 3rd (2022): 15–26
// ---------------------------------------------------------------------------

export const LEGACY_IPHONES = [
	iphone('IP7', 'iPhone 7', '375×667', 2, '4.7 inch', ['13.0', '14.0', '15.0']),
	iphone('IP7PLUS', 'iPhone 7 Plus', '414×736', 3, '5.5 inch', ['13.0', '14.0', '15.0']),
	iphone('IP8', 'iPhone 8', '375×667', 2, '4.7 inch', ['13.0', '14.0', '15.0', '16.0']),
	iphone('IP8PLUS', 'iPhone 8 Plus', '414×736', 3, '5.5 inch', ['13.0', '14.0', '15.0', '16.0']),
	iphone('IPX', 'iPhone X', '375×812', 3, '5.8 inch', ['13.0', '14.0', '15.0', '16.0']),
	iphone('IPXR', 'iPhone XR', '414×896', 2, '6.1 inch', ['13.0', '14.0', '15.0', '16.0', '17.0', '18.3']),
	iphone('IPXS', 'iPhone XS', '375×812', 3, '5.8 inch', ['13.0', '14.0', '15.0', '16.0', '17.0', '18.3']),
	iphone('IPXSMAX', 'iPhone XS Max', '414×896', 3, '6.5 inch', ['13.0', '14.0', '15.0', '16.0', '17.0', '18.3']),
	iphone('IPSE1', 'iPhone SE (1st gen)', '375×667', 2, '4.0 inch', ['13.0', '14.0', '15.0']),
	iphone('IPSE2', 'iPhone SE (2nd gen)', '375×667', 2, '4.7 inch', ['13.0', '14.0', '15.0', '16.0', '17.0', '18.3']),
	iphone('IPSE3', 'iPhone SE (3rd gen)', '375×667', 2, '4.7 inch', ['15.0', '16.0', '17.0', '18.3', '26.0'])
];

// ---------------------------------------------------------------------------
// iPad generational coverage (replaces the one-representative-per-line block;
// the six original representative rows keep their slugs where possible).
// Factual iPadOS/iOS windows per generation.
// ---------------------------------------------------------------------------

export const IPAD_GENERATIONS = [
	ipad('IPAD5', 'iPad', 'iPad (5th Gen)', '768×1024', 2, '9.7 inch', ['13.0', '14.0', '15.0', '16.0']),
	ipad('IPAD6', 'iPad', 'iPad (6th Gen)', '768×1024', 2, '9.7 inch', ['13.0', '14.0', '15.0', '16.0']),
	ipad('IPAD7', 'iPad', 'iPad (7th Gen)', '810×1080', 2, '10.2 inch', ['13.0', '14.0', '15.0', '16.0', '17.0']),
	ipad('IPAD8', 'iPad', 'iPad (8th Gen)', '810×1080', 2, '10.2 inch', ['13.0', '14.0', '15.0', '16.0', '17.0', '18.3']),
	ipad('IPAD9', 'iPad', 'iPad (9th Gen)', '810×1080', 2, '10.2 inch', ['14.0', '15.0', '16.0', '17.0', '18.3']),
	ipad('IPAD10', 'iPad', 'iPad (10th Gen)', '820×1180', 2, '10.9 inch', ['15.0', '16.0', '17.0', '18.3', '26.0']),
	ipad('IPAD11', 'iPad', 'iPad (11th Gen)', '820×1180', 2, '11.0 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADAIR3', 'iPad Air', 'iPad Air (3rd Gen)', '810×1080', 2, '10.5 inch', ['13.0', '14.0', '15.0', '16.0']),
	ipad('IPADAIR4', 'iPad Air', 'iPad Air (4th Gen)', '820×1180', 2, '10.9 inch', ['13.0', '14.0', '15.0', '16.0', '17.0']),
	ipad('IPADAIR5', 'iPad Air', 'iPad Air (5th Gen)', '820×1180', 2, '10.9 inch', ['15.0', '16.0', '17.0', '18.3']),
	ipad('IPADAIR6', 'iPad Air', 'iPad Air (6th Gen)', '820×1180', 2, '11.0 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADAIR7', 'iPad Air', 'iPad Air (7th Gen)', '820×1180', 2, '11.0 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADMINI5', 'iPad mini', 'iPad mini (5th Gen)', '744×1133', 2, '7.9 inch', ['13.0', '14.0', '15.0', '16.0', '17.0']),
	ipad('IPADMINI6', 'iPad mini', 'iPad mini (6th Gen)', '744×1133', 2, '8.3 inch', ['15.0', '16.0', '17.0', '18.3']),
	ipad('IPADMINI7', 'iPad mini', 'iPad mini (7th Gen)', '744×1133', 2, '8.3 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADPRO11-1', 'iPad Pro 11-inch', 'iPad Pro 11 (1st Gen)', '834×1194', 2, '11.0 inch', ['13.0', '14.0', '15.0', '16.0', '17.0']),
	ipad('IPADPRO11-2', 'iPad Pro 11-inch', 'iPad Pro 11 (2nd Gen)', '834×1194', 2, '11.0 inch', ['14.0', '15.0', '16.0', '17.0']),
	ipad('IPADPRO11-3', 'iPad Pro 11-inch', 'iPad Pro 11 (3rd Gen)', '834×1194', 2, '11.0 inch', ['15.0', '16.0', '17.0', '18.3']),
	ipad('IPADPRO11-4', 'iPad Pro 11-inch', 'iPad Pro 11 (4th Gen)', '834×1194', 2, '11.0 inch', ['16.0', '17.0', '18.3', '26.0']),
	ipad('IPADPRO11-5', 'iPad Pro 11-inch', 'iPad Pro 11 (5th Gen)', '834×1194', 2, '11.0 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADPRO129-1', 'iPad Pro 12.9-inch', 'iPad Pro 12.9 (3rd Gen)', '1024×1366', 2, '12.9 inch', ['13.0', '14.0', '15.0', '16.0', '17.0']),
	ipad('IPADPRO129-2', 'iPad Pro 12.9-inch', 'iPad Pro 12.9 (4th Gen)', '1024×1366', 2, '12.9 inch', ['14.0', '15.0', '16.0', '17.0']),
	ipad('IPADPRO129-3', 'iPad Pro 12.9-inch', 'iPad Pro 12.9 (5th Gen)', '1024×1366', 2, '12.9 inch', ['15.0', '16.0', '17.0', '18.3']),
	ipad('IPADPRO129-4', 'iPad Pro 12.9-inch', 'iPad Pro 12.9 (6th Gen)', '1024×1366', 2, '12.9 inch', ['16.0', '17.0', '18.3']),
	ipad('IPADPRO13', 'iPad Pro 13-inch', 'iPad Pro 13 (M4)', '1032×1376', 2, '13.0 inch', ['17.0', '18.3', '26.0'])
];

// ---------------------------------------------------------------------------
// macOS hardware models (replace one-pseudo-device-per-OS).
// slugs MACMBA / MACMBP / MACIMAC / MACMINI / MACSTUDIO / MACPRO per model line.
// Honest macOS ranges:
//   Apple Silicon laptops/desktops: Monterey 12 → Tahoe 26
//   Intel MacBook Pro 2019 / iMac 27: High Sierra 10.13 → Monterey 12 (some Ventura)
//   iMac 24 M4: Sonoma → Tahoe
// ---------------------------------------------------------------------------

export const MAC_HARDWARE = [
	macModel('MACMBA-M2', 'MacBook Air (M2)', ['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], 13.6),
	macModel('MACMBA-M3', 'MacBook Air (M3)', ['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], 13.6),
	macModel('MACMBA-M4', 'MacBook Air (M4)', ['Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], 13.6),
	macModel('MACMBP14-M3', 'MacBook Pro 14 (M3)', ['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], 14.2),
	macModel('MACMBP14-M4', 'MacBook Pro 14 (M4)', ['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], 14.2),
	macModel('MACMBP16-M3', 'MacBook Pro 16 (M3)', ['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], 16.2),
	macModel('MACMBP16-M4', 'MacBook Pro 16 (M4)', ['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], 16.2),
	macModel('MACMBP16-INT19', 'MacBook Pro 16 (Intel 2019)', ['High Sierra', 'Mojave', 'Catalina', 'Big Sur', 'Monterey'], 16.0),
	macModel('MACIMAC-INT', 'iMac (27-inch Intel 2020)', ['High Sierra', 'Mojave', 'Catalina', 'Big Sur', 'Monterey', 'Ventura'], 27.0),
	macModel('MACIMAC-M4', 'iMac (24-inch M4)', ['Sonoma', 'Sequoia', 'Tahoe'], 24.0),
	macModel('MACMINI-M4', 'Mac mini (M4)', ['Sonoma', 'Sequoia', 'Tahoe'], null),
	macModel('MACSTUDIO-M2MAX', 'Mac Studio (M2 Max)', ['Monterey', 'Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], null),
	macModel('MACSTUDIO-M4MAX', 'Mac Studio (M4 Max)', ['Ventura', 'Sonoma', 'Sequoia', 'Tahoe'], null),
	macModel('MACPRO-M2U', 'Mac Pro (M2 Ultra)', ['Sonoma', 'Sequoia', 'Tahoe'], null)
];

// ---------------------------------------------------------------------------
// Windows: form factors × OS versions 7–11. Server excluded (infrastructure
// does not support Windows Server execution targets).
// ---------------------------------------------------------------------------

export const WINDOWS_FORM_FACTORS = [
	// slug, name, deviceType, osVersions, resolution
	['WINDESKTOP', 'Windows Desktop', 'desktop', ['7', '8', '8.1', '10', '11'], 1920, 1080],
	['WINLAPTOP', 'Windows Laptop', 'desktop', ['7', '8', '8.1', '10', '11'], 1536, 864],
	['WINLAPTOP-T', 'Windows Touch Laptop', 'desktop', ['10', '11'], 1536, 864],
	['WINTABLET', 'Windows Tablet', 'tablet', ['10', '11'], 1280, 800],
	['WIN2IN1', 'Windows 2-in-1', 'two-in-one', ['10', '11'], 1440, 900]
];

// ---------------------------------------------------------------------------
// Android additions & fills. Per-device honest ranges.
// ---------------------------------------------------------------------------

export const ANDROID_ADDITIONS = [
	// Samsung fills
	['GALS21U', 'Galaxy S21 Ultra', 'Samsung', 'Samsung Galaxy S21 Ultra', ['12', '13'], '384×824'],
	['GALS22U', 'Galaxy S22 Ultra', 'Samsung', 'Samsung Galaxy S22 Ultra', ['12', '13', '14'], '384×824'],
	['GALS23U', 'Galaxy S23 Ultra', 'Samsung', 'Samsung Galaxy S23 Ultra', ['13', '14', '15'], '384×824'],
	['GALS24U', 'Galaxy S24 Ultra', 'Samsung', 'Samsung Galaxy S24 Ultra', ['14', '15'], '384×824'],
	['GALS25U', 'Galaxy S25 Ultra', 'Samsung', 'Samsung Galaxy S25 Ultra', ['15'], '384×824'],
	['GALA15', 'Galaxy A15', 'Samsung', 'Samsung Galaxy A15', ['13', '14'], '360×800'],
	['GALA25', 'Galaxy A25', 'Samsung', 'Samsung Galaxy A25', ['13', '14'], '360×800'],
	['GALA35', 'Galaxy A35', 'Samsung', 'Samsung Galaxy A35', ['14', '15'], '360×800'],
	['GALA55', 'Galaxy A55', 'Samsung', 'Samsung Galaxy A55', ['14', '15'], '360×800'],
	['GALM34', 'Galaxy M34', 'Samsung', 'Samsung Galaxy M34', ['13', '14'], '360×800'],
	['GALM35', 'Galaxy M35', 'Samsung', 'Samsung Galaxy M35', ['14', '15'], '360×800'],
	['GALM55', 'Galaxy M55', 'Samsung', 'Samsung Galaxy M55', ['14', '15'], '360×800'],
	['GALTABS9', 'Galaxy Tab S9', 'Samsung', 'Samsung Galaxy Tab S9', ['13', '14', '15'], '800×1280'],
	['GALTABS10', 'Galaxy Tab S10', 'Samsung', 'Samsung Galaxy Tab S10', ['14', '15'], '800×1280'],
	['GALTABA9P', 'Galaxy Tab A9+', 'Samsung', 'Samsung Galaxy Tab A9+', ['13', '14'], '800×1280'],
	['GALZFOLD6', 'Galaxy Z Fold 6', 'Samsung', 'Samsung Galaxy Z Fold 6', ['14', '15'], '968×896'],
	['GALZFLIP6', 'Galaxy Z Flip 6', 'Samsung', 'Samsung Galaxy Z Flip 6', ['14', '15'], '373×844'],
	// Google fills
	['PIXEL6PRO', 'Pixel 6 Pro', 'Google', 'Google Pixel 6 Pro', ['12', '13', '14'], '412×915'],
	['PIXEL6A', 'Pixel 6a', 'Google', 'Google Pixel 6a', ['12', '13', '14'], '412×915'],
	['PIXEL7A', 'Pixel 7a', 'Google', 'Google Pixel 7a', ['13', '14', '15'], '412×915'],
	['PIXEL8A', 'Pixel 8a', 'Google', 'Google Pixel 8a', ['14', '15'], '412×915'],
	['PIXEL9A', 'Pixel 9a', 'Google', 'Google Pixel 9a', ['15'], '412×1016'],
	['PIXEL9PROXL', 'Pixel 9 Pro XL', 'Google', 'Google Pixel 9 Pro XL', ['14', '15', '16'], '412×1016'],
	['PIXEL10PRO', 'Pixel 10 Pro', 'Google', 'Google Pixel 10 Pro', ['15', '16'], '412×1016'],
	['PIXELTABLET', 'Pixel Tablet', 'Google', 'Google Pixel Tablet', ['13', '14', '15'], '1280×800'],
	// New manufacturers
	['POCOX6', 'POCO X6', 'POCO', 'POCO X6', ['13', '14'], '393×873'],
	['POCOF6', 'POCO F6', 'POCO', 'POCO F6', ['14', '15'], '393×873'],
	['XPERIA1VI', 'Xperia 1 VI', 'Sony', 'Sony Xperia 1 VI', ['14', '15'], '412×915'],
	['XPERIA5V', 'Xperia 5 V', 'Sony', 'Sony Xperia 5 V', ['13', '14', '15'], '412×915'],
	['XPERIA10V', 'Xperia 10 V', 'Sony', 'Sony Xperia 10 V', ['13', '14'], '360×800'],
	['ZENFONE10', 'Zenfone 10', 'Asus', 'Asus Zenfone 10', ['13', '14'], '360×800'],
	['ZENFONE11', 'Zenfone 11 Ultra', 'Asus', 'Asus Zenfone 11 Ultra', ['14', '15'], '384×824'],
	['ROGPHONE8', 'ROG Phone 8', 'Asus', 'Asus ROG Phone 8', ['14', '15'], '384×824'],
	['LENOTABP12', 'Tab P12', 'Lenovo', 'Lenovo Tab P12', ['13', '14'], '1200×1840'],
	['HUAWEIP60', 'P60', 'Huawei', 'Huawei P60', ['12'], '360×960'],
	['HUAWEIMATE60', 'Mate 60 Pro', 'Huawei', 'Huawei Mate 60 Pro', ['12'], '460×2208'],
	['HONORMAGIC6', 'Magic 6 Pro', 'Honor', 'Honor Magic 6 Pro', ['14'], '384×824'],
	['HONOR90', 'Honor 90', 'Honor', 'Honor 90', ['13', '14'], '393×873'],
	// Extensions of existing manufacturers
	['XIAOMI15', 'Xiaomi 15', 'Xiaomi', 'Xiaomi 15', ['15'], '393×873'],
	['XIAOMI15P', 'Xiaomi 15 Pro', 'Xiaomi', 'Xiaomi 15 Pro', ['15'], '1440×3200'],
	['REDMINOTE13P', 'Redmi Note 13 Pro', 'Xiaomi', 'Redmi Note 13 Pro', ['13', '14'], '393×873'],
	['REDMINOTE14', 'Redmi Note 14', 'Xiaomi', 'Redmi Note 14', ['14', '15'], '393×873'],
	['NOTHPHONE3A', 'Nothing Phone (3a)', 'Nothing', 'Nothing Phone (3a)', ['15'], '393×873']
];

function iphone(slug, name, viewport, dpr, screenSize, osVersions) {
	const [width, height] = viewport.split('×').map(Number);
	return { slug, name, runtimeDeviceName: name, platformId: 'ios', deviceType: 'mobile', screenSize, osVersions, isRealDevice: true, emulation: { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true } };
}
function ipad(slug, name, runtimeDeviceName, viewport, dpr, screenSize, osVersions) {
	const [width, height] = viewport.split('×').map(Number);
	return { slug, name, runtimeDeviceName, platformId: 'ipados', deviceType: 'tablet', screenSize, osVersions, isRealDevice: true, emulation: { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true } };
}
function macModel(slug, name, osVersions, inches) {
	return { slug, name, runtimeDeviceName: null, platformId: 'macos', deviceType: 'desktop', screenSize: inches ? `${inches} inch` : '—', osVersions, isRealDevice: false, emulation: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false } };
}
