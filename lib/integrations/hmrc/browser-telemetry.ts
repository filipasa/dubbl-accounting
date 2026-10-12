/**
 * Client-side browser telemetry collector for HMRC Anti-Fraud Headers
 */
export function getBrowserTelemetry(): {
  deviceId: string;
  screens: string;
  windowSize: string;
  timezone: string;
  browserUserAgent: string;
  doNotTrack: boolean;
} {
  if (typeof window === "undefined") {
    return {
      deviceId: "server",
      screens: "width=1920&height=1080&scaling-factor=1&colour-depth=24",
      windowSize: "width=1440&height=900",
      timezone: "UTC+00:00",
      browserUserAgent: "",
      doNotTrack: false,
    };
  }

  // Persistent client device ID
  let deviceId = localStorage.getItem("fixbooks_hmrc_device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("fixbooks_hmrc_device_id", deviceId);
  }

  // Screen specs: width=1920&height=1080&scaling-factor=1&colour-depth=24
  const screenWidth = window.screen?.width || 1920;
  const screenHeight = window.screen?.height || 1080;
  const scalingFactor = window.devicePixelRatio || 1;
  const colourDepth = window.screen?.colorDepth || 24;
  const screens = `width=${screenWidth}&height=${screenHeight}&scaling-factor=${scalingFactor}&colour-depth=${colourDepth}`;

  // Window specs: width=1440&height=900
  const windowWidth = window.innerWidth || 1440;
  const windowHeight = window.innerHeight || 900;
  const windowSize = `width=${windowWidth}&height=${windowHeight}`;

  // Timezone formatting: UTC+01:00 or UTC-05:00
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const absMins = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  const timezone = `UTC${sign}${absHours}:${absMins}`;

  const browserUserAgent = navigator.userAgent || "";
  const doNotTrack = navigator.doNotTrack === "1" || (window as unknown as { doNotTrack: string }).doNotTrack === "1";

  return {
    deviceId,
    screens,
    windowSize,
    timezone,
    browserUserAgent,
    doNotTrack,
  };
}
