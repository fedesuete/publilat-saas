// Detección de navegador in-app (webview de Facebook/Instagram/TikTok/etc.). Adentro de esas apps
// las cookies _fbp/_fbc no persisten bien, el píxel matchea peor y la PWA no se puede instalar →
// conviene empujar al usuario a abrir el link en Chrome/Safari real. Fase B.
export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|musical_ly|Bytedance|TikTok|Snapchat|Line\/|; wv\)/i.test(ua);
}

// Intenta abrir la URL en el navegador real. Android: intent:// (abre el navegador por defecto).
// iOS/otros: no hay escape programático confiable → se abre _blank como intento y el usuario usa
// el menú ••• → "Abrir en el navegador".
export function tryOpenInBrowser(url: string = location.href): void {
  if (/Android/i.test(navigator.userAgent)) {
    const clean = url.replace(/^https?:\/\//, "");
    window.location.href = `intent://${clean}#Intent;scheme=https;end`;
  } else {
    window.open(url, "_blank");
  }
}
